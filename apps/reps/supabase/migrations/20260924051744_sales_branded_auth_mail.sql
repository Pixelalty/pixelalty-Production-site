-- Delivery state is private. Authentication tokens are never stored in this queue.
create table px_private.mail_outbox (
 id uuid primary key default gen_random_uuid(),
 event_key text not null unique,
 rep_id uuid not null references public.px_reps(id),
 template text not null check(template in ('activated','onboarding')),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','review','cancelled')),
 available_at timestamptz not null default now(),
 lease_until timestamptz,
 lease_token uuid,
 first_attempt_at timestamptz,
 attempts int not null default 0,
 payload jsonb,
 provider_id text,
 error_code text,
 created_at timestamptz not null default now(),
 sent_at timestamptz
);
alter table px_private.mail_outbox enable row level security;
revoke all on px_private.mail_outbox from public,anon,authenticated;
grant all on px_private.mail_outbox to service_role;
create index mail_outbox_ready on px_private.mail_outbox(available_at,created_at) where status in ('pending','sending');
create index mail_outbox_rep on px_private.mail_outbox(rep_id);

create function px_private.queue_onboarding_mail() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.event_key='activated' then
  insert into px_private.mail_outbox(event_key,rep_id,template) values('activated:'||new.rep_id,new.rep_id,'activated') on conflict do nothing;
 elsif new.title='Welcome to Pixelalty' then
  insert into px_private.mail_outbox(event_key,rep_id,template,available_at) values('onboarding:'||new.rep_id,new.rep_id,'onboarding',now()+interval '24 hours') on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function px_private.queue_onboarding_mail() from public,anon,authenticated;
create trigger pixelalty_onboarding_email after insert on public.px_notifications for each row execute function px_private.queue_onboarding_mail();

create function px_private.mail_action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare job px_private.mail_outbox; recipient text; rid uuid; n int; data jsonb;
begin
 if action='resend_begin' then
  perform px_private.require_role(array['sales_admin']);
  if length(trim(coalesce(p->>'reason','')))<5 then raise exception 'Explain why a new setup email is needed.';end if;
  rid:=(p->>'id')::uuid;
  select u.email into recipient from auth.users u join public.px_reps r on r.id=u.id where r.id=rid and r.status in ('active','onboarding');
  if recipient is null then raise exception 'Select an active or onboarding rep.';end if;
  insert into px_private.rate_limits(key) values('setup-email:'||rid) on conflict(key) do update
   set count=case when px_private.rate_limits.started_at<now()-interval '1 hour' then 1 else px_private.rate_limits.count+1 end,
   started_at=case when px_private.rate_limits.started_at<now()-interval '1 hour' then now() else px_private.rate_limits.started_at end returning count into n;
  if n>3 then raise exception 'Please wait before sending another setup email to this rep.';end if;
  perform px_private.audit('rep_setup_email_requested',rid::text,p->>'reason');
  return jsonb_build_object('email',recipient);
 elsif action='summary' then
  perform px_private.require_role(array['owner']);
  return (select jsonb_build_object('pending',count(*) filter(where status in ('pending','sending')),'needs_review',count(*) filter(where status in ('failed','review')),'sent',count(*) filter(where status='sent'),'last_sent_at',max(sent_at)) from px_private.mail_outbox);
 end if;
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501';end if;
 if action='claim' then
  update px_private.mail_outbox set status='review',error_code='delivery_uncertain',lease_until=null
   where status in ('pending','sending') and first_attempt_at<now()-interval '23 hours' and (lease_until is null or lease_until<now());
  update px_private.mail_outbox m set status='cancelled' from public.px_reps r where m.rep_id=r.id and m.status='pending'
   and ((m.template='onboarding' and r.status<>'onboarding') or (m.template='activated' and r.status<>'active'));
  select m.* into job from px_private.mail_outbox m join public.px_reps r on r.id=m.rep_id join auth.users u on u.id=r.id
   where m.status in ('pending','sending') and m.available_at<=now() and (m.lease_until is null or m.lease_until<now())
   and u.email_confirmed_at is not null and u.email is not null
   and ((m.template='onboarding' and r.status='onboarding') or (m.template='activated' and r.status='active'))
   order by m.created_at for update of m skip locked limit 1;
  if job.id is null then return 'null';end if;
  update px_private.mail_outbox set status='sending',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=job.id returning * into job;
  select email into recipient from auth.users where id=job.rep_id;
  return to_jsonb(job)||jsonb_build_object('email',recipient);
 end if;
 select * into job from px_private.mail_outbox where id=(p->>'id')::uuid for update;
 if job.id is null or job.status<>'sending' or job.lease_token is distinct from (p->>'lease_token')::uuid then raise exception 'This delivery lease is no longer current.';end if;
 if action='prepare' then
  if job.first_attempt_at<now()-interval '23 hours' then raise exception 'Review the previous delivery before retrying.';end if;
  if job.payload is null then
   select email into recipient from auth.users where id=job.rep_id;
   data:=p->'payload';
   if jsonb_typeof(data)<>'object' or jsonb_array_length(data->'to')<>1 or data->'to'->>0 is distinct from recipient or octet_length(data::text)>40000 then raise exception 'Invalid email delivery payload.';end if;
   update px_private.mail_outbox set payload=data,first_attempt_at=now() where id=job.id returning * into job;
  end if;
  return job.payload;
 elsif action='sent' then
  if coalesce(length(p->>'provider_id'),0)<3 then raise exception 'Delivery confirmation is required.';end if;
  update px_private.mail_outbox set status='sent',provider_id=left(p->>'provider_id',200),sent_at=now(),lease_until=null,error_code=null where id=job.id;
 elsif action='failed' then
  update px_private.mail_outbox set status=case when coalesce((p->>'permanent')::boolean,false) then 'failed' when attempts>=8 then 'review' else 'pending' end,
   error_code=left(coalesce(p->>'error_code','delivery_failed'),80),lease_until=null,
   available_at=now()+make_interval(mins=>least(360,power(2,least(attempts,8))::int)) where id=job.id;
 else raise exception 'Unknown email action.';end if;
 return '{}';
end $$;
revoke all on function px_private.mail_action(text,jsonb) from public,anon;
grant execute on function px_private.mail_action(text,jsonb) to authenticated,service_role;
create function public.px_mail(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.mail_action(action,p)$$;
revoke all on function public.px_mail(text,jsonb) from public,anon;
grant execute on function public.px_mail(text,jsonb) to authenticated,service_role;
