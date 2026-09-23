create function px_private.context() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501';end if;
 return jsonb_build_object('rep',(select to_jsonb(r) from public.px_reps r where id=auth.uid()),'roles',coalesce((select jsonb_agg(role) from public.px_roles where user_id=auth.uid()),'[]'),'aal',auth.jwt()->>'aal','email_verified',(select email_confirmed_at is not null from auth.users where id=auth.uid()),'settings',(select value from public.px_settings));
end $$;
create function public.px_context() returns jsonb language sql security invoker set search_path='' as $$select px_private.context()$$;
revoke execute on function public.px_context() from public,anon;
grant execute on function public.px_context(),px_private.context() to authenticated;

create function px_private.action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); rid uuid; bid uuid; cid uuid; v_id uuid; count_n int; amount int; score int; n int; xp int:=0; why text:=trim(coalesce(p->>'reason','')); cfg jsonb; data jsonb; result jsonb:='{}';
 rep public.px_reps; lead public.px_businesses; deal public.px_deals; pkg public.px_packages; content public.px_content; comm public.px_commissions; payment public.px_payments; batch public.px_imports; row public.px_import_rows;
begin
 if uid is null then raise exception 'Sign in required.' using errcode='42501';end if;
 select value into cfg from public.px_settings;
 select * into rep from public.px_reps where id=uid for update;
 if action='claim' then
  if rep.id is null or rep.status<>'active' then raise exception 'An active rep account is required.' using errcode='42501';end if;
  select greatest(0,least(coalesce((p->>'count')::int,5),20,rep.capacity-count(*)::int)) into count_n from public.px_businesses where owner_id=uid and not customer and not dnc and not archived;
  for lead in select b.* from public.px_businesses b where b.owner_id is null and not b.dnc and not b.customer and not b.archived and b.stage not in ('lost','won','dnc') and not exists(select 1 from public.px_dnc d where d.phone=b.phone and d.active) order by b.created_at for update skip locked limit count_n loop
   update public.px_businesses set owner_id=uid,claimed_at=now(),expires_at=now()+make_interval(hours=>(cfg->>'first_attempt_hours')::int),first_attempt_at=null where id=lead.id;
   insert into public.px_assignments(business_id,rep_id,action,actor_id) values(lead.id,uid,'claim',uid);
  end loop;
  perform px_private.audit('claim',uid::text);return jsonb_build_object('claimed',count_n);
 end if;

 if action in ('call','followup','deal') then
  select * into lead from public.px_businesses where id=(p->>'business_id')::uuid for update;
  if lead.id is null or lead.owner_id is distinct from uid or rep.status<>'active' or rep.id is null or lead.archived or lead.customer or lead.dnc or lead.expires_at<now() or exists(select 1 from public.px_dnc where phone=lead.phone and active) then raise exception 'This business is not available to you.' using errcode='42501';end if;
  if action='call' then
   select id into v_id from public.px_calls where request_id=(p->>'request_id')::uuid and rep_id=uid;
   if v_id is not null then return jsonb_build_object('id',v_id,'duplicate',true);end if;
   insert into public.px_calls(request_id,rep_id,business_id,outcome,notes,script_id) values((p->>'request_id')::uuid,uid,lead.id,p->>'outcome',coalesce(p->>'notes',''),nullif(p->>'script_id','')::uuid) returning id into v_id;
   if not exists(select 1 from public.px_calls where rep_id=uid and business_id=lead.id and id<>v_id and created_at>now()-interval '24 hours') then
    select count(*) into n from public.px_xp where rep_id=uid and source='call' and created_at::date=current_date;
    if n<(cfg->>'raw_xp_cap')::int then xp:=case when p->>'outcome'='interested' then 10 when p->>'outcome' in ('conversation','meeting','proposal') then 3 else 1 end;end if;
   end if;
   if xp>0 then insert into public.px_xp(rep_id,source,source_id,amount) values(uid,'call',v_id,xp);end if;
   update public.px_businesses set first_attempt_at=coalesce(first_attempt_at,now()),expires_at=greatest(expires_at,now()+make_interval(days=>(cfg->>'ownership_days')::int)),stage=case p->>'outcome' when 'interested' then 'interested' when 'follow_up' then 'follow_up' when 'meeting' then 'meeting' when 'proposal' then 'proposal' when 'sale_reported' then 'proposal' when 'not_interested' then 'lost' when 'do_not_call' then 'dnc' else 'working' end where id=lead.id;
   if p->>'outcome'='do_not_call' then
    insert into public.px_dnc(phone,reason,actor_id) values(lead.phone,'Prospect requested no further contact',uid) on conflict do nothing;
    update public.px_businesses set dnc=true,stage='dnc' where phone=lead.phone;
    update public.px_followups set status='cancelled' where business_id=lead.id and status='open';
   end if;
   perform px_private.audit('call',lead.id::text);return jsonb_build_object('id',v_id,'xp',xp);
  elsif action='followup' then
   if (p->>'due_at')::timestamptz<=now() or (p->>'due_at')::timestamptz>now()+interval '90 days' or not px_private.valid_timezone(p->>'timezone') then raise exception 'Choose a valid timezone and a future time within 90 days.';end if;
   insert into public.px_followups(rep_id,business_id,due_at,timezone,note) values(uid,lead.id,(p->>'due_at')::timestamptz,p->>'timezone',coalesce(p->>'note','')) returning id into v_id;
   update public.px_businesses set stage='follow_up',expires_at=greatest(expires_at,(p->>'due_at')::timestamptz+interval '2 days') where id=lead.id;
   return jsonb_build_object('id',v_id);
  else
   select * into pkg from public.px_packages where id=(p->>'package_id')::uuid and active;
   if pkg.id is null then raise exception 'Choose an active package.';end if;
   amount:=pkg.price_cents;
   if p ? 'price_cents' and (p->>'price_cents')::int<>amount then
    perform px_private.require_role(array['sales_admin']);
    if pkg.code<>'advanced' or (p->>'price_cents')::int<amount or length(why)<5 then raise exception 'Custom pricing requires an Advanced package and a reason.';end if;
    amount:=(p->>'price_cents')::int;
   end if;
   if coalesce(p->>'customer_email','')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'A customer email is required.';end if;
   insert into public.px_deals(rep_id,business_id,package_id,package_name,price_cents,commission_cents,sale_xp,customer_email) values(uid,lead.id,pkg.id,pkg.name,amount,pkg.commission_cents,pkg.sale_xp,lower(p->>'customer_email')) returning id into v_id;
   update public.px_businesses set stage='proposal' where id=lead.id;
   perform px_private.audit('deal',v_id::text,why,jsonb_build_object('price_cents',amount,'commission_cents',pkg.commission_cents));return jsonb_build_object('id',v_id);
  end if;
 end if;
 if action='followup_complete' then
  if not px_private.active() then raise exception 'Active account required.';end if;
  update public.px_followups set status='complete' where id=(p->>'id')::uuid and rep_id=uid and status='open';return '{}';
 end if;
 if action in ('profile','lesson','quiz','agreement','notification_read','support') then
  if rep.id is null then raise exception 'A rep account is required.' using errcode='42501';end if;
  if action='profile' then
   if length(trim(p->>'name'))<2 or not px_private.valid_timezone(p->>'timezone') then raise exception 'Enter your name and a valid timezone.';end if;
   update public.px_reps set name=left(trim(p->>'name'),150),timezone=p->>'timezone',bio=left(coalesce(p->>'bio',''),1000),income_goal=coalesce((p->>'income_goal')::int,0) where id=uid;
  elsif action in ('lesson','quiz','agreement') then
   select * into content from public.px_content where id=(p->>'content_id')::uuid and active and kind=action;
   if content.id is null then raise exception 'This content version is no longer current.';end if;
   if action='agreement' then
    if coalesce((p->>'accepted')::boolean,false) is not true or length(trim(p->>'signature'))<2 then raise exception 'Read the agreement and enter your full name to accept.';end if;
    insert into public.px_agreements(rep_id,content_id,signature) values(uid,content.id,trim(p->>'signature')) on conflict do nothing;
   elsif action='quiz' then
    if exists(select 1 from public.px_training where rep_id=uid and content_id=content.id and created_at>now()-interval '10 seconds') then raise exception 'Wait before trying the quiz again.';end if;
    select answers into data from px_private.quiz_keys where content_id=content.id;
    if data is null or jsonb_typeof(p->'answers')<>'array' or jsonb_array_length(p->'answers')<>jsonb_array_length(data) then raise exception 'Answer every question.';end if;
    select round(100.0*count(*) filter(where a.value=(p->'answers'->(a.ordinality::int-1)))/jsonb_array_length(data))::int into score from jsonb_array_elements(data) with ordinality a;
    insert into public.px_training(rep_id,content_id,score,passed) values(uid,content.id,score,score>=80);
    return jsonb_build_object('score',score,'passed',score>=80);
   else
    if not exists(select 1 from public.px_training where rep_id=uid and content_id=content.id) then insert into public.px_training(rep_id,content_id) values(uid,content.id);end if;
   end if;
  elsif action='notification_read' then update public.px_notifications set read_at=now() where rep_id=uid and id=(p->>'id')::uuid;
  elsif action='support' then
   if length(trim(p->>'subject'))<3 or length(trim(p->>'body'))<5 then raise exception 'Enter a subject and message.';end if;
   insert into public.px_support(rep_id,subject,body) values(uid,left(p->>'subject',200),left(p->>'body',5000));
  end if;
  return '{}';
 end if;

 -- Every administrative mutation is reasoned, checked independently, and audited.
 if length(why)<5 then raise exception 'Enter an audit reason of at least five characters.';end if;
 if action in ('applicant_stage','applicant_note','approval_begin','rep_classification','rep_activate','rep_suspend','assign','import_start','import_stage','import_commit','import_archive','save_view','export','fulfillment') then perform px_private.require_role(array['sales_admin']);
 elsif action in ('commission_hold','commission_release','queue_transfer','package') then perform px_private.require_role(array['finance_admin']);
 elsif action in ('dnc_add','dnc_remove') then perform px_private.require_role(array['compliance_admin']);
 elsif action='content' then perform px_private.require_role(array['content_admin']);
 elsif action='support_reply' then perform px_private.require_role(array['support']);
 else perform px_private.require_role(array['owner']);end if;
 v_id:=nullif(p->>'id','')::uuid;
 if action='applicant_stage' then update public.px_applicants set stage=p->>'stage' where id=v_id and rep_id is null and p->>'stage' in ('new','review','interview','offer','rejected');
 elsif action='applicant_note' then insert into public.px_applicant_notes(applicant_id,author_id,body) values(v_id,uid,p->>'body');
 elsif action='approval_begin' then
  select to_jsonb(a) into result from public.px_applicants a where id=v_id for update;
  if result is null then raise exception 'Applicant not found.';end if;
  update public.px_applicants set stage='approved' where id=v_id;perform px_private.audit('approval_begin',v_id::text,why);return result;
 elsif action='rep_classification' then update public.px_rep_private set classification=p->>'classification',tax_status=p->>'tax_status',external_payout_verified=coalesce((p->>'external_payout_verified')::boolean,false) where rep_id=v_id;
 elsif action='rep_activate' then
  if not exists(select 1 from public.px_reps r join auth.users u on u.id=r.id join public.px_rep_private pr on pr.rep_id=r.id where r.id=v_id and u.email_confirmed_at is not null and pr.classification<>'unconfigured' and (not (cfg->>'require_tax')::boolean or pr.tax_status='verified') and (not (cfg->>'require_payout')::boolean or pr.external_payout_verified or (pr.classification='contractor' and exists(select 1 from public.px_connect c where c.rep_id=v_id and c.transfers_enabled and c.payouts_enabled and c.checked_at>now()-interval '1 day')))) then raise exception 'Profile, verified email, classification, tax status, and payout setup must be complete.';end if;
  if (cfg->>'require_agreement')::boolean and (not exists(select 1 from public.px_content where kind='agreement' and active and required) or exists(select 1 from public.px_content c where c.kind='agreement' and c.active and c.required and not exists(select 1 from public.px_agreements a where a.rep_id=v_id and a.content_id=c.id))) then raise exception 'Accept the current required agreement.';end if;
  if exists(select 1 from public.px_content c where c.kind in ('lesson','quiz') and c.active and c.required and not exists(select 1 from public.px_training t where t.rep_id=v_id and t.content_id=c.id and t.passed)) then raise exception 'Complete required training and pass the quiz.';end if;
  update public.px_reps set status='active' where id=v_id;
 elsif action='rep_suspend' then
  update public.px_reps set status='suspended' where id=v_id;
  update public.px_businesses set owner_id=null,claimed_at=null,expires_at=null where owner_id=v_id and first_attempt_at is null and not customer;
 elsif action='rep_capacity' then update public.px_reps set capacity=(p->>'capacity')::int,team_id=nullif(p->>'team_id','')::uuid where id=v_id;
 elsif action='team' then insert into public.px_teams(name,manager_id) values(p->>'name',(p->>'manager_id')::uuid) returning id into v_id;
 elsif action='role' then
  if p->>'role'='owner' and (p->>'enabled')::boolean is false and v_id=uid then raise exception 'An owner cannot remove their own ownership.';end if;
  if (p->>'enabled')::boolean then insert into public.px_roles(user_id,role) values(v_id,p->>'role') on conflict do nothing;else delete from public.px_roles where user_id=v_id and role=p->>'role';end if;
 elsif action='assign' then
  rid:=(p->>'rep_id')::uuid;select * into rep from public.px_reps where id=rid and status='active' for update;
  if rep.id is null then raise exception 'Select an active rep.';end if;
  select * into lead from public.px_businesses where id=v_id for update;
  if lead.id is null or lead.dnc or lead.customer or lead.archived then raise exception 'This business cannot be assigned.';end if;
  if (select count(*) from public.px_businesses where owner_id=rid and not dnc and not customer and not archived)>=rep.capacity then raise exception 'Rep is at capacity.';end if;
  update public.px_followups set status='cancelled' where business_id=v_id and status='open';
  update public.px_businesses set owner_id=rid,claimed_at=now(),first_attempt_at=null,expires_at=now()+make_interval(hours=>(cfg->>'first_attempt_hours')::int) where id=v_id;
  insert into public.px_assignments(business_id,rep_id,action,actor_id) values(v_id,rid,'manual_assign',uid);
 elsif action='package' then
  select * into pkg from public.px_packages where id=v_id and active for update;
  if pkg.id is null then raise exception 'Package version is no longer current.';end if;
  update public.px_packages set active=false where id=v_id;
  insert into public.px_packages(code,name,version,price_cents,commission_cents,sale_xp) values(pkg.code,pkg.name,pkg.version+1,(p->>'price_cents')::int,(p->>'commission_cents')::int,pkg.sale_xp) returning id into v_id;
 elsif action in ('commission_hold','commission_release','queue_transfer') then
  select * into comm from public.px_commissions where id=v_id for update;
  select * into payment from public.px_payments where deal_id=comm.deal_id;
  if comm.id is null then raise exception 'Commission not found.';end if;
  if action='commission_hold' then
   if comm.status in ('queued','transferred','reversed') then raise exception 'A submitted transfer requires reconciliation or reversal.';end if;
   update public.px_commissions set manual_hold=true,status='hold' where id=v_id;
  elsif action='commission_release' then
   if comm.transfer_id is not null or comm.status='queued' or payment.refunded_cents>0 or payment.disputed then raise exception 'Resolve payment or transfer issues before releasing.';end if;
   update public.px_commissions set manual_hold=false where id=v_id;
  else
   if comm.status='queued' then select to_jsonb(t) into result from public.px_transfer_requests t where commission_id=v_id;return result;end if;
   if comm.status not in ('hold','payable') or comm.hold_until>now() or comm.manual_hold or not payment.settled or payment.refunded_cents>0 or payment.disputed then raise exception 'Commission is not eligible for transfer.';end if;
   if not exists(select 1 from public.px_connect c join public.px_rep_private pr on pr.rep_id=c.rep_id where c.rep_id=comm.rep_id and c.transfers_enabled and c.payouts_enabled and c.checked_at>now()-interval '15 minutes' and pr.classification='contractor' and pr.tax_status='verified') then raise exception 'Verify current contractor tax and Connect setup before transferring.';end if;
   insert into public.px_transfer_requests(commission_id) values(v_id) on conflict(commission_id) do nothing;
   update public.px_commissions set status='queued' where id=v_id;
   select to_jsonb(t) into result from public.px_transfer_requests t where commission_id=v_id;
  end if;
  insert into public.px_commission_events(commission_id,event,reason,actor_id) values(v_id,action,why,uid);
 elsif action='dnc_add' then
  if p->>'phone'!~'^\+[0-9]{11,15}$' then raise exception 'Provide a normalized phone number.';end if;
  insert into public.px_dnc(phone,reason,actor_id) values(p->>'phone',why,uid) on conflict do nothing;
  update public.px_businesses set dnc=true,stage='dnc' where phone=p->>'phone';
  update public.px_followups set status='cancelled' where status='open' and business_id in (select id from public.px_businesses where phone=p->>'phone');
 elsif action='dnc_remove' then
  update public.px_dnc set active=false where id=v_id returning phone into why;
  update public.px_businesses set dnc=false,stage='new',owner_id=null,claimed_at=null,expires_at=null where phone=why;why:=p->>'reason';
 elsif action='settings' then
  data:=p->'value';if data is null or (data->>'hold_days')::int not between 0 and 90 or (data->>'first_attempt_hours')::int not between 1 and 720 or (data->>'ownership_days')::int not between 1 and 90 or (data->>'call_start')::int not between 0 and 23 or (data->>'call_end')::int not between 1 and 24 or (data->>'call_start')::int>=(data->>'call_end')::int or (data->>'auto_transfers')::boolean is true then raise exception 'Invalid settings. Automatic transfers remain disabled.';end if;
  update public.px_settings set value=cfg||data||'{"auto_transfers":false}';
 elsif action='content' then
  if p->>'kind'='agreement' then perform px_private.require_role(array['owner']);end if;
  perform pg_advisory_xact_lock(hashtext(p->>'kind'||':'||p->>'slug'));
  select coalesce(max(version),0)+1 into n from public.px_content where kind=p->>'kind' and slug=p->>'slug';
  update public.px_content set active=false where kind=p->>'kind' and slug=p->>'slug' and active;
  insert into public.px_content(kind,slug,title,body,version,required) values(p->>'kind',p->>'slug',p->>'title',p->>'body',n,coalesce((p->>'required')::boolean,false)) returning id into v_id;
  if p->>'kind'='quiz' then
   if jsonb_typeof(p->'answers')<>'array' or jsonb_array_length(p->'answers')=0 then raise exception 'Quiz answer key is required.';end if;
   insert into px_private.quiz_keys(content_id,answers) values(v_id,p->'answers');
  end if;
 elsif action='support_reply' then update public.px_support set reply=left(p->>'reply',5000),status=p->>'status' where id=v_id;
 elsif action='fulfillment' then update public.px_fulfillment set status=p->>'status',notes=left(p->>'notes',5000) where id=v_id;
 elsif action='save_view' then insert into public.px_saved_views(owner_id,name,kind,config) values(uid,p->>'name',p->>'kind',p->'config') returning id into v_id;
 elsif action='import_start' then insert into public.px_imports(owner_id,filename,mapping,total) values(uid,left(p->>'filename',250),p->'mapping',(p->>'total')::int) returning id into v_id;
 elsif action='import_stage' then
  select * into batch from public.px_imports where id=v_id for update;
  if batch.status<>'staging' or jsonb_array_length(p->'rows')>250 then raise exception 'Import cannot accept these rows.';end if;
  for data in select value from jsonb_array_elements(p->'rows') loop
   if (data->>'row_num')::int<1 or (data->>'row_num')::int>batch.total then raise exception 'Invalid import row number.';end if;
   insert into public.px_import_rows(batch_id,row_num,data,error) values(v_id,(data->>'row_num')::int,data->'data',data->>'error') on conflict do nothing;
  end loop;
  if (select count(*) from public.px_import_rows where batch_id=v_id)=batch.total then update public.px_imports set status='ready' where id=v_id;end if;
 elsif action='import_commit' then
  select * into batch from public.px_imports where id=v_id for update;
  if batch.status not in ('ready','complete') then raise exception 'Finish staging the entire import first.';end if;
  for row in select * from public.px_import_rows where batch_id=v_id and status='pending' order by row_num limit 200 for update loop
   why:=row.error;data:=row.data;
   if why is null then
    if exists(select 1 from public.px_dnc where phone=data->>'phone' and active) then why:='Do not contact';
    elsif exists(select 1 from public.px_businesses where phone=data->>'phone' or (domain<>'' and domain=data->>'domain')) then why:='Duplicate phone or website';
    elsif not px_private.valid_timezone(data->>'timezone') then why:='Invalid timezone';
    else begin
     insert into public.px_businesses(name,phone,domain,email,timezone,city,state,industry,contact,notes,import_id) values(data->>'name',data->>'phone',coalesce(data->>'domain',''),coalesce(data->>'email',''),data->>'timezone',coalesce(data->>'city',''),coalesce(data->>'state',''),coalesce(data->>'industry',''),coalesce(data->>'contact',''),coalesce(data->>'notes',''),v_id);
    exception when unique_violation then why:='Duplicate phone or website';when check_violation or not_null_violation then why:='Invalid business data';end;end if;
   end if;
   update public.px_import_rows set error=why,status=case when why is null then 'accepted' else 'rejected' end where batch_id=v_id and row_num=row.row_num;
  end loop;
  if not exists(select 1 from public.px_import_rows where batch_id=v_id and status='pending') then update public.px_imports set status='complete' where id=v_id;end if;
  select jsonb_build_object('accepted',count(*) filter(where status='accepted'),'rejected',count(*) filter(where status='rejected'),'pending',count(*) filter(where status='pending')) into result from public.px_import_rows where batch_id=v_id;
  why:=p->>'reason';
 elsif action='import_archive' then
  update public.px_imports set status='archived' where id=v_id;
  update public.px_businesses set archived=true where import_id=v_id and owner_id is null and first_attempt_at is null and not customer;
 elsif action='export' then null;
 else raise exception 'Unknown action.';end if;
 perform px_private.audit(action,coalesce(v_id::text,''),why);return jsonb_build_object('id',v_id)||result;
end $$;
create function public.px_action(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.action(action,p)$$;
revoke execute on function public.px_action(text,jsonb) from public,anon;
grant execute on function public.px_action(text,jsonb),px_private.action(text,jsonb) to authenticated;
