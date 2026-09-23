create table public.px_jobs(id uuid primary key default gen_random_uuid(),kind text not null,source_id text not null,status text not null default 'pending',error text,created_at timestamptz not null default now(),unique(kind,source_id));
alter table public.px_jobs enable row level security;
revoke all on public.px_jobs from anon,authenticated;
grant select on public.px_jobs to authenticated;
grant all on public.px_jobs to service_role;
create policy jobs_admin on public.px_jobs for select to authenticated using(px_private.has_role(array['owner']));
alter table public.px_xp drop constraint px_xp_amount_check;
create function px_private.service(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare deal public.px_deals; payment public.px_payments; comm public.px_commissions; app public.px_applicants; cfg jsonb; data jsonb; v_id uuid; v_rep_id uuid; cnt int; amount int;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501';end if;
 select value into cfg from public.px_settings;
 if action='application' then
  if not (cfg->>'recruiting_open')::boolean then raise exception 'Applications are currently closed.';end if;
  insert into px_private.rate_limits(key) values('application:'||(p->>'ip_hash')) on conflict(key) do update set count=case when px_private.rate_limits.started_at<now()-interval '1 hour' then 1 else px_private.rate_limits.count+1 end,started_at=case when px_private.rate_limits.started_at<now()-interval '1 hour' then now() else px_private.rate_limits.started_at end returning count into cnt;
  if cnt>5 then raise exception 'Too many applications. Please try again later.';end if;
  insert into public.px_applicants(email,name,details) values(lower(p->>'email'),p->>'name',p->'details') on conflict(lower(email)) do nothing;
  return '{"received":true}';
 elsif action='approval_identity' then
  select * into app from public.px_applicants where id=(p->>'applicant_id')::uuid and stage in ('approved','approval_error');
  if app.id is null then raise exception 'Applicant has not been approved.';end if;
  return jsonb_build_object('user_id',(select id from auth.users where lower(email)=app.email limit 1));
 elsif action='approval_complete' then
  select * into app from public.px_applicants where id=(p->>'applicant_id')::uuid for update;
  if app.id is null or app.stage not in ('approved','approval_error') then raise exception 'Applicant has not been approved.';end if;
  if app.rep_id is not null then return jsonb_build_object('rep_id',app.rep_id);end if;
  v_rep_id:=(p->>'user_id')::uuid;
  if not exists(select 1 from auth.users where id=v_rep_id and lower(email)=app.email) then raise exception 'Invitation account does not match the applicant.';end if;
  insert into public.px_reps(id,name,timezone) values(v_rep_id,app.name,app.details->>'timezone') on conflict(id) do nothing;
  insert into public.px_rep_private(rep_id,email) values(v_rep_id,app.email) on conflict do nothing;
  update public.px_applicants set rep_id=v_rep_id,stage='approved' where id=app.id;
  insert into public.px_notifications(rep_id,title,body) values(v_rep_id,'Welcome to Pixelalty','Complete your profile, agreement, training, and payment setup.');
  perform px_private.audit('approval_complete',app.id::text);return jsonb_build_object('rep_id',v_rep_id);
 elsif action='approval_error' then update public.px_applicants set stage='approval_error' where id=(p->>'id')::uuid and rep_id is null;
 elsif action='checkout_attach' then
  select * into deal from public.px_deals where id=(p->>'deal_id')::uuid for update;
  if deal.stage='paid' then return '{}';end if;
  if deal.checkout_id is not null and deal.checkout_id<>p->>'checkout_id' then raise exception 'Checkout already exists for this deal.';end if;
  update public.px_deals set checkout_id=p->>'checkout_id',checkout_url=p->>'url',stage='checkout' where id=deal.id;
 elsif action='connect' then
  insert into public.px_connect(rep_id,account_id,transfers_enabled,payouts_enabled,details_submitted,requirements,checked_at) values((p->>'rep_id')::uuid,p->>'account_id',(p->>'transfers_enabled')::boolean,(p->>'payouts_enabled')::boolean,(p->>'details_submitted')::boolean,coalesce(p->'requirements','[]'),now())
  on conflict(rep_id) do update set transfers_enabled=excluded.transfers_enabled,payouts_enabled=excluded.payouts_enabled,details_submitted=excluded.details_submitted,requirements=excluded.requirements,checked_at=now() where public.px_connect.account_id=excluded.account_id;
 elsif action='payment' then
  if exists(select 1 from public.px_stripe_events where id=p->>'event_id' and status='processed') then return '{"duplicate":true}';end if;
  select * into deal from public.px_deals where id=(p->>'deal_id')::uuid for update;
  if deal.id is null or deal.price_cents<>(p->>'amount_cents')::int or deal.currency<>p->>'currency' or deal.rep_id::text<>p->>'rep_id' or deal.package_id::text<>p->>'package_id' or deal.checkout_id is distinct from p->>'checkout_id' then raise exception 'Payment attribution does not match the immutable deal snapshot.';end if;
  select * into payment from public.px_payments where deal_id=deal.id;
  if payment.id is not null and (payment.payment_intent<>p->>'payment_intent' or payment.charge_id<>p->>'charge_id') then raise exception 'This deal already has a different payment.';end if;
  insert into public.px_payments(deal_id,payment_intent,charge_id,amount_cents,refunded_cents,disputed,settled,available_at) values(deal.id,p->>'payment_intent',p->>'charge_id',deal.price_cents,(p->>'refunded_cents')::int,(p->>'disputed')::boolean,(p->>'settled')::boolean,(p->>'available_at')::timestamptz)
  on conflict(deal_id) do update set refunded_cents=greatest(public.px_payments.refunded_cents,excluded.refunded_cents),disputed=excluded.disputed,settled=excluded.settled,available_at=excluded.available_at returning * into payment;
  update public.px_deals set stage='paid' where id=deal.id;
  update public.px_businesses set customer=true,stage='won' where id=deal.business_id;
  update public.px_followups set status='cancelled' where business_id=deal.business_id and status='open';
  insert into public.px_commissions(deal_id,rep_id,amount_cents,hold_until) values(deal.id,deal.rep_id,deal.commission_cents,now()+make_interval(days=>(cfg->>'hold_days')::int)) on conflict(deal_id) do nothing returning id into v_id;
  if v_id is not null then insert into public.px_commission_events(commission_id,event,amount_cents,external_id,reason) values(v_id,'earned',deal.commission_cents,p->>'payment_intent','Verified customer payment');end if;
  select * into comm from public.px_commissions where deal_id=deal.id for update;
  if payment.refunded_cents>0 or payment.disputed then
   update public.px_commissions set status=case when transfer_id is not null or status='queued' then 'recovery_review' else 'hold' end,manual_hold=true where id=comm.id;
   insert into public.px_commission_events(commission_id,event,external_id,reason) values(comm.id,'payment_review',p->>'event_id','Refund or dispute requires finance review') on conflict do nothing;
  end if;
  insert into public.px_fulfillment(deal_id) values(deal.id) on conflict do nothing;
  begin
   insert into public.px_xp(rep_id,source,source_id,amount) values(deal.rep_id,'sale',deal.id,deal.sale_xp) on conflict do nothing;
   if payment.refunded_cents=payment.amount_cents then insert into public.px_xp(rep_id,source,source_id,amount) values(deal.rep_id,'refund',deal.id,-deal.sale_xp) on conflict do nothing;end if;
   if v_id is not null then insert into public.px_notifications(rep_id,title,body) values(deal.rep_id,'Sale verified',deal.package_name||' payment verified. Commission is held for review and settlement.');end if;
  exception when others then insert into public.px_jobs(kind,source_id,error) values('sale_progression',deal.id::text,sqlstate) on conflict do nothing;end;
  insert into public.px_stripe_events(id,type,status) values(p->>'event_id',p->>'event_type','processed') on conflict(id) do update set status='processed',error=null;
 elsif action='event_error' then
  insert into public.px_stripe_events(id,type,status,error) values(p->>'event_id',p->>'event_type','failed',left(p->>'error',300)) on conflict(id) do update set status='failed',error=excluded.error where public.px_stripe_events.status<>'processed';
 elsif action='event_ignored' then
  insert into public.px_stripe_events(id,type,status) values(p->>'event_id',p->>'event_type','ignored') on conflict do nothing;
 elsif action='transfer_result' then
  select c.* into comm from public.px_commissions c join public.px_transfer_requests t on t.commission_id=c.id where t.id=(p->>'request_id')::uuid for update of c;
  if comm.id is null then raise exception 'Transfer request not found.';end if;
  if comm.transfer_id is not null and comm.transfer_id is distinct from p->>'transfer_id' then raise exception 'Transfer already recorded.';end if;
  update public.px_transfer_requests set status=case when p->>'transfer_id' is null then 'uncertain' else 'complete' end,transfer_id=p->>'transfer_id' where id=(p->>'request_id')::uuid;
  update public.px_commissions set status=case when p->>'transfer_id' is null or status='recovery_review' then 'recovery_review' else 'transferred' end,transfer_id=coalesce(p->>'transfer_id',transfer_id) where id=comm.id;
  insert into public.px_commission_events(commission_id,event,amount_cents,external_id,reason) values(comm.id,'transfer_result',case when p->>'transfer_id' is null then 0 else comm.amount_cents end,p->>'transfer_id','Connect transfer result; this is not confirmation of bank payout') on conflict do nothing;
 elsif action='reversal' then
  select * into comm from public.px_commissions where transfer_id=p->>'transfer_id' for update;
  if comm.id is null then raise exception 'Transfer is not attributed to a commission.';end if;
  if exists(select 1 from public.px_commission_events where external_id=p->>'reversal_id') then return '{"duplicate":true}';end if;
  amount:=(p->>'amount_cents')::int;if amount<=0 or comm.reversed_cents+amount>comm.amount_cents then raise exception 'Invalid reversal amount.';end if;
  insert into public.px_commission_events(commission_id,event,amount_cents,external_id,reason) values(comm.id,'reversal',-amount,p->>'reversal_id',coalesce(p->>'reason','Stripe transfer reversal'));
  update public.px_commissions set reversed_cents=reversed_cents+amount,status=case when reversed_cents+amount=amount_cents then 'reversed' else 'recovery_review' end where id=comm.id;
 elsif action='payout' then
  select c.rep_id into v_rep_id from public.px_connect c where account_id=p->>'account_id';
  if v_rep_id is null then raise exception 'Connected account not found.';end if;
  insert into public.px_payouts(id,rep_id,amount_cents,currency,status,arrival_at) values(p->>'id',v_rep_id,(p->>'amount_cents')::int,p->>'currency',p->>'status',(p->>'arrival_at')::timestamptz) on conflict(id) do update set status=excluded.status,arrival_at=excluded.arrival_at,updated_at=now();
 elsif action='tick' then
  insert into public.px_assignments(business_id,rep_id,action) select id,owner_id,'expired' from public.px_businesses where owner_id is not null and expires_at<now() and not customer;
  update public.px_followups set status='cancelled' where status='open' and business_id in (select id from public.px_businesses where expires_at<now() and not customer);
  update public.px_businesses set owner_id=null,claimed_at=null,expires_at=null,first_attempt_at=null where owner_id is not null and expires_at<now() and not customer;
  for data in select to_jsonb(f) from public.px_followups f where status='open' and due_at<=now() and notified_at is null for update skip locked loop
   insert into public.px_notifications(rep_id,title,body) values((data->>'rep_id')::uuid,'Follow-up due',coalesce(data->>'note','Open your follow-ups queue.'));
   update public.px_followups set notified_at=now() where id=(data->>'id')::uuid;
  end loop;
  update public.px_commissions c set status='payable' from public.px_payments py where py.deal_id=c.deal_id and c.status='hold' and not c.manual_hold and c.hold_until<=now() and py.settled and py.refunded_cents=0 and not py.disputed;
  insert into public.px_jobs(kind,source_id,status) values('tick',date_trunc('hour',now())::text,'complete') on conflict do nothing;
  delete from px_private.rate_limits where started_at<now()-interval '2 days';
 else raise exception 'Unknown service action.';end if;
 return '{}';
end $$;
create function public.px_service(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.service(action,p)$$;
revoke execute on function public.px_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.px_service(text,jsonb),px_private.service(text,jsonb) to service_role;
