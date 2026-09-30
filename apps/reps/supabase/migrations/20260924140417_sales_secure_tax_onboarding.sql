-- Tax PDFs remain private objects. Only status and audit metadata are stored here;
-- never extract a TIN, SSN, form field, original filename, or PDF contents.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pixelalty-tax-documents','pixelalty-tax-documents',false,5242880,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['application/pdf'];
-- A restrictive policy also prevents an unrelated permissive storage policy from
-- accidentally exposing this bucket. All object IO is through the authorized Worker.
create policy pixelalty_tax_server_only on storage.objects as restrictive for all
to anon,authenticated using(bucket_id<>'pixelalty-tax-documents')
with check(bucket_id<>'pixelalty-tax-documents');

create table px_private.tax_documents(
 id uuid primary key default gen_random_uuid(),rep_id uuid not null references public.px_reps(id),
 request_id uuid not null,object_key text not null unique,
 bytes int not null check(bytes between 100 and 5242880),sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 status text not null default 'uploading' check(status in ('uploading','submitted','under_review','verified','needs_correction','archived','failed')),
 current boolean not null default false,correction_reason text not null default '',
 created_at timestamptz not null default now(),submitted_at timestamptz,reviewed_at timestamptz,
 unique(rep_id,request_id),check(object_key=rep_id::text||'/'||id::text||'.pdf')
);
create unique index px_tax_current on px_private.tax_documents(rep_id) where current;
create index px_tax_review_queue on px_private.tax_documents(submitted_at) where current and status in ('submitted','under_review');
create index px_tax_rep_history on px_private.tax_documents(rep_id,created_at desc);
create table px_private.tax_events(
 id uuid primary key default gen_random_uuid(),document_id uuid not null references px_private.tax_documents(id),
 rep_id uuid not null references public.px_reps(id),actor_id uuid not null references auth.users(id),
 event text not null check(event in ('uploaded','downloaded','under_review','verified','needs_correction','replaced','archived')),
 reason text not null default '',created_at timestamptz not null default now()
);
create index px_tax_event_document on px_private.tax_events(document_id,created_at);
create index px_tax_event_rep on px_private.tax_events(rep_id,created_at);
create index px_tax_event_actor on px_private.tax_events(actor_id);
alter table px_private.tax_documents enable row level security;
alter table px_private.tax_events enable row level security;
revoke all on px_private.tax_documents,px_private.tax_events from public,anon,authenticated;
grant all on px_private.tax_documents,px_private.tax_events to service_role;
create trigger px_tax_events_immutable before update or delete on px_private.tax_events for each row execute function px_private.immutable();

create function px_private.tax_summary(rid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare doc px_private.tax_documents; result jsonb;
begin
 if auth.uid() is null or (rid<>auth.uid() and not px_private.has_role(array['finance_admin'])) then raise exception 'Not authorized.' using errcode='42501';end if;
 select * into doc from px_private.tax_documents where rep_id=rid and current;
 result:=jsonb_build_object('status',coalesce(doc.status,'not_submitted'),'document',case when doc.id is null then null else jsonb_build_object('id',doc.id,'status',doc.status,'bytes',doc.bytes,'submitted_at',doc.submitted_at,'reviewed_at',doc.reviewed_at,'correction_reason',doc.correction_reason) end);
 if px_private.has_role(array['finance_admin']) then
  result:=result||jsonb_build_object('history',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'status',d.status,'current',d.current,'submitted_at',d.submitted_at,'bytes',d.bytes) order by d.created_at desc),'[]') from px_private.tax_documents d where d.rep_id=rid and d.submitted_at is not null),
   'events',(select coalesce(jsonb_agg(jsonb_build_object('event',e.event,'reason',e.reason,'actor',coalesce(r.name,'Pixelalty team'),'created_at',e.created_at) order by e.created_at desc),'[]') from px_private.tax_events e left join public.px_reps r on r.id=e.actor_id where e.rep_id=rid));
 end if;return result;
