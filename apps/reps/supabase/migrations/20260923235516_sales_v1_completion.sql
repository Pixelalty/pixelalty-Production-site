-- Additive V1 workflow completion. Apply only to the explicitly selected environment.
alter table public.px_reps add column profile_completed_at timestamptz;
alter table public.px_applicants drop constraint px_applicants_stage_check;
alter table public.px_applicants add constraint px_applicants_stage_check check(stage in ('new','review','interview','interview_scheduled','offer','approved','onboarding','activated','rejected','withdrawn','inactive','approval_error'));
alter table public.px_applicants add column tags text[] not null default '{}';
alter table public.px_packages add column description text not null default '';
alter table public.px_deals add column quote_notes text not null default '';
alter table public.px_businesses add column tags text[] not null default '{}';
alter table public.px_businesses add column source text not null default '';
alter table public.px_businesses add column bad_number boolean not null default false;
alter table public.px_followups add column priority text not null default 'normal' check(priority in ('low','normal','high'));
alter table public.px_followups add column channel text not null default 'phone' check(channel in ('phone','email','other'));
alter table public.px_training add column answers jsonb;
alter table public.px_notifications drop constraint px_notifications_rep_id_fkey;
alter table public.px_notifications add constraint px_notifications_recipient_fkey foreign key(rep_id) references auth.users(id);
alter table public.px_notifications add column link text not null default '/';
alter table public.px_notifications add column event_key text;
create unique index px_notifications_once on public.px_notifications(rep_id,event_key) where event_key is not null;
alter table public.px_jobs add column attempts int not null default 0;
alter table public.px_jobs add column updated_at timestamptz not null default now();

