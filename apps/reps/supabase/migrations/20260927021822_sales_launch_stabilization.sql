-- Additive stabilization. History is attached to a durable, non-login identity;
-- removing Auth access must never remove accounting or tax evidence.
create table px_private.identities(id uuid primary key,created_at timestamptz not null default now());
alter table px_private.identities enable row level security;
revoke all on px_private.identities from public,anon,authenticated;
insert into px_private.identities(id) select id from auth.users on conflict do nothing;
create function px_private.identity_created() returns trigger language plpgsql security definer set search_path='' as $$begin insert into px_private.identities(id) values(new.id) on conflict do nothing;return new;end$$;
create trigger pixelalty_identity_created after insert on auth.users for each row execute function px_private.identity_created();
-- Only this application's FKs change. Supabase and customer-site objects stay intact.
do $$declare c record;begin
 for c in select n.nspname,t.relname,k.conname,a.attname from pg_constraint k join pg_class t on t.oid=k.conrelid join pg_namespace n on n.oid=t.relnamespace join pg_attribute a on a.attrelid=t.oid and a.attnum=k.conkey[1] where k.contype='f' and k.confrelid='auth.users'::regclass and (n.nspname='px_private' or (n.nspname='public' and t.relname like 'px\_%' escape '\')) loop
  execute format('alter table %I.%I drop constraint %I',c.nspname,c.relname,c.conname);
  execute format('alter table %I.%I add constraint %I foreign key(%I) references px_private.identities(id)',c.nspname,c.relname,c.conname,c.attname);
 end loop;
end$$;

create table px_private.account_access(user_id uuid primary key references px_private.identities(id),revoked_before timestamptz,deleted_at timestamptz,pending_email text);
alter table px_private.account_access enable row level security;
revoke all on px_private.account_access from public,anon,authenticated;
create function px_private.account_allowed() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from auth.users where id=auth.uid()) and not exists(select 1 from px_private.account_access a where a.user_id=auth.uid() and (a.deleted_at is not null or (a.revoked_before is not null and not exists(select 1 from auth.sessions s where s.user_id=a.user_id and s.id::text=auth.jwt()->>'session_id' and s.created_at>a.revoked_before))));
$$;
grant execute on function px_private.account_allowed() to authenticated;
create function px_private.require_access() returns void language plpgsql security definer set search_path='' as $$begin if not px_private.account_allowed() then raise exception 'Your session has ended. Sign in again.' using errcode='42501';end if;end$$;
create function public.px_session_check() returns boolean language sql security invoker set search_path='' as $$select px_private.account_allowed()$$;
revoke all on function public.px_session_check() from public,anon;grant execute on function public.px_session_check() to authenticated;
create or replace function px_private.has_role(roles text[]) returns boolean language sql stable security definer set search_path='' as $$select px_private.account_allowed() and coalesce(auth.jwt()->>'aal','')='aal2' and exists(select 1 from public.px_roles where user_id=auth.uid() and (role='owner' or role=any(roles)))$$;
do $$declare t record;begin for t in select tablename from pg_tables where schemaname='public' and tablename like 'px\_%' escape '\' loop execute format('create policy pixelalty_session_access on public.%I as restrictive for all to authenticated using ((select px_private.account_allowed())) with check ((select px_private.account_allowed()))',t.tablename);end loop;end$$;

create table public.px_diagnostics(id uuid primary key,user_id uuid references px_private.identities(id),route text not null,category text not null,status int not null,provider_request_id text,created_at timestamptz not null default now());
alter table public.px_diagnostics enable row level security;
revoke all on public.px_diagnostics from public,anon,authenticated;
grant select on public.px_diagnostics to authenticated;grant all on public.px_diagnostics to service_role;
create policy diagnostics_admin on public.px_diagnostics for select to authenticated using(px_private.has_role(array['sales_admin','finance_admin']));
create index px_diagnostics_latest on public.px_diagnostics(created_at desc);
create index px_diagnostics_user on public.px_diagnostics(user_id);

alter table public.px_connect_requests add column generation uuid;
create table px_private.connect_archive(account_id text primary key,rep_id uuid not null references px_private.identities(id),created_at timestamptz not null default now());
alter table px_private.connect_archive enable row level security;
revoke all on px_private.connect_archive from public,anon,authenticated;
create index px_connect_archive_rep on px_private.connect_archive(rep_id);
alter table public.px_stripe_events add column channel text check(channel in ('platform','connect'));
alter table public.px_stripe_events add column account_id text;
alter table public.px_stripe_events add column last_received_at timestamptz;

alter function px_private.service_guard(text,jsonb) rename to service_before_launch;
revoke all on function px_private.service_before_launch(text,jsonb) from public,anon,authenticated,service_role;
create function px_private.service_guard(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.px_connect_requests;rid uuid;out jsonb;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501';end if;
 if action='diagnostic' then
  insert into public.px_diagnostics(id,user_id,route,category,status,provider_request_id) values((p->>'id')::uuid,nullif(p->>'user_id','')::uuid,left(p->>'route',100),left(p->>'category',80),(p->>'status')::int,left(p->>'provider_request_id',80)) on conflict do nothing;return '{}';
 elsif action='connect_begin' then
  rid:=(p->>'rep_id')::uuid;
  perform 1 from public.px_reps rr join public.px_rep_private pr on pr.rep_id=rr.id where rr.id=rid and rr.status in ('onboarding','active') and pr.classification='contractor' for update of rr;
  if not found then raise exception 'An eligible contractor profile is required.';end if;
  insert into public.px_connect_requests(rep_id) values(rid) on conflict do nothing;
  select * into r from public.px_connect_requests where rep_id=rid;
  if r.account_id is null and r.started_at<now()-interval '23 hours' then raise exception 'Reconcile the previous Connect account attempt before creating another.';end if;
  return jsonb_build_object('needs_reconcile',false,'idempotency_key','connect:'||rid::text||case when r.generation is null then '' else ':'||r.generation::text end);
 elsif action='connect_reset' then
  rid:=(p->>'rep_id')::uuid;
  perform 1 from public.px_reps where id=rid for update;
  if not exists(select 1 from public.px_roles where user_id=(p->>'actor_id')::uuid and role in ('owner','finance_admin')) or length(trim(p->>'reason'))<5 then raise exception 'Finance authorization and reason required.';end if;
  if exists(select 1 from public.px_connect_requests where rep_id=rid and started_at>now()-interval '10 minutes' and account_id is null) then raise exception 'A setup attempt is still recent. Retry its existing setup, or wait ten minutes before recovery.';end if;
  if exists(select 1 from public.px_commissions where rep_id=rid) or exists(select 1 from public.px_payouts where rep_id=rid) then raise exception 'Protected payout history requires Finance reconciliation.';end if;
  insert into px_private.connect_archive(account_id,rep_id) select account_id,rep_id from public.px_connect where rep_id=rid on conflict do nothing;
  delete from public.px_connect where rep_id=rid;
  insert into public.px_connect_requests(rep_id,generation) values(rid,gen_random_uuid()) on conflict(rep_id) do update set generation=gen_random_uuid(),started_at=now(),account_id=null;
  insert into public.px_audit(actor_id,action,target_id,reason,details) values((p->>'actor_id')::uuid,action,rid::text,p->>'reason',jsonb_build_object('after','fresh attempt available','before','provider search found no matching account'));
  return '{}';
 elsif action='connect' then
  if exists(select 1 from px_private.connect_archive where account_id=p->>'account_id') or not exists(select 1 from public.px_reps where id=(p->>'rep_id')::uuid and status in ('onboarding','active')) then return '{"unattributed":true}';end if;
 elsif action='event_received' then
  insert into public.px_stripe_events(id,type,status,channel,account_id,last_received_at) values(p->>'event_id',p->>'event_type','processing',p->>'channel',p->>'account_id',now()) on conflict(id) do update set channel=excluded.channel,account_id=excluded.account_id,last_received_at=now();return '{}';
 elsif action='event_ignored' then
  insert into public.px_stripe_events(id,type,status) values(p->>'event_id',p->>'event_type','processed') on conflict(id) do update set status='processed',error=null;return '{}';
 elsif action='event_unattributed' then
  update public.px_stripe_events set status='unattributed',error=p->>'category' where id=p->>'event_id';return '{}';
 end if;
 return px_private.service_before_launch(action,p);
end$$;
grant execute on function px_private.service_guard(text,jsonb) to service_role;

-- XP remains an append-only, idempotent event ledger. Corrections never edit totals.
alter table public.px_xp add column reason text not null default '';
alter table public.px_xp add column actor_id uuid references px_private.identities(id);
create index px_xp_actor on public.px_xp(actor_id);
create or replace function px_private.prepare_xp() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg jsonb;outcome text;total int;zone text;
begin
 select value into cfg from public.px_settings;
 if new.source='call' then
  perform 1 from public.px_reps where id=new.rep_id for update;
  select timezone into zone from public.px_reps where id=new.rep_id;
  select c.outcome into outcome from public.px_calls c where c.id=new.source_id and c.qualifying;
  if outcome is null then return null;end if;
  select coalesce(sum(amount),0) into total from public.px_xp where rep_id=new.rep_id and source='call' and (created_at at time zone zone)::date=(now() at time zone zone)::date;
  new.amount:=greatest(0,least((cfg->>'raw_xp_cap')::int-total,(cfg->>case when outcome='interested' then 'xp_interested' when outcome in ('conversation','meeting','proposal') then 'xp_conversation' else 'xp_attempt' end)::int));
 elsif new.source='training' and not exists(select 1 from public.px_content where id=new.source_id and kind='lesson' and required) then return null;
 elsif new.source='first_call' and not exists(select 1 from public.px_calls where rep_id=new.rep_id and qualifying) then return null;
 end if;return new;
end$$;

create table px_private.account_deletions(user_id uuid primary key references px_private.identities(id),actor_id uuid not null references px_private.identities(id),account_code text not null,reason text not null,mode text not null check(mode in ('purge','retain')),status text not null check(status in ('prepared','purging','complete')),created_at timestamptz not null default now(),completed_at timestamptz);
alter table px_private.account_deletions enable row level security;
revoke all on px_private.account_deletions from public,anon,authenticated;
create index px_account_deletions_actor on px_private.account_deletions(actor_id);
alter table public.px_reps add column deleted_at timestamptz;
alter table public.px_rep_private add column legal_name text not null default '';
alter table public.px_rep_private add column tier text not null default 'standard';
alter table public.px_rep_private add column access_overrides jsonb not null default '{}';
alter table public.px_rep_private add column customization_unlocks jsonb not null default '[]';
create function px_private.protected_history(rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.px_deals where rep_id=rid)
 or exists(select 1 from public.px_commissions where rep_id=rid)
 or exists(select 1 from public.px_payouts where rep_id=rid)
 or exists(select 1 from public.px_agreements where rep_id=rid)
 or exists(select 1 from px_private.tax_documents where rep_id=rid and submitted_at is not null)
 or exists(select 1 from public.px_calls where rep_id=rid)
 or exists(select 1 from public.px_notes where author_id=rid)
 or exists(select 1 from public.px_businesses where owner_id=rid and customer);
$$;
-- Training, XP and assignment rows are disposable only during an authorized purge
-- with no protected history. Every other immutable table stays immutable.
create or replace function px_private.immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='DELETE' and TG_TABLE_SCHEMA='public' and TG_TABLE_NAME in ('px_training','px_xp','px_assignments') then
  if exists(select 1 from px_private.account_deletions where user_id=(to_jsonb(old)->>'rep_id')::uuid and mode='purge' and status='purging') then return old;end if;
 end if;
 raise exception 'This record is append-only.';
end$$;


create table px_private.progression_events(id uuid primary key default gen_random_uuid(),rep_id uuid not null references px_private.identities(id),actor_id uuid not null references px_private.identities(id),kind text not null check(kind in ('streak','freeze','achievement')),amount int not null,achievement text,reason text not null,request_id uuid not null unique,created_at timestamptz not null default now());
alter table px_private.progression_events enable row level security;
revoke all on px_private.progression_events from public,anon,authenticated;
create index px_progression_rep on px_private.progression_events(rep_id,created_at);
create index px_progression_actor on px_private.progression_events(actor_id);
create trigger append_only before update or delete on px_private.progression_events for each row execute function px_private.immutable();
create function px_private.progress_summary(rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('streak_adjustment',(select coalesce(sum(amount),0) from px_private.progression_events where rep_id=rid and kind='streak'),'freeze_adjustment',(select coalesce(sum(amount),0) from px_private.progression_events where rep_id=rid and kind='freeze' and created_at>=date_trunc('month',now())),
 'achievements',(select coalesce(jsonb_agg(key),'[]') from (select key,coalesce((select e.amount>0 from px_private.progression_events e where e.rep_id=rid and kind='achievement' and achievement=key order by created_at desc,id desc limit 1),earned) enabled from (
 select 'first_call' key,exists(select 1 from public.px_calls where rep_id=rid and qualifying) earned
 union all select 'first_sale',exists(select 1 from public.px_deals d join public.px_payments py on py.deal_id=d.id where d.rep_id=rid and py.refunded_cents=0 and not py.disputed)
 union all select 'trained',exists(select 1 from public.px_content where kind='lesson' and required and active) and not exists(select 1 from public.px_content c where kind='lesson' and required and active and not exists(select 1 from public.px_training t where t.rep_id=rid and t.content_id=c.id and t.passed))
 ) a) b where enabled));
$$;
alter function px_private.streak_summary(uuid) rename to streak_before_launch;
revoke all on function px_private.streak_before_launch(uuid) from public,anon,authenticated;
create function px_private.streak_summary(rid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare base jsonb;extra jsonb;allocation int;used int;begin
 base:=px_private.streak_before_launch(rid);extra:=px_private.progress_summary(rid);
 select (value->>'streak_freezes')::int into allocation from public.px_settings;
 select count(*) into used from public.px_streak_freezes where rep_id=rid and day>=date_trunc('month',now() at time zone coalesce(base->>'timezone','UTC'))::date;
 return base||jsonb_build_object('current',greatest(0,coalesce((base->>'current')::int,0)+(extra->>'streak_adjustment')::int),'freezes_left',greatest(0,allocation+(extra->>'freeze_adjustment')::int-used));
end$$;

alter function px_private.action(text,jsonb) rename to action_before_launch;
revoke all on function px_private.action_before_launch(text,jsonb) from public,anon,authenticated;
create function px_private.action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; r public.px_reps;old_data jsonb;after_data jsonb;why text:=trim(coalesce(p->>'reason','')); mode text;amt int;out jsonb;
begin
 perform px_private.require_access();
 if action='role' then perform 1 from public.px_settings for update;end if;
 if action in ('role','rep_classification','rep_capacity','rep_suspend','rep_activate','rep_offboard') and exists(select 1 from public.px_reps where id=(p->>'id')::uuid and deleted_at is not null) then raise exception 'This account has been deleted.';end if;
 if action='role' and not exists(select 1 from auth.users where id=(p->>'id')::uuid) then raise exception 'Select an existing login account.';end if;
 if action in ('role','rep_suspend') then
  if length(why)<5 then raise exception 'Enter an audit reason of at least 5 characters.';end if;
  rid:=(p->>'id')::uuid;
  old_data:=jsonb_build_object('roles',(select coalesce(jsonb_agg(role),'[]') from public.px_roles where user_id=rid),'status',(select status from public.px_reps where id=rid));
  out:=px_private.action_before_launch(action,p);
  after_data:=jsonb_build_object('roles',(select coalesce(jsonb_agg(role),'[]') from public.px_roles where user_id=rid),'status',(select status from public.px_reps where id=rid));
  perform px_private.audit('account_'||action,rid::text,why,jsonb_build_object('before',old_data,'after',after_data));return out;
 end if;
 if action='streak_freeze' then
  select * into r from public.px_reps where id=auth.uid() and status='active' for update;
  if r.id is null then raise exception 'An active rep account is required.';end if;
  if (p->>'day')::date not between (now() at time zone r.timezone)::date-1 and (now() at time zone r.timezone)::date or extract(isodow from (p->>'day')::date)>5 then raise exception 'A freeze can protect today or yesterday on a workday.';end if;
  if exists(select 1 from public.px_streak_freezes where rep_id=r.id and day=(p->>'day')::date) then return '{}';end if;
  if (px_private.streak_summary(r.id)->>'freezes_left')::int<1 then raise exception 'No freezes remain for this month.';end if;
  insert into public.px_streak_freezes(rep_id,day) values(r.id,(p->>'day')::date);return '{}';
 end if;
 if action not in ('account_edit','account_delete_begin','account_purge_begin','account_revoke','account_email_request','xp_adjust','account_unlocks','account_access_options','account_release_leads','progression_adjust') then return px_private.action_before_launch(action,p);end if;
 if action in ('account_delete_begin','account_purge_begin','account_revoke','account_email_request','account_unlocks','account_access_options') then perform px_private.require_role(array['owner']);else perform px_private.require_role(array['sales_admin']);end if;
 if length(why)<5 or length(why)>1000 then raise exception 'Enter an audit reason between 5 and 1000 characters.';end if;
 rid:=(p->>'id')::uuid;
 select * into r from public.px_reps where id=rid for update;
 if r.id is null then
  if action not in ('account_delete_begin','account_purge_begin','account_revoke','account_email_request') or not exists(select 1 from px_private.identities where id=rid) or not (exists(select 1 from auth.users where id=rid) or exists(select 1 from px_private.account_deletions where user_id=rid)) then raise exception 'Account not found.';end if;
  perform 1 from px_private.identities where id=rid for update;
  r.code:=coalesce((select account_code from px_private.account_deletions where user_id=rid),'ACCOUNT '||rid::text);
 end if;
 if r.deleted_at is not null and action not in ('account_delete_begin','account_purge_begin') then raise exception 'This account has been deleted.';end if;
 if action='xp_adjust' then
  amt:=(p->>'amount')::int;
  if amt is null or amt=0 or abs(amt::bigint)>1000000 then raise exception 'Enter a non-zero whole-number XP adjustment within one million.';end if;
  if (p->>'request_id') is null then raise exception 'An adjustment request reference is required.';end if;
  if exists(select 1 from public.px_xp where rep_id=rid and source='ADMIN_CORRECTION' and source_id=(p->>'request_id')::uuid) then
   if exists(select 1 from public.px_xp where rep_id=rid and source='ADMIN_CORRECTION' and source_id=(p->>'request_id')::uuid and (amount<>amt or reason<>why)) then raise exception 'This adjustment reference already belongs to a different correction.';end if;
   return '{}';
  end if;
  select jsonb_build_object('xp',coalesce(sum(amount),0)) into old_data from public.px_xp where rep_id=rid;
  insert into public.px_xp(rep_id,source,source_id,amount,reason,actor_id) values(rid,'ADMIN_CORRECTION',(p->>'request_id')::uuid,amt,why,auth.uid());
  select jsonb_build_object('xp',coalesce(sum(amount),0)) into after_data from public.px_xp where rep_id=rid;
 elsif action='account_edit' then
  old_data:=to_jsonb(r);
  if not px_private.valid_timezone(p->>'timezone') or length(trim(p->>'name')) not between 2 and 150 or length(coalesce(p->>'bio',''))>2000 then raise exception 'Enter a name, valid timezone, and profile description up to 2000 characters.';end if;
  update public.px_reps set name=trim(p->>'name'),timezone=p->>'timezone',bio=coalesce(p->>'bio',''),capacity=(p->>'capacity')::int,team_id=nullif(p->>'team_id','')::uuid,income_goal=(p->>'income_goal')::int,preferences=preferences||jsonb_build_object('sales_goal',greatest(0,(p->>'sales_goal')::int),'calls_goal',greatest(0,(p->>'calls_goal')::int)) where id=rid;
  old_data:=old_data||jsonb_build_object('private',(select to_jsonb(x)-'email' from public.px_rep_private x where rep_id=rid));
  if length(coalesce(p->>'legal_name',''))>150 or coalesce(p->>'tier','standard') not in ('standard','senior','lead') then raise exception 'Enter a valid admin name and tier.';end if;
  update public.px_rep_private set legal_name=coalesce(p->>'legal_name',''),tier=coalesce(p->>'tier','standard') where rep_id=rid;
  select to_jsonb(x) into after_data from public.px_reps x where id=rid;
  after_data:=after_data||jsonb_build_object('private',(select to_jsonb(x)-'email' from public.px_rep_private x where rep_id=rid));
 elsif action='account_release_leads' then
  old_data:=jsonb_build_object('assigned',(select count(*) from public.px_businesses where owner_id=rid and not customer));
  insert into public.px_assignments(business_id,rep_id,action,actor_id) select id,rid,'admin_release',auth.uid() from public.px_businesses where owner_id=rid and not customer;
  update public.px_businesses set owner_id=null,claimed_at=null,expires_at=null where owner_id=rid and not customer;
  update public.px_followups set status='cancelled' where rep_id=rid and status='open';after_data:='{"assigned":0}';
 elsif action='progression_adjust' then
  amt:=(p->>'amount')::int;
  if p->>'kind' not in ('streak','freeze','achievement') or amt is null or amt=0 or abs(amt::bigint)>1000 then raise exception 'Choose a supported non-zero correction within 1000.';end if;
  if p->>'kind'='achievement' and (p->>'achievement' not in ('first_call','first_sale','trained') or abs(amt)<>1) then raise exception 'Choose an achievement and grant (+1) or revoke (-1).';end if;
  old_data:=jsonb_build_object('progress',px_private.progress_summary(rid));
  if exists(select 1 from px_private.progression_events where request_id=(p->>'request_id')::uuid and (rep_id<>rid or kind<>p->>'kind' or amount<>amt or reason<>why)) then raise exception 'This correction reference belongs to a different adjustment.';end if;
  insert into px_private.progression_events(rep_id,actor_id,kind,amount,achievement,reason,request_id) values(rid,auth.uid(),p->>'kind',amt,case when p->>'kind'='achievement' then p->>'achievement' else null end,why,(p->>'request_id')::uuid) on conflict do nothing;
  after_data:=jsonb_build_object('progress',px_private.progress_summary(rid));
 elsif action='account_access_options' then
  old_data:=(select access_overrides from public.px_rep_private where rep_id=rid);
  after_data:=jsonb_build_object('leaderboard',coalesce((p->>'leaderboard')::boolean,true),'profile_frames',coalesce((p->>'profile_frames')::boolean,false));
  update public.px_rep_private set access_overrides=after_data where rep_id=rid;
 elsif action='account_unlocks' then
  if jsonb_typeof(p->'value')<>'object' or length((p->'value')::text)>1000 then raise exception 'Choose supported access preferences.';end if;
  if exists(select 1 from jsonb_each(p->'value') where key not in ('leaderboard','profile_frames') or jsonb_typeof(value)<>'boolean') then raise exception 'Only supported access overrides can be edited.';end if;
  select access_overrides into old_data from public.px_rep_private where rep_id=rid;
  update public.px_rep_private set access_overrides=p->'value' where rep_id=rid;after_data:=p->'value';
 elsif action='account_email_request' then
  if coalesce(p->>'email','') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(p->>'email')>254 then raise exception 'Enter a valid email address.';end if;
  old_data:=jsonb_build_object('pending_email',(select pending_email from px_private.account_access where user_id=rid));
  insert into px_private.account_access(user_id,pending_email) values(rid,lower(trim(p->>'email'))) on conflict(user_id) do update set pending_email=excluded.pending_email;
  insert into public.px_notifications(rep_id,title,body,link) values(rid,'Confirm your email change','Pixelalty has requested an email update. Review and confirm it from your account settings.','/profile');after_data:=jsonb_build_object('pending_email',lower(trim(p->>'email')));
 elsif action='account_revoke' then
  old_data:=jsonb_build_object('sessions',(select count(*) from auth.sessions where user_id=rid));
  insert into px_private.account_access(user_id,revoked_before) values(rid,now()) on conflict(user_id) do update set revoked_before=now();
  -- Existing JWTs and refresh tokens both lose access immediately.
  delete from auth.sessions where user_id=rid;
  after_data:='{"sessions":"revoked"}';
 elsif action in ('account_delete_begin','account_purge_begin') then
  -- Serialize Owner removals so two concurrent requests cannot remove every Owner.
  perform 1 from public.px_settings for update;
  if coalesce(p->>'confirmation','')<>(case when action='account_purge_begin' then 'PURGE TEST DATA ' else 'DELETE ' end||r.code) then raise exception 'Type the exact confirmation shown.';end if;
  if exists(select 1 from public.px_roles where user_id=rid and role='owner') and not exists(select 1 from public.px_roles ro join auth.users u on u.id=ro.user_id where ro.user_id<>rid and ro.role='owner' and not exists(select 1 from px_private.account_access a where a.user_id=ro.user_id and a.deleted_at is not null)) then raise exception 'Assign another Owner before deleting the final Owner account.';end if;
  if exists(select 1 from px_private.account_deletions where user_id=rid) then return (select to_jsonb(d) from px_private.account_deletions d where user_id=rid);end if;
  mode:=case when px_private.protected_history(rid) then 'retain' else 'purge' end;
  if action='account_purge_begin' and mode<>'purge' then raise exception 'Protected history cannot be purged. Delete Account will permanently remove access and retain required records.';end if;
  old_data:=jsonb_build_object('status',r.status,'mode',mode);
  insert into px_private.account_deletions(user_id,actor_id,account_code,reason,mode,status) values(rid,auth.uid(),r.code,why,mode,'prepared');
  insert into px_private.account_access(user_id,revoked_before,deleted_at) values(rid,now(),now()) on conflict(user_id) do update set revoked_before=now(),deleted_at=now(),pending_email=null;
  update public.px_reps set status='offboarded',deleted_at=now() where id=rid;
  delete from public.px_roles where user_id=rid;
  update public.px_teams set manager_id=null where manager_id=rid;
  delete from auth.sessions where user_id=rid;
  update px_private.mail_outbox set status='cancelled',payload=null,lease_token=null,lease_until=null where rep_id=rid;
  update public.px_businesses set owner_id=null,claimed_at=null,expires_at=null where owner_id=rid and not customer;
  update public.px_followups set status='cancelled' where rep_id=rid and status='open';
  after_data:=jsonb_build_object('status','access_revoked','mode',mode);
 end if;
 perform px_private.audit(action,rid::text,why,jsonb_build_object('before',old_data,'after',after_data));
 return coalesce(after_data,'{}');
end$$;
grant execute on function px_private.action(text,jsonb) to authenticated;

create function public.px_account_complete(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid:=(p->>'id')::uuid;d px_private.account_deletions;key text;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501';end if;
 select * into d from px_private.account_deletions where user_id=rid for update;
 if d.user_id is null then raise exception 'An authorized deletion request is required.';end if;
 if exists(select 1 from auth.users where id=rid) then raise exception 'Authentication removal must finish before account cleanup.';end if;
 if d.status='complete' then return jsonb_build_object('deleted',true,'mode',d.mode);end if;
 if d.mode='purge' and px_private.protected_history(rid) then update px_private.account_deletions set mode='retain' where user_id=rid;d.mode:='retain';end if;
 if d.mode='purge' then
  if exists(select 1 from storage.objects o join px_private.tax_documents t on o.bucket_id='pixelalty-tax-documents' and o.name=t.object_key where t.rep_id=rid) then raise exception 'Private file cleanup must finish first.';end if;
  update px_private.account_deletions set status='purging' where user_id=rid;
  delete from public.px_training where rep_id=rid;delete from public.px_xp where rep_id=rid;delete from public.px_assignments where rep_id=rid;
  delete from public.px_followups where rep_id=rid;delete from public.px_favorites where rep_id=rid;delete from public.px_focus_sessions where rep_id=rid;delete from public.px_streak_freezes where rep_id=rid;
  delete from public.px_notifications where rep_id=rid;delete from public.px_support where rep_id=rid;
  delete from public.px_quote_requests where rep_id=rid;
  delete from public.px_applicant_notes where applicant_id in (select id from public.px_applicants where rep_id=rid);
  delete from public.px_applicants where rep_id=rid;
  delete from public.px_saved_views where owner_id=rid;
  insert into px_private.connect_archive(account_id,rep_id) select account_id,rep_id from public.px_connect where rep_id=rid on conflict do nothing;
  delete from public.px_connect where rep_id=rid;delete from public.px_connect_requests where rep_id=rid;
  delete from px_private.tax_documents where rep_id=rid;
  delete from px_private.mail_outbox where rep_id=rid;
  delete from public.px_rep_private where rep_id=rid;
  delete from public.px_reps where id=rid;
 else
  update public.px_reps set name='Deleted account',bio='',timezone='UTC',preferences='{}',income_goal=0,team_id=null where id=rid;
  update public.px_rep_private set email='',legal_name='',access_overrides='{}',customization_unlocks='[]' where rep_id=rid;
  update public.px_applicants set name='Deleted account',email='deleted-'||id::text||'@invalid.pixelalty',details='{}',tags='{}',stage='inactive' where rep_id=rid;
  update px_private.mail_outbox set status='cancelled',payload=null,lease_token=null,lease_until=null where rep_id=rid;
  delete from public.px_notifications where rep_id=rid;delete from public.px_favorites where rep_id=rid;delete from public.px_saved_views where owner_id=rid;
 end if;
 update px_private.account_deletions set status='complete',completed_at=now() where user_id=rid;
 insert into public.px_audit(actor_id,action,target_id,reason,details) values(d.actor_id,'account_deleted',rid::text,d.reason,jsonb_build_object('mode',d.mode,'auth_removed',true));
 return jsonb_build_object('deleted',true,'mode',d.mode);
end$$;
revoke all on function public.px_account_complete(jsonb) from public,anon,authenticated;grant execute on function public.px_account_complete(jsonb) to service_role;

create function public.px_account_cleanup_files(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(object_key),'[]') from px_private.tax_documents where rep_id=(p->>'id')::uuid and exists(select 1 from px_private.account_deletions where user_id=(p->>'id')::uuid and mode='purge'));
end$$;
revoke all on function public.px_account_cleanup_files(jsonb) from public,anon,authenticated;grant execute on function public.px_account_cleanup_files(jsonb) to service_role;

alter function px_private.report(text,jsonb) rename to report_before_launch;
revoke all on function px_private.report_before_launch(text,jsonb) from public,anon,authenticated;
create function px_private.report(kind text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid;out jsonb;page int:=greatest(0,least(10000,coalesce((p->>'page')::int,0)));
begin
 perform px_private.require_access();
 if kind='leaderboard' and not px_private.has_role(array['sales_admin']) and exists(select 1 from public.px_rep_private where rep_id=auth.uid() and access_overrides->>'leaderboard'='false') then raise exception 'This view is not available for your account.' using errcode='42501';end if;
 if kind='progression' then return px_private.progress_summary(auth.uid());end if;
 if kind='login_accounts' then
  perform px_private.require_role(array['owner']);
  return (select coalesce(jsonb_agg(t),'[]') from (select u.id,'Login account' name,u.email,'ACCOUNT '||u.id::text code,(select coalesce(jsonb_agg(role),'[]') from public.px_roles where user_id=u.id) roles,px_private.protected_history(u.id) protected_history from auth.users u where not exists(select 1 from public.px_reps where id=u.id) order by u.email limit 500)t);
 end if;
 if kind='xp_history' then
  rid:=coalesce(nullif(p->>'id','')::uuid,auth.uid());
  if rid<>auth.uid() then perform px_private.require_role(array['sales_admin']);end if;
  return jsonb_build_object('total',(select coalesce(sum(amount),0) from public.px_xp where rep_id=rid),'rows',(select coalesce(jsonb_agg(t order by created_at desc,id desc),'[]') from (select x.id,x.created_at,x.source,x.source_id,x.amount,x.reason,case when x.source='call' then (select c.outcome from public.px_calls c where c.id=x.source_id) else x.source end event,sum(x.amount) over(order by created_at,id) running_total from public.px_xp x where rep_id=rid order by created_at desc,id desc limit 50 offset page*50)t),'count',(select count(*) from public.px_xp where rep_id=rid));
 elsif kind='account' then
  perform px_private.require_role(array['sales_admin']);
  select id into rid from public.px_reps where code=p->>'code';
  return jsonb_build_object('rep',(select to_jsonb(r) from public.px_reps r where id=rid),'private',(select to_jsonb(r) from public.px_rep_private r where rep_id=rid),'roles',(select coalesce(jsonb_agg(role),'[]') from public.px_roles where user_id=rid),'teams',(select coalesce(jsonb_agg(jsonb_build_object('value',id,'label',name)),'[]') from public.px_teams),'pending_email',(select pending_email from px_private.account_access where user_id=rid),'protected_history',px_private.protected_history(rid),'progress',px_private.progress_summary(rid),'deletion',(select jsonb_build_object('mode',mode,'status',status) from px_private.account_deletions where user_id=rid));
 elsif kind='account_email' then
  return jsonb_build_object('pending_email',(select pending_email from px_private.account_access where user_id=auth.uid()));
 elsif kind='stripe_health' then
  perform px_private.require_role(array['finance_admin']);
  return jsonb_build_object('connected_reps',(select count(*) from public.px_connect),'incomplete',(select count(*) from public.px_connect where not (payouts_enabled and transfers_enabled and details_submitted)),'failed_events',(select count(*) from public.px_stripe_events where status='failed'),'unattributed_events',(select count(*) from public.px_stripe_events where status='unattributed' or error in ('Connected account is not attributed to a rep.','Connected account not found.')),'payments',(select count(*) from public.px_payments),'commissions',(select count(*) from public.px_commissions),'deliveries',(select coalesce(jsonb_agg(t),'[]') from (select distinct on(coalesce(channel,case when type='account.updated' or type like 'payout.%' then 'connect' else 'platform' end)) coalesce(channel,case when type='account.updated' or type like 'payout.%' then 'connect' else 'platform' end) channel,status,coalesce(last_received_at,created_at) delivered_at from public.px_stripe_events order by coalesce(channel,case when type='account.updated' or type like 'payout.%' then 'connect' else 'platform' end),coalesce(last_received_at,created_at) desc)t));
 end if;
 return px_private.report_before_launch(kind,p);
end$$;
grant execute on function px_private.report(text,jsonb) to authenticated;
create or replace function public.px_context() returns jsonb language plpgsql security definer set search_path='' as $$begin perform px_private.require_access();return px_private.context()||jsonb_build_object('career_xp',(select coalesce(sum(amount),0) from public.px_xp where rep_id=auth.uid()),'access_options',coalesce((select access_overrides from public.px_rep_private where rep_id=auth.uid()),'{}'));end$$;
create or replace function public.px_tax(action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$begin perform px_private.require_access();return px_private.tax(action,p);end$$;
-- Season/advanced feature work stays disabled for the launch pass.
update public.px_settings set value=value||'{"feature_seasons":false,"feature_ai_coaching":false,"feature_telephony":false,"feature_power_hour":false,"feature_mentorship":false,"feature_external_leads":false}';

create function px_private.email_confirmed() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.email is distinct from old.email then
  update public.px_rep_private set email=new.email where rep_id=new.id;
  update px_private.account_access set pending_email=null where user_id=new.id and lower(pending_email)=lower(new.email);
  insert into public.px_audit(actor_id,action,target_id,reason,details) values(new.id,'account_email_confirmed',new.id::text,'Email change verified by authentication provider',jsonb_build_object('before',old.email,'after',new.email));
 end if;return new;end$$;
create trigger pixelalty_email_confirmed after update of email on auth.users for each row execute function px_private.email_confirmed();
revoke all on function px_private.context() from public,anon,authenticated;