end $$;
revoke all on function px_private.tax_summary(uuid) from public,anon,authenticated;

create function px_private.tax(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();rid uuid;did uuid;doc px_private.tax_documents;why text;new_status text;
begin
 if uid is null then raise exception 'Sign in required.' using errcode='42501';end if;
 rid:=coalesce(nullif(p->>'rep_id','')::uuid,uid);
 if action='summary' then return px_private.tax_summary(rid);end if;
 if action='upload_begin' then
  rid:=uid;
  perform 1 from public.px_reps r join public.px_rep_private pr on pr.rep_id=r.id where r.id=rid and r.status in ('onboarding','active') and pr.classification='contractor' for update of r;
  if not found then raise exception 'Pixelalty must review your contractor classification before you can submit a W-9.';end if;
  select * into doc from px_private.tax_documents where rep_id=rid and request_id=(p->>'request_id')::uuid;
  if doc.id is not null then
   if doc.sha256 is distinct from p->>'sha256' or doc.bytes is distinct from (p->>'bytes')::int then raise exception 'This upload attempt belongs to a different file. Select the file again.';end if;
   return jsonb_build_object('id',doc.id,'object_key',doc.object_key,'status',doc.status);
  end if;
  if (select count(*) from px_private.tax_documents where rep_id=rid and created_at>now()-interval '24 hours')>=10 then raise exception 'You have reached today''s document upload limit. Contact Pixelalty for help.';end if;
  did:=gen_random_uuid();
  insert into px_private.tax_documents(id,rep_id,request_id,object_key,bytes,sha256) values(did,rid,(p->>'request_id')::uuid,rid::text||'/'||did::text||'.pdf',(p->>'bytes')::int,p->>'sha256') returning * into doc;
  return jsonb_build_object('id',doc.id,'object_key',doc.object_key,'status',doc.status);
 end if;
 perform px_private.require_role(array['finance_admin']);
 select rep_id into rid from px_private.tax_documents where id=(p->>'id')::uuid;
 if rid is null then raise exception 'Tax document not found.';end if;
 perform 1 from public.px_reps where id=rid for update;
 select * into doc from px_private.tax_documents where id=(p->>'id')::uuid for update;
 if action in ('download','download_authorize') then
  if doc.submitted_at is null then raise exception 'This document has not been submitted.';end if;
  if action='download' then insert into px_private.tax_events(document_id,rep_id,actor_id,event) values(doc.id,rid,uid,'downloaded');end if;
  return jsonb_build_object('object_key',doc.object_key);
 end if;
 if not doc.current then raise exception 'This document was replaced or archived. Refresh and review the current submission.';end if;
 if action='start_review' then
  if doc.status not in ('submitted','under_review') then raise exception 'Only a submitted document can enter review.';end if;
  new_status:='under_review';why:='Finance review started';
 elsif action='verify' then
  if doc.status not in ('submitted','under_review') then raise exception 'Review the current submitted document before verification.';end if;
  if not exists(select 1 from px_private.tax_events where document_id=doc.id and actor_id=uid and event='downloaded') then raise exception 'Download and review this submission before verifying it.';end if;
  new_status:='verified';why:='Completed document reviewed by Finance';
 elsif action='request_correction' then
  new_status:='needs_correction';
  why:=case p->>'reason_code' when 'signature' then 'Please add the required signature and date.' when 'incomplete' then 'Please complete the required fields.' when 'unreadable' then 'Please upload a clear, readable PDF.' when 'wrong_document' then 'Please upload the completed applicable tax form.' when 'updated_form' then 'Please submit an updated tax form.' end;
  if why is null then raise exception 'Select a correction reason.';end if;
 elsif action='archive' then
  new_status:='archived';
  why:=case p->>'reason_code' when 'incorrect' then 'Incorrect document' when 'requested' then 'Account holder requested archive' when 'retention' then 'Archived under the approved retention policy' end;
  if why is null then raise exception 'Select an archive reason.';end if;
 else raise exception 'Unknown tax document action.';end if;
 update px_private.tax_documents set status=new_status,current=new_status<>'archived',reviewed_at=now(),correction_reason=case when new_status='needs_correction' then why else '' end where id=doc.id;
 update public.px_rep_private set tax_status=case when new_status='verified' then 'verified' else 'pending' end where rep_id=rid;
 insert into px_private.tax_events(document_id,rep_id,actor_id,event,reason) values(doc.id,rid,uid,new_status,why);
 if new_status in ('needs_correction','verified','archived') then
  insert into public.px_notifications(rep_id,title,body) values(rid,
   case new_status when 'verified' then 'Tax document verified' when 'archived' then 'Tax document archived' else 'Tax document needs correction' end,
   case new_status when 'verified' then 'Finance has completed your tax-document review.' when 'archived' then 'Your previous document was archived. Open Onboarding to review your next steps.' else why||' Open Onboarding to submit your corrected PDF securely.' end);
 end if;
 return px_private.tax_summary(rid);
end $$;
revoke all on function px_private.tax(text,jsonb) from public,anon;
grant execute on function px_private.tax(text,jsonb) to authenticated;
create function public.px_tax(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.tax(action,p)$$;
revoke all on function public.px_tax(text,jsonb) from public,anon;
grant execute on function public.px_tax(text,jsonb) to authenticated;

-- Only the server can attest that a validated PDF reached private Storage.
create function px_private.tax_complete(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare doc px_private.tax_documents;rid uuid;previous uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Server authorization required.' using errcode='42501';end if;
 select rep_id into rid from px_private.tax_documents where id=(p->>'id')::uuid;
 if rid is null then raise exception 'Upload not found.';end if;
 perform 1 from public.px_reps where id=rid for update;
 select * into doc from px_private.tax_documents where id=(p->>'id')::uuid for update;
 if doc.status<>'uploading' then return jsonb_build_object('id',doc.id,'status',doc.status);end if;
 if not exists(select 1 from public.px_reps r join public.px_rep_private pr on pr.rep_id=r.id where r.id=rid and r.status in ('onboarding','active') and pr.classification='contractor') then raise exception 'This account can no longer submit contractor documents.';end if;
 if not exists(select 1 from storage.objects where bucket_id='pixelalty-tax-documents' and name=doc.object_key) then raise exception 'The upload is not complete. Retry the same file.';end if;
 select id into previous from px_private.tax_documents where rep_id=rid and current;
 if previous is not null then
  update px_private.tax_documents set current=false,status='archived' where id=previous;
  insert into px_private.tax_events(document_id,rep_id,actor_id,event,reason) values(previous,rid,rid,'replaced','Replaced by a new submission');
 end if;
 update px_private.tax_documents set current=true,status='submitted',submitted_at=now() where id=doc.id;
 update public.px_rep_private set tax_status='pending' where rep_id=rid;
 insert into px_private.tax_events(document_id,rep_id,actor_id,event) values(doc.id,rid,rid,'uploaded');
 return jsonb_build_object('id',doc.id,'status','submitted');
end $$;
revoke all on function px_private.tax_complete(jsonb) from public,anon,authenticated;
grant execute on function px_private.tax_complete(jsonb) to service_role;
create function public.px_tax_complete(p jsonb) returns jsonb language sql security invoker set search_path='' as $$select px_private.tax_complete(p)$$;
revoke all on function public.px_tax_complete(jsonb) from public,anon,authenticated;
grant execute on function public.px_tax_complete(jsonb) to service_role;

-- One readiness definition drives both the checklist and the activation gate.
create function px_private.onboarding(rid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.px_reps;pr public.px_rep_private;c public.px_connect;cfg jsonb;steps jsonb;agreement_available boolean;tax_state text;ready boolean;
begin
 if auth.uid() is null or (rid<>auth.uid() and not px_private.has_role(array['sales_admin','finance_admin'])) then raise exception 'Not authorized.' using errcode='42501';end if;
 select * into r from public.px_reps where id=rid;
 if r.id is null then raise exception 'Rep not found.';end if;
 select * into pr from public.px_rep_private where rep_id=rid;
 select * into c from public.px_connect where rep_id=rid;
 select value into cfg from public.px_settings;
 select exists(select 1 from public.px_content where kind='agreement' and active and required) into agreement_available;
 select status into tax_state from px_private.tax_documents where rep_id=rid and current;
 tax_state:=coalesce(tax_state,'not_submitted');
 select jsonb_agg(jsonb_build_object('key',key,'title',title,'complete',coalesce(complete,false),'required',required,'actor',actor,'message',message,'link',link,'action',action_label) order by ord) into steps from (
  select 1 ord,'account' key,'Account created' title,true complete,true required,'rep' actor,'Your Pixelalty account is ready.' message,'/profile' link,'View profile' action_label
  union all select 2,'email','Email verified',exists(select 1 from auth.users where id=rid and email_confirmed_at is not null),true,'rep','Use the verification email to confirm your address.','/profile','Manage email verification'
  union all select 3,'profile','Profile completed',r.profile_completed_at is not null,(cfg->>'require_profile')::boolean,'rep','Save your name and timezone.','/profile','Complete profile'
  union all select 4,'agreement','Required agreements accepted',agreement_available and not exists(select 1 from public.px_content x where x.kind='agreement' and x.active and x.required and not exists(select 1 from public.px_agreements a where a.rep_id=rid and a.content_id=x.id)),(cfg->>'require_agreement')::boolean,case when agreement_available then 'rep' else 'admin' end,case when agreement_available then 'Review and accept the current required agreement.' else 'Waiting for Pixelalty to publish your agreement.' end,'/onboarding?step=agreement','Review & Accept Agreement'
  union all select 5,'classification','Worker classification reviewed',pr.classification<>'unconfigured',true,'admin','Waiting for Pixelalty review.','/onboarding?step=classification',null
  union all select 6,'tax','Tax setup verified',pr.tax_status='verified' and (pr.classification<>'contractor' or tax_state='verified'),(cfg->>'require_tax')::boolean,case when pr.classification='contractor' and tax_state in ('not_submitted','needs_correction') then 'rep' else 'admin' end,case when pr.classification='unconfigured' then 'Waiting for Pixelalty to review your worker classification.' when pr.classification='employee' then 'Waiting for Pixelalty to verify your employee tax setup.' when tax_state='needs_correction' then 'Finance requested a corrected document.' when tax_state in ('submitted','under_review') then 'Waiting for Pixelalty Finance to review your document.' else 'Submit your completed, signed W-9 securely.' end,'/onboarding?step=tax',case when tax_state='needs_correction' then 'Replace W-9 securely' else 'Submit W-9 securely' end
  union all select 7,'payout','Payment setup ready',case when pr.classification='contractor' then c.transfers_enabled and c.payouts_enabled and c.checked_at>now()-interval '1 day' when pr.classification='employee' then pr.external_payout_verified else false end,(cfg->>'require_payout')::boolean,case when pr.classification='contractor' then 'rep' else 'admin' end,case when pr.classification='unconfigured' then 'Waiting for Pixelalty to review your worker classification before payout setup.' when pr.classification='employee' then 'Waiting for Pixelalty to verify your payroll setup.' else 'Complete secure payout setup, then check its status.' end,'/onboarding?step=payout','Set Up Payouts Securely'
  union all select 8,'training','Required training completed',not exists(select 1 from public.px_content x where x.kind='lesson' and x.active and x.required and not exists(select 1 from public.px_training t where t.rep_id=rid and t.content_id=x.id and t.passed)),true,'rep','Complete your required lessons in the Academy.','/academy','Continue training'
  union all select 9,'quiz','Readiness quiz passed',not exists(select 1 from public.px_content x where x.kind='quiz' and x.active and x.required and not exists(select 1 from public.px_training t where t.rep_id=rid and t.content_id=x.id and t.passed)),true,'rep','Pass the current readiness quiz in the Academy.','/academy','Take readiness quiz'
  union all select 10,'activation','Administrator activation',r.status='active',true,'admin','Waiting for Pixelalty activation.','/onboarding',null
 ) s;
 ready:=not exists(select 1 from jsonb_array_elements(steps) s where (s->>'required')::boolean and not (s->>'complete')::boolean and s->>'key'<>'activation');
 return jsonb_build_object('steps',steps,'status',r.status,'ready',ready,'rep',jsonb_build_object('id',r.id,'code',r.code,'name',r.name,'status',r.status),'classification',pr.classification,'tax_status',tax_state,'external_tax_status',pr.tax_status,'external_payout_verified',pr.external_payout_verified,'agreement_available',agreement_available,'payout',jsonb_build_object('started',c.rep_id is not null,'ready',coalesce(c.transfers_enabled and c.payouts_enabled,false),'checked_at',c.checked_at,'requirements_pending',coalesce(jsonb_array_length(c.requirements),0)>0));
end $$;
revoke all on function px_private.onboarding(uuid) from public,anon,authenticated;

alter function px_private.action(text,jsonb) rename to action_before_tax;
revoke execute on function px_private.action_before_tax(text,jsonb) from public,anon,authenticated;
create function px_private.action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid;why text:=trim(coalesce(p->>'reason',''));pr public.px_rep_private;readiness jsonb;missing text;did uuid;
begin
 if action in ('rep_classification','rep_payroll','rep_activate') then
  if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501';end if;
  rid:=(p->>'id')::uuid;
  if action='rep_payroll' then perform px_private.require_role(array['finance_admin']);else perform px_private.require_role(array['sales_admin']);end if;
  if length(why)<5 then raise exception 'Enter an audit reason of at least five characters.';end if;
  perform 1 from public.px_reps where id=rid for update;
  if not found then raise exception 'Rep not found.';end if;
  select * into pr from public.px_rep_private where rep_id=rid for update;
  if action='rep_classification' then
   if p->>'classification' is null or p->>'classification' not in ('contractor','employee') then raise exception 'Choose contractor or employee after the required review.';end if;
   if p ? 'tax_status' or p ? 'external_payout_verified' then raise exception 'Use Finance review to verify tax documents or payroll.';end if;
   if pr.classification is distinct from p->>'classification' then
    -- A classification change must never revive an old tax verification.
    update px_private.tax_documents set current=false,status='archived' where rep_id=rid and current returning id into did;
    if did is not null then insert into px_private.tax_events(document_id,rep_id,actor_id,event,reason) values(did,rid,auth.uid(),'archived','Worker classification changed');end if;
   end if;
   update public.px_rep_private set classification=p->>'classification',tax_status=case when classification=p->>'classification' then tax_status else 'pending' end,external_payout_verified=case when classification=p->>'classification' then external_payout_verified else false end where rep_id=rid;
   perform px_private.audit(action,rid::text,why,jsonb_build_object('before',pr.classification,'after',p->>'classification'));
   return '{}';
  elsif action='rep_payroll' then
   if pr.classification<>'employee' then raise exception 'Contractor tax documents and payouts use their secure onboarding workflows.';end if;
   update public.px_rep_private set tax_status=case when coalesce((p->>'tax_verified')::boolean,false) then 'verified' else 'pending' end,external_payout_verified=coalesce((p->>'payout_verified')::boolean,false) where rep_id=rid;
   perform px_private.audit(action,rid::text,why,jsonb_build_object('tax_verified',p->'tax_verified','payout_verified',p->'payout_verified'));return '{}';
  else
   readiness:=px_private.onboarding(rid);
   if not (readiness->>'ready')::boolean then
    select string_agg(s->>'title',', ') into missing from jsonb_array_elements(readiness->'steps') s where (s->>'required')::boolean and not (s->>'complete')::boolean and s->>'key'<>'activation';
    raise exception 'Can''t activate yet. Missing: %',missing;
   end if;
  end if;
 end if;
 return px_private.action_before_tax(action,p);
end $$;
revoke all on function px_private.action(text,jsonb) from public,anon;
grant execute on function px_private.action(text,jsonb) to authenticated;
create or replace function public.px_action(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.action(action,p)$$;

alter function px_private.report(text,jsonb) rename to report_before_tax;
revoke all on function px_private.report_before_tax(text,jsonb) from public,anon,authenticated;
create function px_private.report(kind text,p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rid uuid;result jsonb;can_sales boolean;can_finance boolean;page_no int:=greatest(1,least(100000,coalesce((p->>'page')::int,1)));
begin
 if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501';end if;
 if kind='onboarding' then
  if coalesce(p->>'code','')<>'' then select id into rid from public.px_reps where code=p->>'code';else rid:=coalesce(nullif(p->>'id','')::uuid,auth.uid());end if;
  result:=px_private.onboarding(rid);
  if px_private.has_role(array['sales_admin','finance_admin']) then
   result:=result||jsonb_build_object('classification_history',(select coalesce(jsonb_agg(jsonb_build_object('action',a.action,'reason',a.reason,'details',a.details,'actor',coalesce(r.name,'Pixelalty team'),'created_at',a.created_at) order by a.created_at desc),'[]') from public.px_audit a left join public.px_reps r on r.id=a.actor_id where a.target_id=rid::text and a.action in ('rep_classification','rep_payroll')));
  end if;
  return result;
 elsif kind='operations' then
  perform px_private.require_role(array['sales_admin','finance_admin']);
  can_sales:=px_private.has_role(array['sales_admin']);can_finance:=px_private.has_role(array['finance_admin']);
  return jsonb_build_object('applicants',case when can_sales then (select count(*) from public.px_applicants where rep_id is null and stage in ('new','review','interview','interview_scheduled','offer','approval_error')) else null end,
   'reps',(select coalesce(jsonb_agg(x),'[]') from (select r.code,r.name,r.status,px_private.onboarding(r.id) readiness from public.px_reps r where r.status='onboarding' order by r.created_at,r.id limit 50 offset (page_no-1)*50)x),
   'total',(select count(*) from public.px_reps where status='onboarding'),'page',page_no,
   'tax_review',case when can_finance then (select count(*) from px_private.tax_documents where current and status in ('submitted','under_review')) else null end,
   'failed_emails',(select count(*) from px_private.mail_outbox where status in ('failed','review')),
   'webhook_issues',case when can_finance then (select count(*) from public.px_stripe_events where status='failed') else null end,
   'can_review_tax',can_finance);
 elsif kind='tax_queue' then
  perform px_private.require_role(array['finance_admin']);
  return jsonb_build_object('total',(select count(*) from px_private.tax_documents where current),'page',page_no,'rows',(select coalesce(jsonb_agg(x),'[]') from (select d.id,r.code,r.name,d.status,d.bytes,d.submitted_at from px_private.tax_documents d join public.px_reps r on r.id=d.rep_id where d.current order by case when d.status in ('submitted','under_review') then 0 else 1 end,d.submitted_at,d.id limit 50 offset (page_no-1)*50)x));
 end if;
 return px_private.report_before_tax(kind,p);
end $$;
revoke all on function px_private.report(text,jsonb) from public,anon;
grant execute on function px_private.report(text,jsonb) to authenticated;
create or replace function public.px_report(kind text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.report(kind,p)$$;

-- Public recruiting never returns internal commissions, even without the UI.
create or replace function px_private.public_config() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('recruiting_open',(value->>'recruiting_open')::boolean,'title',value->>'recruiting_title','body',value->>'recruiting_body','requirements',value->>'recruiting_requirements') from public.px_settings
$$;