alter table public.px_calls drop constraint px_calls_outcome_check;
alter table public.px_calls add constraint px_calls_outcome_check check(outcome in ('no_answer','voicemail','gatekeeper','decision_maker_unavailable','conversation','send_information','interested','follow_up','meeting','proposal','not_interested','wrong_number','disconnected','business_closed','do_not_call','sale_reported'));
alter table public.px_calls add column source text not null default 'manual' check(source='manual');
alter table public.px_calls add column verified boolean not null default false check(not verified);
alter table public.px_businesses add column metadata jsonb not null default '{}';
alter table public.px_businesses add column external_id text not null default '';
create unique index px_business_external_id on public.px_businesses(external_id) where external_id<>'';
alter table public.px_import_rows add column reviewed boolean not null default false;
alter table public.px_content add column created_by uuid references auth.users(id) default auth.uid();
create table public.px_notes (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.px_businesses(id),
 author_id uuid not null references auth.users(id), body text not null check(length(trim(body)) between 1 and 5000),
 visibility text not null default 'team' check(visibility in ('private','team','admin')),
 supersedes_id uuid unique references public.px_notes(id), pinned boolean not null default false,
 created_at timestamptz not null default now()
);
create index px_notes_business on public.px_notes(business_id,created_at desc);
create table public.px_favorites (
 rep_id uuid not null references public.px_reps(id), business_id uuid not null references public.px_businesses(id),
 created_at timestamptz not null default now(), primary key(rep_id,business_id)
);
create table public.px_focus_sessions (
 id uuid primary key default gen_random_uuid(), rep_id uuid not null references public.px_reps(id),
 target_calls int not null default 20 check(target_calls between 1 and 500), target_minutes int not null default 30 check(target_minutes between 1 and 480),
 paused_at timestamptz, paused_seconds int not null default 0 check(paused_seconds>=0), ended_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index px_one_focus_session on public.px_focus_sessions(rep_id) where ended_at is null;
alter table public.px_calls add column session_id uuid references public.px_focus_sessions(id);
alter table public.px_calls add column qualifying boolean not null default false;
-- Backfill only the newly introduced qualification field; original call facts remain unchanged.
drop trigger append_only on public.px_calls;
update public.px_calls c set qualifying=true where exists(select 1 from public.px_xp x where x.source='call' and x.source_id=c.id);
create trigger append_only before update or delete on public.px_calls for each row execute function px_private.immutable();
create index px_calls_session on public.px_calls(session_id);
create table public.px_streak_freezes (
 rep_id uuid not null references public.px_reps(id), day date not null, created_at timestamptz not null default now(), primary key(rep_id,day)
);
create table public.px_quote_requests (
 id uuid primary key default gen_random_uuid(), rep_id uuid not null references public.px_reps(id), business_id uuid not null references public.px_businesses(id),
 customer_email text not null, requirements text not null check(length(trim(requirements)) between 10 and 5000),
 status text not null default 'pending' check(status in ('pending','approved','declined')), deal_id uuid references public.px_deals(id),
 created_at timestamptz not null default now()
);
create index px_quotes_rep on public.px_quote_requests(rep_id,status);

create function px_private.can_read_business(bid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.px_businesses b where b.id=bid and
 ((b.owner_id=auth.uid() and px_private.active()) or px_private.team_scope(b.owner_id) or px_private.has_role(array['sales_admin','compliance_admin'])))
$$;
grant execute on function px_private.can_read_business(uuid) to authenticated;
do $$ declare n text; begin
 foreach n in array array['px_notes','px_favorites','px_focus_sessions','px_streak_freezes','px_quote_requests'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,anon,authenticated',n);
  execute format('grant select on public.%I to authenticated',n);
  execute format('grant all on public.%I to service_role',n);
 end loop;
end $$;
create policy notes_read on public.px_notes for select to authenticated using(px_private.can_read_business(business_id) and (author_id=(select auth.uid()) or visibility='team' or px_private.has_role(array['sales_admin','compliance_admin'])));
create policy favorites_read on public.px_favorites for select to authenticated using(rep_id=(select auth.uid()) and px_private.can_read_business(business_id));
create policy focus_read on public.px_focus_sessions for select to authenticated using(rep_id=(select auth.uid()) or px_private.team_scope(rep_id) or px_private.has_role(array['sales_admin']));
create policy freezes_read on public.px_streak_freezes for select to authenticated using(rep_id=(select auth.uid()));
create policy quotes_read on public.px_quote_requests for select to authenticated using((rep_id=(select auth.uid()) and px_private.active()) or px_private.has_role(array['sales_admin']));
create trigger append_only before update or delete on public.px_notes for each row execute function px_private.immutable();

update public.px_settings set value=value||'{"streak_target":30,"streak_freezes":2,"xp_per_level":250,"xp_attempt":1,"xp_conversation":3,"xp_interested":10,"xp_training":25,"quiz_pass_score":80,"recruiting_title":"Your next good conversation starts here.","recruiting_body":"Help businesses take a confident next step online. Join Pixelalty’s remote sales team with clear training, flexible prospecting tools, and transparent performance-based commission tracking. Earnings are not guaranteed.","recruiting_requirements":"Applicants must be 18 or older, have a computer, reliable internet and a phone or headset, and be comfortable speaking with business owners.","require_profile":true}';

-- Preserve the original transaction and payment implementation behind a guarded dispatcher.
alter function px_private.action(text,jsonb) rename to action_v0;
revoke execute on function px_private.action_v0(text,jsonb) from authenticated,anon,public;

create function px_private.action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); cfg jsonb; out jsonb; before_data jsonb; after_data jsonb; v uuid; bid uuid; rid uuid; why text:=trim(coalesce(p->>'reason',''));
 n int; amount int; earned int; qual boolean; today date; old public.px_notes; lead public.px_businesses; r public.px_reps;
 pkg public.px_packages; sess public.px_focus_sessions; content public.px_content; data jsonb; a jsonb; i int;
begin
 if uid is null then raise exception 'Sign in required.' using errcode='42501';end if;
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'Invalid request.';end if;
 select value into cfg from public.px_settings;
 select * into r from public.px_reps where id=uid for update;
 if action='notification_read' then
  update public.px_notifications set read_at=now() where rep_id=uid and (coalesce((p->>'all')::boolean,false) or id=(p->>'id')::uuid);
  return '{}';
 elsif action='preferences' then
  if r.id is null then raise exception 'A rep profile is required.';end if;
  data:=p->'value';
  if jsonb_typeof(data)<>'object' or length(data::text)>4000 then raise exception 'Invalid preferences.';end if;
  if data ? 'frame' and data->>'frame' not in ('auto','basic') then raise exception 'Choose an available profile frame.';end if;
  if data ? 'theme' and data->>'theme' not in ('light','dark','system') then raise exception 'Invalid appearance.';end if;
  if data ? 'sales_goal' and (data->>'sales_goal')::int not between 0 and 10000 then raise exception 'Invalid goal.';end if;
  if data ? 'calls_goal' and (data->>'calls_goal')::int not between 0 and 100000 then raise exception 'Invalid goal.';end if;
  update public.px_reps set preferences=preferences||(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(data) where key in ('theme','compact','reduced_motion','shortcuts','sales_goal','calls_goal','frame','notifications')) where id=uid;
  return '{}';
 elsif action in ('session_start','session_pause','session_resume','session_end') then
  if r.id is null or r.status<>'active' then raise exception 'An active rep account is required.';end if;
  if action='session_start' then
   insert into public.px_focus_sessions(rep_id,target_calls,target_minutes) values(uid,coalesce((p->>'target_calls')::int,20),coalesce((p->>'target_minutes')::int,30)) on conflict(rep_id) where ended_at is null do nothing;
  else
   select * into sess from public.px_focus_sessions where rep_id=uid and ended_at is null for update;
   if sess.id is null then raise exception 'Start a session first.';end if;
   if action='session_pause' then update public.px_focus_sessions set paused_at=coalesce(paused_at,now()) where id=sess.id;
   else update public.px_focus_sessions set paused_seconds=paused_seconds+case when paused_at is null then 0 else greatest(0,extract(epoch from now()-paused_at)::int) end,paused_at=null,ended_at=case when action='session_end' then now() else null end where id=sess.id;end if;
  end if;
  select to_jsonb(s) into out from public.px_focus_sessions s where rep_id=uid order by created_at desc limit 1;return out;
 elsif action='streak_freeze' then
  if r.id is null or r.status<>'active' then raise exception 'An active rep account is required.';end if;
  today:=(now() at time zone r.timezone)::date;
  if (p->>'day')::date not between today-1 and today or extract(isodow from (p->>'day')::date)>5 then raise exception 'A freeze can protect today or yesterday on a workday.';end if;
  if exists(select 1 from public.px_streak_freezes where rep_id=uid and day=(p->>'day')::date) then return '{}';end if;
  select count(*) into n from public.px_streak_freezes where rep_id=uid and date_trunc('month',day)=date_trunc('month',(p->>'day')::date);
  if n >= (cfg->>'streak_freezes')::int then raise exception 'No freezes remain for this month.';end if;
  insert into public.px_streak_freezes(rep_id,day) values(uid,(p->>'day')::date);return '{}';
 elsif action in ('note','favorite','lead_stage','quote_request') then
  bid:=(p->>'business_id')::uuid;
  select * into lead from public.px_businesses where id=bid for update;
  if not px_private.can_read_business(bid) or not ((lead.owner_id=uid and px_private.active()) or px_private.has_role(array['sales_admin'])) then raise exception 'This business is not available to you.' using errcode='42501';end if;
  if action='note' then
   if p->>'supersedes_id' is not null then
    select * into old from public.px_notes where id=(p->>'supersedes_id')::uuid;
    if old.business_id is distinct from bid or old.author_id is distinct from uid then raise exception 'You can only revise your own notes.';end if;
   end if;
   if p->>'visibility'='admin' then perform px_private.require_role(array['sales_admin']);end if;
   insert into public.px_notes(business_id,author_id,body,visibility,supersedes_id,pinned) values(bid,uid,trim(p->>'body'),coalesce(p->>'visibility','team'),nullif(p->>'supersedes_id','')::uuid,coalesce((p->>'pinned')::boolean,false)) returning id into v;
  elsif action='favorite' then
   if r.id is null then raise exception 'A rep account is required.';end if;
   if (p->>'enabled')::boolean then insert into public.px_favorites(rep_id,business_id) values(uid,bid) on conflict do nothing;else delete from public.px_favorites where rep_id=uid and business_id=bid;end if;
  elsif action='lead_stage' then
   if lead.customer or lead.dnc or lead.archived or p->>'stage' not in ('new','working','interested','follow_up','meeting','proposal','lost') or p->>'stage' is null then raise exception 'This stage requires its verified workflow.';end if;
   update public.px_businesses set stage=p->>'stage' where id=bid;
  else
   if r.status<>'active' or lead.dnc or lead.customer or lead.archived or lead.expires_at<now() then raise exception 'This business cannot receive a quote.';end if;
   if coalesce(p->>'customer_email','')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'A customer email is required.';end if;
   insert into public.px_quote_requests(rep_id,business_id,customer_email,requirements) values(uid,bid,lower(p->>'customer_email'),p->>'requirements') returning id into v;
  end if;
  perform px_private.audit(action,coalesce(v,bid)::text,why);return jsonb_build_object('id',v);
 elsif action in ('followup_update','followup_cancel') then
  select f.business_id into bid from public.px_followups f where f.id=(p->>'id')::uuid and f.rep_id=uid and f.status='open' for update;
  if bid is null or not px_private.can_read_business(bid) or r.status<>'active' then raise exception 'Follow-up is not available.';end if;
  if action='followup_cancel' then update public.px_followups set status='cancelled' where id=(p->>'id')::uuid;
  else
   if (p->>'due_at')::timestamptz is null or (p->>'due_at')::timestamptz<=now() or (p->>'due_at')::timestamptz>now()+interval '90 days' or not px_private.valid_timezone(p->>'timezone') then raise exception 'Choose a valid future time within 90 days.';end if;
   update public.px_followups set due_at=(p->>'due_at')::timestamptz,timezone=p->>'timezone',note=left(p->>'note',5000),priority=coalesce(p->>'priority','normal'),channel=coalesce(p->>'channel','phone'),notified_at=null where id=(p->>'id')::uuid;
   update public.px_businesses set expires_at=greatest(expires_at,(p->>'due_at')::timestamptz+interval '2 days') where id=bid;
  end if;return '{}';
 elsif action='profile' then
  if coalesce(length(trim(p->>'name')),0)<2 or coalesce(px_private.valid_timezone(p->>'timezone'),false) is false then raise exception 'Enter your name and a valid timezone.';end if;
  out:=px_private.action_v0(action,p);
  update public.px_reps set profile_completed_at=now() where id=uid;return out;
 elsif action='call' then
  select to_jsonb(c) into data from public.px_calls c where request_id=(p->>'request_id')::uuid and rep_id=uid;
  if data is not null then
   if data->>'business_id' is distinct from p->>'business_id' or data->>'outcome' is distinct from p->>'outcome' or data->>'notes' is distinct from coalesce(p->>'notes','') then raise exception 'A saved call cannot be changed by retrying its request.';end if;
   return jsonb_build_object('id',data->>'id','duplicate',true);
  end if;
  if (select count(*) from public.px_calls where rep_id=uid and created_at>now()-interval '1 minute')>=30 then raise exception 'Too many call updates. Wait a minute before trying again.';end if;
  if p->>'session_id' is not null and not exists(select 1 from public.px_focus_sessions where id=(p->>'session_id')::uuid and rep_id=uid and ended_at is null and paused_at is null) then raise exception 'Resume your active session before logging a call.';end if;
  select * into lead from public.px_businesses where id=(p->>'business_id')::uuid for update;
  if lead.id is null or lead.owner_id is distinct from uid or r.id is null or r.status<>'active' or lead.archived or lead.customer or lead.dnc or lead.bad_number or lead.expires_at<now() or exists(select 1 from public.px_dnc where phone=lead.phone and active) then raise exception 'This business is not available to you.' using errcode='42501';end if;
  if p->>'script_id' is not null and not exists(select 1 from public.px_content where id=(p->>'script_id')::uuid and kind='script' and active) then raise exception 'Choose a current script.';end if;
  insert into public.px_calls(request_id,rep_id,business_id,outcome,notes,script_id) values((p->>'request_id')::uuid,uid,lead.id,p->>'outcome',coalesce(p->>'notes',''),nullif(p->>'script_id','')::uuid) returning id,qualifying into v,qual;
  if qual then insert into public.px_xp(rep_id,source,source_id,amount) values(uid,'call',v,1);end if;
  insert into public.px_xp(rep_id,source,source_id,amount) values(uid,'first_call',uid,(cfg->>'xp_first_call')::int) on conflict do nothing;
  update public.px_businesses set first_attempt_at=coalesce(first_attempt_at,now()),expires_at=greatest(expires_at,now()+make_interval(days=>(cfg->>'ownership_days')::int)),bad_number=p->>'outcome' in ('wrong_number','disconnected'),stage=case p->>'outcome' when 'interested' then 'interested' when 'follow_up' then 'follow_up' when 'meeting' then 'meeting' when 'proposal' then 'proposal' when 'sale_reported' then 'proposal' when 'not_interested' then 'lost' when 'wrong_number' then 'lost' when 'disconnected' then 'lost' when 'business_closed' then 'lost' when 'send_information' then 'follow_up' when 'do_not_call' then 'dnc' else 'working' end where id=lead.id;
  if p->>'outcome'='do_not_call' then
   insert into public.px_dnc(phone,reason,actor_id) values(lead.phone,'Prospect requested no further contact',uid) on conflict do nothing;
   update public.px_businesses set dnc=true,stage='dnc' where phone=lead.phone;
   update public.px_followups set status='cancelled' where business_id=lead.id and status='open';
  end if;
  perform px_private.audit('call',lead.id::text);
  return jsonb_build_object('id',v,'qualifying',qual,'xp',(select coalesce(sum(x.amount),0) from public.px_xp x where x.source='call' and x.source_id=v));
 elsif action='followup' then
  out:=px_private.action_v0(action,p);
  update public.px_followups set priority=coalesce(p->>'priority','normal'),channel=coalesce(p->>'channel','phone') where id=(out->>'id')::uuid;
  return out;
 elsif action='followup_complete' then
  select f.business_id into bid from public.px_followups f where f.id=(p->>'id')::uuid and f.rep_id=uid and f.status='open' for update;
  if bid is null then return '{}';end if;
  if not px_private.can_read_business(bid) or (exists(select 1 from public.px_followups where id=(p->>'id')::uuid and channel='phone') and not exists(select 1 from public.px_calls c join public.px_followups f on f.id=(p->>'id')::uuid where c.business_id=bid and c.rep_id=uid and c.created_at>=f.created_at and c.created_at>=now()-interval '24 hours')) then raise exception 'Log the follow-up conversation or attempt before completing it.';end if;
  out:=px_private.action_v0(action,p);
  if not exists(select 1 from public.px_xp x join public.px_followups f on f.id=x.source_id where x.rep_id=uid and x.source='followup' and f.business_id=bid and x.created_at>now()-interval '24 hours') then insert into public.px_xp(rep_id,source,source_id,amount) values(uid,'followup',(p->>'id')::uuid,(cfg->>'xp_followup')::int) on conflict do nothing;end if;
  return out;
 elsif action='approval_begin' then
  perform px_private.require_role(array['sales_admin']);
  if length(why)<5 then raise exception 'Enter an audit reason of at least five characters.';end if;
  select to_jsonb(x) into data from public.px_applicants x where id=(p->>'id')::uuid for update;
  if data->>'rep_id' is not null then return data;end if;
  return px_private.action_v0(action,p);
 elsif action='deal_cancel' then
  select to_jsonb(d) into data from public.px_deals d where id=(p->>'id')::uuid and ((rep_id=uid and px_private.active()) or px_private.has_role(array['sales_admin'])) for update;
  if data is null or data->>'stage'<>'proposal' or data->>'checkout_started_at' is not null then raise exception 'Only a draft without a checkout attempt can be cancelled.';end if;
  if length(why)<5 then raise exception 'Enter a cancellation reason.';end if;
  update public.px_deals set stage='cancelled' where id=(p->>'id')::uuid;
  perform px_private.audit(action,p->>'id',why);return '{}';
 elsif action='import_row_decision' then
  perform px_private.require_role(array['sales_admin']);
  if length(why)<5 then raise exception 'Enter a review reason.';end if;
  if not exists(select 1 from public.px_imports where id=(p->>'id')::uuid and status='ready') then raise exception 'Only a ready import can be reviewed.';end if;
  update public.px_import_rows set reviewed=true,error=case when coalesce((p->>'keep')::boolean,false) then null else 'Rejected after duplicate review' end where batch_id=(p->>'id')::uuid and row_num=(p->>'row_num')::int and status='pending' and error like 'Possible duplicate:%';
  if not found then raise exception 'This row is not awaiting duplicate review.';end if;
  perform px_private.audit(action,p->>'id',why,jsonb_build_object('row_num',p->'row_num','keep',p->'keep'));return '{}';
 elsif action='content_archive' then
  perform px_private.require_role(array['content_admin']);
  select * into content from public.px_content where id=(p->>'id')::uuid;
  if content.kind='agreement' then perform px_private.require_role(array['owner']);end if;
  if length(why)<5 then raise exception 'Enter an archive reason.';end if;
  update public.px_content set active=false where id=content.id;
  perform px_private.audit(action,content.id::text,why);return '{}';
 elsif action='quiz' then
  select * into content from public.px_content where id=(p->>'content_id')::uuid and active and kind='quiz';
  if content.id is null or r.id is null then raise exception 'Choose a current quiz.';end if;
  select answers into a from px_private.quiz_keys where content_id=content.id;
  if jsonb_typeof(p->'answers') is distinct from 'array' or jsonb_array_length(p->'answers')<>jsonb_array_length(a) then raise exception 'Answer every question.';end if;
  if exists(select 1 from public.px_training where rep_id=uid and content_id=content.id and created_at>now()-interval '10 seconds') then raise exception 'Wait before trying the quiz again.';end if;
  select round(100.0*count(*) filter(where x.value=p->'answers'->(x.ordinality::int-1))/jsonb_array_length(a))::int into n from jsonb_array_elements(a) with ordinality x;
  insert into public.px_training(rep_id,content_id,score,passed,answers) values(uid,content.id,n,n>=(cfg->>'quiz_pass_score')::int,p->'answers');
  return jsonb_build_object('score',n,'passed',n>=(cfg->>'quiz_pass_score')::int);
 elsif action='lesson' then
  out:=px_private.action_v0(action,p);
  insert into public.px_xp(rep_id,source,source_id,amount) values(uid,'training',(p->>'content_id')::uuid,(cfg->>'xp_training')::int) on conflict do nothing;return out;
 end if;

 if action in ('settings','content','package','package_create','package_archive','admin_deal','quote_approve','quote_decline','rep_offboard','rep_capacity','rep_activate','business_edit','lead_release','save_view','delete_view','applicant_stage','import_review') then
  if length(why)<5 then raise exception 'Enter an audit reason of at least five characters.';end if;
  v:=nullif(p->>'id','')::uuid;
  if action='settings' then
   perform px_private.require_role(array['owner']);data:=cfg||(p->'value');
   if jsonb_typeof(p->'value') is distinct from 'object' then raise exception 'Invalid settings.';end if;
   for a in select value from jsonb_array_elements('[ ["streak_target",1,500],["streak_freezes",0,10],["xp_per_level",50,10000],["xp_attempt",0,50],["xp_conversation",0,100],["xp_interested",0,100],["xp_training",0,500],["xp_first_call",0,100],["xp_followup",0,50],["raw_xp_cap",1,500],["quiz_pass_score",1,100],["claim_count",1,20],["hold_days",0,90],["first_attempt_hours",1,720],["ownership_days",1,90],["call_start",0,23],["call_end",1,24] ]'::jsonb) loop
    if data->>(a->>0) is null or (data->>(a->>0))::int not between (a->>1)::int and (a->>2)::int then raise exception 'Setting % is outside its allowed range.',a->>0;end if;
   end loop;
   if (data->>'call_start')::int>=(data->>'call_end')::int or (data->>'auto_transfers')::boolean is true then raise exception 'Invalid calling hours or automatic transfer configuration.';end if;
   foreach why in array array['require_profile','require_agreement','require_tax','require_payout','calling_enabled','recruiting_open'] loop
    if jsonb_typeof(data->why) is distinct from 'boolean' then raise exception 'Setting % must be true or false.',why;end if;
   end loop;
   if length(coalesce(data->>'recruiting_title','')) not between 5 and 180 or length(coalesce(data->>'recruiting_body','')) not between 20 and 3000 then raise exception 'Enter a recruiting title and description.';end if;
   update public.px_settings set value=data||'{"auto_transfers":false}';
   perform px_private.audit(action,'settings',p->>'reason',jsonb_build_object('before',cfg,'after',data));return '{}';
  elsif action='content' then
   perform px_private.require_role(array['content_admin']);
   if length(trim(coalesce(p->>'title',''))) not between 3 and 180 or length(trim(coalesce(p->>'body',''))) not between 10 and 100000 or coalesce(p->>'slug','')!~'^[a-z0-9][a-z0-9-]{1,99}$' then raise exception 'Enter a title, content and a stable reference using lowercase letters, numbers and hyphens.';end if;
   if p->>'kind'='quiz' then
    data:=(p->>'body')::jsonb;a:=p->'answers';
    if jsonb_typeof(data) is distinct from 'array' or jsonb_typeof(a) is distinct from 'array' or jsonb_array_length(data) not between 1 and 50 or jsonb_array_length(data)<>jsonb_array_length(a) then raise exception 'Enter questions and a matching answer key.';end if;
    for i in 0..jsonb_array_length(data)-1 loop
     if length(trim(coalesce(data->i->>'question','')))<3 or jsonb_typeof(data->i->'options') is distinct from 'array' or jsonb_array_length(data->i->'options') not between 2 and 8 or (a->>i)::int not between 0 and jsonb_array_length(data->i->'options')-1 then raise exception 'Each question needs options and one valid correct answer.';end if;
    end loop;
   end if;
   return px_private.action_v0(action,p);
  elsif action in ('package_create','package_archive','package') then
   perform px_private.require_role(array['finance_admin']);
   if action='package_create' then
    if coalesce(p->>'code','')!~'^[a-z][a-z0-9-]{1,39}$' or length(trim(coalesce(p->>'name','')))<2 then raise exception 'Enter a name and a unique package reference.';end if;
    insert into public.px_packages(code,name,version,price_cents,commission_cents,sale_xp,description) values(p->>'code',p->>'name',1,(p->>'price_cents')::int,(p->>'commission_cents')::int,coalesce((p->>'sale_xp')::int,100),left(coalesce(p->>'description',''),2000)) returning id into v;
   elsif action='package_archive' then update public.px_packages set active=false where id=v;
   else
    select to_jsonb(x) into before_data from public.px_packages x where id=v;
    out:=px_private.action_v0(action,p);v:=(out->>'id')::uuid;
    update public.px_packages set description=left(coalesce(p->>'description',before_data->>'description',''),2000),name=coalesce(nullif(trim(p->>'name'),''),name),sale_xp=coalesce((p->>'sale_xp')::int,sale_xp) where id=v;
   end if;
  elsif action in ('admin_deal','quote_approve','quote_decline') then
   perform px_private.require_role(array['sales_admin']);
   if action='quote_decline' then update public.px_quote_requests set status='declined' where id=v and status='pending';
   else
    if action='quote_approve' then
     select to_jsonb(q) into data from public.px_quote_requests q where id=v and status='pending' for update;
     if data is null then raise exception 'Quote request is no longer pending.';end if;
     select * into pkg from public.px_packages where code='advanced' and active;
     p:=p||jsonb_build_object('rep_id',data->>'rep_id','business_id',data->>'business_id','customer_email',data->>'customer_email','package_id',pkg.id,'quote_notes',data->>'requirements');
    end if;
    rid:=(p->>'rep_id')::uuid;bid:=(p->>'business_id')::uuid;
    select * into lead from public.px_businesses where id=bid for update;
    select * into pkg from public.px_packages where id=(p->>'package_id')::uuid and active;
    if lead.id is null or lead.owner_id is distinct from rid or lead.dnc or lead.archived or lead.customer or pkg.id is null or not exists(select 1 from public.px_reps where id=rid and status='active') then raise exception 'Select an available business assigned to an active rep and a current package.';end if;
    amount:=coalesce((p->>'price_cents')::int,pkg.price_cents);
    if (pkg.code<>'advanced' and amount<>pkg.price_cents) or amount<pkg.price_cents then raise exception 'Price must match the package or meet the Advanced minimum.';end if;
    if coalesce(p->>'customer_email','')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'A customer email is required.';end if;
    insert into public.px_deals(rep_id,business_id,package_id,package_name,price_cents,commission_cents,sale_xp,customer_email,quote_notes) values(rid,bid,pkg.id,pkg.name,amount,pkg.commission_cents,pkg.sale_xp,lower(p->>'customer_email'),left(coalesce(p->>'quote_notes',''),5000)) returning id into v;
    update public.px_businesses set stage='proposal' where id=bid;
    if action='quote_approve' then update public.px_quote_requests set status='approved',deal_id=v where id=(data->>'id')::uuid;end if;
   end if;
  elsif action='rep_activate' then
   perform px_private.require_role(array['sales_admin']);
   if (cfg->>'require_profile')::boolean and not exists(select 1 from public.px_reps where id=v and profile_completed_at is not null) then raise exception 'The rep must save their profile before activation.';end if;
   out:=px_private.action_v0(action,p);
   update public.px_applicants set stage='activated' where rep_id=v;
   insert into public.px_notifications(rep_id,title,body,link,event_key) values(v,'Your workspace is ready','Your account is active. Get your first leads to begin.','/leads','activated') on conflict do nothing;return out;
  elsif action='rep_offboard' then
   perform px_private.require_role(array['sales_admin']);
   if exists(select 1 from public.px_roles where user_id=v) then raise exception 'Remove administrative roles before offboarding this account.';end if;
   update public.px_reps set status='offboarded' where id=v;
   insert into public.px_assignments(business_id,rep_id,action,actor_id) select id,owner_id,'offboard_release',uid from public.px_businesses where owner_id=v and not customer and first_attempt_at is null;
   update public.px_businesses set owner_id=null,claimed_at=null,expires_at=null where owner_id=v and not customer and first_attempt_at is null;
  elsif action='rep_capacity' then
   perform px_private.require_role(array['sales_admin']);
   update public.px_reps set capacity=(p->>'capacity')::int where id=v;
  elsif action='business_edit' then
   perform px_private.require_role(array['sales_admin']);
   if coalesce(length(trim(p->>'name')),0)<2 or not px_private.valid_timezone(p->>'timezone') then raise exception 'Enter a name and valid prospect timezone.';end if;
   select to_jsonb(b) into before_data from public.px_businesses b where id=v for update;
   update public.px_businesses set name=left(trim(p->>'name'),200),contact=left(coalesce(p->>'contact',''),200),email=left(coalesce(p->>'email',''),254),timezone=p->>'timezone',city=left(coalesce(p->>'city',''),100),state=left(coalesce(p->>'state',''),100),industry=left(coalesce(p->>'industry',''),100),source=left(coalesce(p->>'source',''),200),tags=array(select jsonb_array_elements_text(coalesce(p->'tags','[]'))) where id=v;
   select to_jsonb(b) into after_data from public.px_businesses b where id=v;
  elsif action='lead_release' then
   perform px_private.require_role(array['sales_admin']);
   select * into lead from public.px_businesses where id=v for update;
   if lead.customer then raise exception 'Customer attribution must be preserved.';end if;
   if lead.owner_id is not null then insert into public.px_assignments(business_id,rep_id,action,actor_id) values(v,lead.owner_id,'admin_release',uid);end if;
   update public.px_followups set status='cancelled' where business_id=v and status='open';
   update public.px_businesses set owner_id=null,claimed_at=null,expires_at=null where id=v;
  elsif action='applicant_stage' then
   perform px_private.require_role(array['sales_admin']);
   if p->>'stage' not in ('new','review','interview','interview_scheduled','offer','rejected','withdrawn','inactive') then raise exception 'Use approval and activation for this stage.';end if;
   update public.px_applicants set stage=p->>'stage' where id=v and rep_id is null;
  elsif action='save_view' then
   if r.id is null and not px_private.has_role(array['sales_admin','manager','finance_admin','content_admin','compliance_admin','support']) then raise exception 'Workspace access required.';end if;
   if coalesce(length(trim(p->>'name')),0) not between 1 and 100 or jsonb_typeof(p->'config') is distinct from 'object' then raise exception 'Name this view and choose its filters.';end if;
   insert into public.px_saved_views(owner_id,name,kind,config) values(uid,trim(p->>'name'),p->>'kind',p->'config') returning id into v;
  elsif action='delete_view' then delete from public.px_saved_views where id=v and owner_id=uid;
  elsif action='import_review' then
   perform px_private.require_role(array['sales_admin']);
   if not exists(select 1 from public.px_imports where id=v and status='ready') then raise exception 'Finish staging the import before reviewing.';end if;
   update public.px_import_rows ir set error=case
    when exists(select 1 from public.px_dnc d where d.phone=ir.data->>'phone' and d.active) then 'Do not contact'
    when exists(select 1 from public.px_businesses b where b.customer and (b.phone=ir.data->>'phone' or (b.domain<>'' and b.domain=ir.data->>'domain'))) then 'Existing customer'
    when exists(select 1 from public.px_businesses b where b.phone=ir.data->>'phone' or (b.domain<>'' and b.domain=ir.data->>'domain')) then 'Duplicate phone or website'
    when exists(select 1 from public.px_import_rows prior where prior.batch_id=ir.batch_id and prior.row_num<ir.row_num and prior.error is null and (prior.data->>'phone'=ir.data->>'phone' or (coalesce(ir.data->>'domain','')<>'' and prior.data->>'domain'=ir.data->>'domain'))) then 'Duplicate within spreadsheet'
    when coalesce(ir.data->>'external_id','')<>'' and exists(select 1 from public.px_businesses b where b.external_id=ir.data->>'external_id') then 'Duplicate external business ID'
    when not ir.reviewed and exists(select 1 from public.px_businesses b where (coalesce(ir.data->>'email','')<>'' and lower(b.email)=lower(ir.data->>'email')) or (coalesce(ir.data->>'city','')<>'' and lower(b.name)=lower(ir.data->>'name') and lower(b.city)=lower(ir.data->>'city'))) then 'Possible duplicate: matching email or business name and city'
    else null end where ir.batch_id=v and ir.status='pending' and ir.error is null;
  end if;
  perform px_private.audit(action,v::text,why,jsonb_build_object('before',before_data,'after',after_data));return jsonb_build_object('id',v);
 end if;
 return px_private.action_v0(action,p);
end $$;
grant execute on function px_private.action(text,jsonb) to authenticated;
create or replace function public.px_action(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.action(action,p)$$;

update public.px_settings set value='{"xp_first_call":10,"xp_followup":3}'::jsonb||value;

-- Call metadata and configurable awards are populated before immutable inserts.
create function px_private.prepare_call() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.qualifying:=not exists(select 1 from public.px_calls where rep_id=new.rep_id and business_id=new.business_id and created_at>now()-interval '24 hours');
 select id into new.session_id from public.px_focus_sessions where rep_id=new.rep_id and ended_at is null and paused_at is null;
 return new;
end $$;
create trigger prepare_call before insert on public.px_calls for each row execute function px_private.prepare_call();
create function px_private.prepare_xp() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg jsonb; outcome text; total int; zone text;
begin
 if new.source='call' then
  select value into cfg from public.px_settings;
  select timezone into zone from public.px_reps where id=new.rep_id;
  select c.outcome into outcome from public.px_calls c where c.id=new.source_id;
  select coalesce(sum(amount),0) into total from public.px_xp where rep_id=new.rep_id and source='call' and (created_at at time zone zone)::date=(now() at time zone zone)::date;
  new.amount:=greatest(0,least((cfg->>'raw_xp_cap')::int-total,(cfg->>case when outcome='interested' then 'xp_interested' when outcome in ('conversation','meeting','proposal') then 'xp_conversation' else 'xp_attempt' end)::int));
 end if;return new;
end $$;
create trigger prepare_xp before insert on public.px_xp for each row execute function px_private.prepare_xp();

create or replace function px_private.public_config() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('packages',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'price_cents',price_cents,'commission_cents',commission_cents,'description',description) order by price_cents),'[]') from public.px_packages where active),'recruiting_open',(value->>'recruiting_open')::boolean,'title',value->>'recruiting_title','body',value->>'recruiting_body','requirements',value->>'recruiting_requirements') from public.px_settings
$$;

create function px_private.streak_summary(rid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare zone text; cfg jsonb; today date; first_day date; d date; counts jsonb; freezes jsonb; days jsonb:='[]'; run int:=0; longest int:=0; target int; calls int; protected boolean;
begin
 if auth.uid() is null or (rid<>auth.uid() and not px_private.has_role(array['sales_admin']) and not px_private.team_scope(rid)) then raise exception 'Not authorized.' using errcode='42501';end if;
 select timezone into zone from public.px_reps where id=rid;
 if zone is null then return '{}';end if;
 select value into cfg from public.px_settings;target:=(cfg->>'streak_target')::int;today:=(now() at time zone zone)::date;
 select coalesce(jsonb_object_agg(day,n),'{}') into counts from (select (created_at at time zone zone)::date as day,count(*) as n from public.px_calls where rep_id=rid and qualifying group by 1)s;
 select coalesce(jsonb_object_agg(day,true),'{}') into freezes from public.px_streak_freezes where rep_id=rid;
 select least(coalesce(min((created_at at time zone zone)::date),today),today-6) into first_day from public.px_calls where rep_id=rid and qualifying;
 for d in select generate_series(first_day::timestamp,today::timestamp,'1 day')::date loop
  calls:=coalesce((counts->>d::text)::int,0);protected:=extract(isodow from d)>5 or coalesce((freezes->>d::text)::boolean,false);
  if extract(isodow from d)<=5 then
   if calls>=target then run:=run+1;
   elsif not protected and d<>today then run:=0;end if;
  end if;
  longest:=greatest(longest,run);
  if d>=today-6 then days:=days||jsonb_build_array(jsonb_build_object('day',d,'calls',calls,'complete',calls>=target,'protected',protected,'frozen',coalesce((freezes->>d::text)::boolean,false)));end if;
 end loop;
 return jsonb_build_object('current',run,'longest',longest,'target',target,'today',coalesce((counts->>today::text)::int,0),'days',days,'timezone',zone,'freezes_left',greatest(0,(cfg->>'streak_freezes')::int-(select count(*) from public.px_streak_freezes where rep_id=rid and day>=date_trunc('month',today)::date)));
end $$;

alter function px_private.report(text,jsonb) rename to report_v0;
revoke execute on function px_private.report_v0(text,jsonb) from public,anon,authenticated;
create function px_private.report(kind text,p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); rid uuid; cfg jsonb; result jsonb; steps jsonb; r public.px_reps; target uuid; start_at timestamptz; metric text; page int;
begin
 if uid is null then raise exception 'Sign in required.' using errcode='42501';end if;
 select value into cfg from public.px_settings;
 select * into r from public.px_reps where id=uid;
 if r.id is null and not px_private.has_role(array['sales_admin','finance_admin','content_admin','support','compliance_admin','manager']) then raise exception 'Workspace access required.' using errcode='42501';end if;
 if kind='onboarding' then
  rid:=coalesce(nullif(p->>'id','')::uuid,uid);
  if rid<>uid then perform px_private.require_role(array['sales_admin']);end if;
  select * into r from public.px_reps where id=rid;
  if r.id is null then raise exception 'Rep not found.';end if;
  select jsonb_agg(jsonb_build_object('key',key,'title',title,'complete',complete,'required',required,'link',link) order by ord) into steps from (
   select 1 ord,'account' key,'Account created' title,true complete,true required,'/profile' link
   union all select 2,'email','Email verified',exists(select 1 from auth.users where id=rid and email_confirmed_at is not null),true,'/profile'
   union all select 3,'profile','Profile completed',r.profile_completed_at is not null,(cfg->>'require_profile')::boolean,'/profile'
   union all select 4,'agreement','Required agreements accepted',exists(select 1 from public.px_content c0 where c0.kind='agreement' and active and required) and not exists(select 1 from public.px_content c where c.kind='agreement' and active and required and not exists(select 1 from public.px_agreements a where a.rep_id=rid and a.content_id=c.id)),(cfg->>'require_agreement')::boolean,'/onboarding'
   union all select 5,'classification','Worker classification reviewed',exists(select 1 from public.px_rep_private where rep_id=rid and classification<>'unconfigured'),true,'/onboarding'
   union all select 6,'tax','Tax setup verified',exists(select 1 from public.px_rep_private where rep_id=rid and tax_status='verified'),(cfg->>'require_tax')::boolean,'/onboarding'
   union all select 7,'payout','Payment setup ready',exists(select 1 from public.px_rep_private pr where pr.rep_id=rid and (pr.external_payout_verified or exists(select 1 from public.px_connect c where c.rep_id=rid and pr.classification='contractor' and c.transfers_enabled and c.payouts_enabled and c.checked_at>now()-interval '1 day'))),(cfg->>'require_payout')::boolean,'/onboarding'
   union all select 8,'training','Required training completed',not exists(select 1 from public.px_content c where c.kind='lesson' and active and required and not exists(select 1 from public.px_training t where t.rep_id=rid and t.content_id=c.id and t.passed)),true,'/academy'
   union all select 9,'quiz','Readiness quiz passed',not exists(select 1 from public.px_content c where c.kind='quiz' and active and required and not exists(select 1 from public.px_training t where t.rep_id=rid and t.content_id=c.id and t.passed)),true,'/academy'
   union all select 10,'activation','Administrator activation',r.status='active',true,'/onboarding'
  ) s;
  return jsonb_build_object('steps',steps,'status',r.status,'ready',not exists(select 1 from jsonb_array_elements(steps) s where (s->>'required')::boolean and not (s->>'complete')::boolean and s->>'key'<>'activation'));
 elsif kind='leads' then
  if r.id is null or r.status<>'active' then raise exception 'An active rep account is required.' using errcode='42501';end if;
  page:=greatest(0,least(coalesce((p->>'page')::int,0),10000));
  with candidates as (
   select b.*,(select c.outcome from public.px_calls c where c.business_id=b.id and c.rep_id=uid order by c.created_at desc limit 1) latest_outcome,
    (select min(f.due_at) from public.px_followups f where f.business_id=b.id and f.rep_id=uid and f.status='open') next_due,
    exists(select 1 from public.px_favorites f where f.business_id=b.id and f.rep_id=uid) favorite
   from public.px_businesses b where owner_id=uid
  ), filtered as (
   select * from candidates b where (coalesce(p->>'id','')='' or b.id=(p->>'id')::uuid)
   and (coalesce(p->>'stage','')='' or b.stage=p->>'stage')
   and (coalesce(p->>'q','')='' or b.name ilike '%'||(p->>'q')||'%' or b.code ilike '%'||(p->>'q')||'%')
   and (coalesce(p->>'favorite','false')<>'true' or favorite)
   and (coalesce(p->>'queue','false')<>'true' or (not dnc and not customer and not archived and not bad_number and expires_at>now() and stage not in ('lost','won','dnc') and not exists(select 1 from public.px_dnc d where d.phone=b.phone and d.active)))
   and case coalesce(p->>'view','all') when 'due' then next_due<(date_trunc('day',now() at time zone r.timezone)+interval '1 day') at time zone r.timezone when 'hot' then stage in ('interested','meeting','proposal') when 'no_answer' then latest_outcome='no_answer' when 'recycle' then stage='working' and first_attempt_at<now()-interval '7 days' else true end
  ), page_rows as (
   select * from filtered order by case when p->>'queue'='true' then next_due end asc nulls last,case when p->>'sort'='name' then name end asc,created_at desc,id limit 50 offset page*50
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(b)) from page_rows b),'[]'),'total',(select count(*) from filtered),'page',page) into result;
  return result;
 elsif kind='dashboard' then
  result:=px_private.report_v0(kind,p);
  return result||jsonb_build_object('streak',px_private.streak_summary(uid),'level_step',(cfg->>'xp_per_level')::int,
   'sales',(select count(*) from public.px_deals d join public.px_payments py on py.deal_id=d.id where d.rep_id=uid and py.refunded_cents=0 and not py.disputed),
   'month_sales',(select count(*) from public.px_deals d join public.px_payments py on py.deal_id=d.id where d.rep_id=uid and py.refunded_cents=0 and not py.disputed and py.created_at>=date_trunc('month',now())),
   'month_commission',(select coalesce(sum(c.amount_cents),0) from public.px_commissions c join public.px_payments py on py.deal_id=c.deal_id where c.rep_id=uid and py.refunded_cents=0 and not py.disputed and py.created_at>=date_trunc('month',now())),
   'month_calls',(select count(*) from public.px_calls where rep_id=uid and qualifying and created_at>=date_trunc('month',now())),
   'calls_today',(select count(*) from public.px_calls where rep_id=uid and (created_at at time zone r.timezone)::date=(now() at time zone r.timezone)::date),
   'conversations_today',(select count(*) from public.px_calls where rep_id=uid and outcome in ('conversation','interested','meeting','proposal') and (created_at at time zone r.timezone)::date=(now() at time zone r.timezone)::date));
 elsif kind='session' then
  select to_jsonb(s)||jsonb_build_object('active_seconds',greatest(0,extract(epoch from coalesce(s.ended_at,s.paused_at,now())-s.created_at)::int-s.paused_seconds),'calls',(select count(*) from public.px_calls c where c.session_id=s.id),'conversations',(select count(*) from public.px_calls c where c.session_id=s.id and outcome in ('conversation','interested','meeting','proposal')),'interested',(select count(*) from public.px_calls c where c.session_id=s.id and outcome='interested'),'xp',(select coalesce(sum(x.amount),0) from public.px_xp x join public.px_calls c on c.id=x.source_id and x.source='call' where c.session_id=s.id),'followups',(select count(*) from public.px_followups f where f.rep_id=uid and f.created_at>=s.created_at and f.created_at<=coalesce(s.ended_at,now()))) into result from public.px_focus_sessions s where rep_id=uid order by created_at desc limit 1;
  return result;
 elsif kind='money' then
  return jsonb_build_object('hold',(select coalesce(sum(amount_cents),0) from public.px_commissions where rep_id=uid and status='hold'),'payable',(select coalesce(sum(amount_cents),0) from public.px_commissions where rep_id=uid and status='payable'),'queued',(select coalesce(sum(amount_cents),0) from public.px_commissions where rep_id=uid and status='queued'),'transferred',(select coalesce(sum(amount_cents-reversed_cents),0) from public.px_commissions where rep_id=uid and transfer_id is not null),'bank_paid',(select coalesce(sum(amount_cents),0) from public.px_payouts where rep_id=uid and status='paid'),'review',(select coalesce(sum(amount_cents-reversed_cents),0) from public.px_commissions where rep_id=uid and status='recovery_review'),'connect',(select to_jsonb(c) from public.px_connect c where rep_id=uid));
 elsif kind='leaderboard' then
  start_at:=case when p->>'period'='all' then '-infinity'::timestamptz else date_trunc('month',now()) end;
  metric:=coalesce(p->>'metric','sales');page:=greatest(0,least(coalesce((p->>'page')::int,0),1000));
  with stats as (
   select ranked_rep.id,ranked_rep.name,ranked_rep.code,coalesce(x.xp,0) xp,coalesce(c.calls,0) calls,coalesce(c.conversations,0) conversations,coalesce(s.sales,0) sales,coalesce(s.revenue_cents,0) revenue_cents,
   case when coalesce(c.calls,0)>=100 then round(100.0*coalesce(s.sales,0)/c.calls,2) else null end conversion
   from public.px_reps ranked_rep
   left join (select rep_id,sum(amount) xp from public.px_xp group by rep_id)x on x.rep_id=ranked_rep.id
   left join (select rep_id,count(*) filter(where qualifying) calls,count(*) filter(where qualifying and outcome in ('conversation','interested','meeting','proposal')) conversations from public.px_calls where created_at>=start_at group by rep_id)c on c.rep_id=ranked_rep.id
   left join (select d.rep_id,count(*) sales,sum(py.amount_cents) revenue_cents from public.px_deals d join public.px_payments py on py.deal_id=d.id where py.refunded_cents=0 and not py.disputed and py.created_at>=start_at group by d.rep_id)s on s.rep_id=ranked_rep.id where ranked_rep.status='active'
  ), ranked as(select *,row_number() over(order by (case metric when 'revenue' then revenue_cents when 'calls' then calls when 'conversations' then conversations when 'conversion' then coalesce(conversion,-1) else sales end) desc,xp desc,code) rank from stats)
  select coalesce(jsonb_agg(to_jsonb(t) order by rank),'[]') into result from ranked t where rank between page*50+1 and (page+1)*50 or abs(rank-coalesce((select rank from ranked where id=uid),0))<=2;
  return result;
 elsif kind='import' then
  perform px_private.require_role(array['sales_admin']);
  select jsonb_build_object('accepted',count(*) filter(where status='accepted'),'rejected',count(*) filter(where status='rejected'),'pending',count(*) filter(where status='pending'),'ready',count(*) filter(where status='pending' and error is null),'invalid',count(*) filter(where error is not null and error !~ '^(Duplicate|Possible duplicate|Do not contact|Existing customer)'),'duplicates',count(*) filter(where error like 'Duplicate%'),'possible_duplicates',count(*) filter(where error like 'Possible duplicate:%'),'suppressed',count(*) filter(where error='Do not contact'),'customers',count(*) filter(where error='Existing customer'),'staged',count(*)) into result from public.px_import_rows where batch_id=(p->>'id')::uuid;return result;
 elsif kind='business' then
  target:=(p->>'id')::uuid;
  if not px_private.can_read_business(target) then raise exception 'This business is not available.' using errcode='42501';end if;
  -- Sensitive financial amounts and internal fulfillment notes are deliberately absent.
  return jsonb_build_object('business',(select to_jsonb(b) from public.px_businesses b where id=target),
   'timeline',(select coalesce(jsonb_agg(t order by created_at desc),'[]') from (
    select created_at,'Assigned · '||action title,coalesce((select name from public.px_reps where id=a.rep_id),'Rep') detail from public.px_assignments a where business_id=target
    union all select created_at,'Call · '||outcome,notes from public.px_calls where business_id=target
    union all select created_at,'Follow-up · '||status,note from public.px_followups where business_id=target
    union all select created_at,'Deal · '||code,package_name||' · '||stage from public.px_deals where business_id=target
    union all select f.created_at,'Fulfillment',f.status from public.px_fulfillment f join public.px_deals d on d.id=f.deal_id where d.business_id=target
   )t));
 elsif kind='admin' then
  perform px_private.require_role(array['sales_admin']);
  return px_private.report_v0(kind,p)||jsonb_build_object('calls_today',(select count(*) from public.px_calls where created_at>=current_date),'conversations_today',(select count(*) from public.px_calls where created_at>=current_date and outcome in ('conversation','interested','meeting','proposal')),'revenue_cents',(select coalesce(sum(amount_cents-refunded_cents),0) from public.px_payments),'overdue_followups',(select count(*) from public.px_followups where status='open' and due_at<now()),'pending_quotes',(select count(*) from public.px_quote_requests where status='pending'),'onboarding_reps',(select count(*) from public.px_reps where status='onboarding'),'required_agreements',(select count(*) from public.px_content c0 where c0.kind='agreement' and active and required));
 elsif kind='finance' then
  perform px_private.require_role(array['finance_admin']);
  return jsonb_build_object('outstanding_cents',(select coalesce(sum(amount_cents),0) from public.px_commissions where status in ('hold','payable','queued')),'payable_cents',(select coalesce(sum(amount_cents),0) from public.px_commissions where status='payable'),'recovery_cents',(select coalesce(sum(amount_cents-reversed_cents),0) from public.px_commissions where status='recovery_review'),'failed_events',(select count(*) from public.px_stripe_events where status='failed'),'missing_commissions',(select count(*) from public.px_payments py where not exists(select 1 from public.px_commissions c where c.deal_id=py.deal_id)));
 end if;
 return px_private.report_v0(kind,p);
end $$;
grant execute on function px_private.report(text,jsonb) to authenticated;
create or replace function public.px_report(kind text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.report(kind,p)$$;

create table public.px_connect_requests(rep_id uuid primary key references public.px_reps(id),started_at timestamptz not null default now(),account_id text);
alter table public.px_connect_requests enable row level security;
revoke all on public.px_connect_requests from anon,authenticated;
grant select on public.px_connect_requests to authenticated;
grant all on public.px_connect_requests to service_role;
create policy connect_request_read on public.px_connect_requests for select to authenticated using(px_private.has_role(array['finance_admin']));

alter function px_private.service_guard(text,jsonb) rename to service_guard_v0;
revoke execute on function px_private.service_guard_v0(text,jsonb) from service_role,authenticated,anon,public;
create function px_private.service_guard(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare out jsonb; job public.px_jobs; d public.px_deals; payment public.px_payments;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501';end if;
 if action='connect' and exists(select 1 from public.px_connect where rep_id=(p->>'rep_id')::uuid and account_id<>p->>'account_id') then raise exception 'A different connected account is already recorded for this rep.';end if;
 if action='connect_begin' then
  if not exists(select 1 from public.px_reps rr join public.px_rep_private pr on pr.rep_id=rr.id where rr.id=(p->>'rep_id')::uuid and rr.status in ('onboarding','active') and pr.classification='contractor') then raise exception 'An eligible contractor profile is required.';end if;
  insert into public.px_connect_requests(rep_id) values((p->>'rep_id')::uuid) on conflict do nothing;
  if exists(select 1 from public.px_connect_requests where rep_id=(p->>'rep_id')::uuid and account_id is null and started_at<now()-interval '23 hours') then raise exception 'Reconcile the previous Connect account attempt before creating another.';end if;
  return '{}';
 elsif action='agreement_receipt' then
  insert into public.px_audit(actor_id,action,target_id,reason,details) select (p->>'rep_id')::uuid,'agreement_receipt',a.id::text,'Acceptance recorded by application server',jsonb_build_object('ip',p->>'ip','content_id',a.content_id) from public.px_agreements a where a.rep_id=(p->>'rep_id')::uuid and a.content_id=(p->>'content_id')::uuid and not exists(select 1 from public.px_audit x where x.action='agreement_receipt' and x.target_id=a.id::text);
  return '{}';
 elsif action='approval_complete' then
  select jsonb_build_object('rep_id',rep_id) into out from public.px_applicants where id=(p->>'applicant_id')::uuid and rep_id is not null;
  if out is not null then return out;end if;
 end if;
 out:=px_private.service_guard_v0(action,p);
 if action='connect' then update public.px_connect_requests set account_id=p->>'account_id' where rep_id=(p->>'rep_id')::uuid;
 elsif action='approval_complete' then update public.px_applicants set stage='onboarding' where id=(p->>'applicant_id')::uuid and stage<>'activated';
 elsif action='tick' then
  for job in select * from public.px_jobs where kind='sale_progression' and status<>'complete' order by created_at for update skip locked limit 50 loop
   begin
    select * into d from public.px_deals where id=job.source_id::uuid;
    select * into payment from public.px_payments where deal_id=d.id;
    if d.id is null or payment.id is null then raise exception 'Verified payment is required.';end if;
    insert into public.px_xp(rep_id,source,source_id,amount) values(d.rep_id,'sale',d.id,d.sale_xp) on conflict do nothing;
    if payment.refunded_cents=payment.amount_cents then insert into public.px_xp(rep_id,source,source_id,amount) values(d.rep_id,'refund',d.id,-d.sale_xp) on conflict do nothing;end if;
    insert into public.px_notifications(rep_id,title,body,link,event_key) values(d.rep_id,'Sale verified',d.package_name||' payment verified. See your commission status.','/money','sale:'||d.id) on conflict do nothing;
    update public.px_jobs set status='complete',error=null,attempts=attempts+1,updated_at=now() where id=job.id;
   exception when others then update public.px_jobs set status='failed',error=sqlstate,attempts=attempts+1,updated_at=now() where id=job.id;end;
  end loop;
  update public.px_jobs set updated_at=now() where kind='tick' and source_id=date_trunc('hour',now())::text;
 end if;
 return out;
end $$;
grant execute on function px_private.service_guard(text,jsonb) to service_role;
create or replace function public.px_service(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.service_guard(action,p)$$;

create function px_private.notify_assignment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.owner_id is not null and new.owner_id is distinct from old.owner_id then
  insert into public.px_notifications(rep_id,title,body,link) values(new.owner_id,'Lead assigned',new.name||' is ready in your leads.','/leads?business='||new.id);
 end if;return new;
end $$;
create trigger notify_assignment after update of owner_id on public.px_businesses for each row execute function px_private.notify_assignment();
create function px_private.notify_commission() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status then
  insert into public.px_notifications(rep_id,title,body,link) values(new.rep_id,'Commission status updated','Your commission is now '||replace(new.status,'_',' ')||'. Open My money for the ledger.','/money');
 end if;return new;
end $$;
create trigger notify_commission after update of status on public.px_commissions for each row execute function px_private.notify_commission();
create index px_import_rows_phone on public.px_import_rows(batch_id,(data->>'phone'),row_num);
create index px_import_rows_domain on public.px_import_rows(batch_id,(data->>'domain'),row_num) where coalesce(data->>'domain','')<>'';
create index px_deals_business on public.px_deals(business_id);

create or replace function px_private.context() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501';end if;
 return jsonb_build_object('user_id',auth.uid(),'rep',(select to_jsonb(r) from public.px_reps r where id=auth.uid()),'roles',coalesce((select jsonb_agg(role) from public.px_roles where user_id=auth.uid()),'[]'),'aal',auth.jwt()->>'aal','email_verified',(select email_confirmed_at is not null from auth.users where id=auth.uid()),'settings',(select value from public.px_settings));
end $$;

-- Preserve optional mapped context without changing the transactional importer.
create function px_private.import_context() returns trigger language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
 if new.import_id is not null then
  select ir.data into d from public.px_import_rows ir where ir.batch_id=new.import_id and ir.data->>'phone'=new.phone and ir.error is null order by row_num limit 1;
  if d is not null then new.metadata:=coalesce(d->'metadata','{}');new.external_id:=coalesce(d->>'external_id','');new.source:=coalesce(d->>'source','');new.tags:=array(select jsonb_array_elements_text(coalesce(d->'tags','[]')));end if;
 end if;return new;
end $$;
create trigger import_context before insert on public.px_businesses for each row execute function px_private.import_context();
