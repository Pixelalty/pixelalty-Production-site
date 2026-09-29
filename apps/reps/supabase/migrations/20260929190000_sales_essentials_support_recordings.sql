-- Pixelalty Essentials replaces the rep-facing legacy curriculum without
-- deleting historical content or completion receipts.
update public.px_content
set required=false
where active and required and kind in ('lesson','quiz');

update public.px_content
set active=false,required=false
where kind='lesson' and slug='pixelalty-essentials' and active;

insert into public.px_content(kind,slug,title,body,version,required,active)
values(
 'lesson','pixelalty-essentials','Pixelalty Essentials',
 'Pixelalty Essentials covers the current packages, fixed commissions, assigned sales codes, and the required CRM workflow.',
 coalesce((select max(version)+1 from public.px_content where kind='lesson' and slug='pixelalty-essentials'),1),
 true,true
);

-- A conservative application quota leaves headroom below the Supabase Free
-- plan storage allowance. A 50-minute, 96 kbps recording is about 36 MB.
update public.px_settings
set value=value||jsonb_build_object(
 'recording_quota_bytes',900000000,
 'recording_max_bytes',45000000,
 'recording_max_seconds',3000
);

create table public.px_call_recordings(
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 rep_id uuid not null references public.px_reps(id),
 business_id uuid references public.px_businesses(id),
 call_id uuid references public.px_calls(id),
 deal_id uuid references public.px_deals(id),
 object_key text not null unique check(object_key~'^[0-9a-f-]{36}/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(webm|ogg|mp4)$'),
 title text not null default '' check(length(title)<=120 and title!~'[[:cntrl:]]'),
 note text not null default '' check(length(note)<=2000 and note!~'[[:cntrl:]]'),
 markers jsonb not null default '[]' check(jsonb_typeof(markers)='array' and jsonb_array_length(markers)<=100),
 status text not null default 'uploading' check(status in ('uploading','ready','delete_pending','deleted','upload_failed')),
 mime_type text not null check(mime_type in ('audio/webm','audio/ogg','audio/mp4')),
 codec text not null check(length(codec) between 1 and 80),
 size_bytes bigint not null check(size_bytes between 1 and 45000000),
 duration_seconds numeric(9,3) not null check(duration_seconds>0 and duration_seconds<=3000),
 device_label text not null default '' check(length(device_label)<=200 and device_label!~'[[:cntrl:]]'),
 recorded_at timestamptz not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz,
 deleted_by uuid references px_private.identities(id)
);
create index px_call_recordings_rep on public.px_call_recordings(rep_id,recorded_at desc);
create index px_call_recordings_business on public.px_call_recordings(business_id,recorded_at desc) where deleted_at is null;
create index px_call_recordings_call on public.px_call_recordings(call_id) where call_id is not null;
create index px_call_recordings_deal on public.px_call_recordings(deal_id) where deal_id is not null;
create index px_call_recordings_status on public.px_call_recordings(status,created_at);
alter table public.px_call_recordings enable row level security;
revoke all on public.px_call_recordings from public,anon,authenticated;
grant select on public.px_call_recordings to authenticated;
grant all on public.px_call_recordings to service_role;
create policy call_recordings_read on public.px_call_recordings for select to authenticated using(
 rep_id=(select auth.uid()) or px_private.has_role(array['sales_admin','compliance_admin'])
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('call-recordings','call-recordings',false,45000000,array['audio/webm','audio/ogg','audio/mp4'])
on conflict(id) do update set public=false,file_size_limit=45000000,allowed_mime_types=excluded.allowed_mime_types;

create policy call_recordings_object_insert on storage.objects for insert to authenticated with check(
 bucket_id='call-recordings'
 and split_part(name,'/',1)=(select auth.uid())::text
 and exists(
  select 1 from public.px_call_recordings r
  where r.object_key=name and r.rep_id=(select auth.uid()) and r.status='uploading'
 )
);
create policy call_recordings_object_read on storage.objects for select to authenticated using(
 bucket_id='call-recordings' and exists(
  select 1 from public.px_call_recordings r
  where r.object_key=name and r.status='ready' and r.deleted_at is null
   and (r.rep_id=(select auth.uid()) or px_private.has_role(array['sales_admin','compliance_admin']))
 )
);

alter function px_private.onboarding(uuid) rename to onboarding_before_essentials;
revoke all on function px_private.onboarding_before_essentials(uuid) from public,anon,authenticated;
create function px_private.onboarding(rid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;steps jsonb;essential public.px_content;complete boolean;ready boolean;
begin
 result:=px_private.onboarding_before_essentials(rid);
 select * into essential from public.px_content where kind='lesson' and slug='pixelalty-essentials' and active order by version desc limit 1;
 complete:=essential.id is not null and exists(select 1 from public.px_training where rep_id=rid and content_id=essential.id and passed);
 select coalesce(jsonb_agg(
  case when s->>'key'='training' then s||jsonb_build_object(
   'key','essentials','title','Pixelalty Essentials','complete',complete,'required',true,'actor','rep',
   'message',case when complete then 'Pixelalty Essentials completed.' else 'Read the two short getting-started sections and confirm your understanding.' end,
   'link','/academy','action',case when complete then null else 'Complete Getting Started' end)
  else s end order by ord),'[]') into steps
 from jsonb_array_elements(result->'steps') with ordinality a(s,ord)
 where s->>'key'<>'quiz';
 ready:=not exists(select 1 from jsonb_array_elements(steps) s where (s->>'required')::boolean and not (s->>'complete')::boolean and s->>'key'<>'activation');
 return result||jsonb_build_object('steps',steps,'ready',ready,'essentials_completed',complete,'essentials_content_id',essential.id);
end$$;
revoke all on function px_private.onboarding(uuid) from public,anon,authenticated;

alter function px_private.action(text,jsonb) rename to action_before_essentials_recordings;
revoke all on function px_private.action_before_essentials_recordings(text,jsonb) from public,anon,authenticated;
create function px_private.action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();r public.px_call_recordings;essential_id uuid;uid_text text:=uid::text;yy text;mm text;ext text;is_admin boolean;why text:=trim(coalesce(p->>'reason',''));stored_size bigint;object_mime text;
begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();
 if action='content' and (p->>'slug'='pixelalty-essentials' or (p->>'kind' in ('lesson','quiz') and coalesce((p->>'required')::boolean,false))) then
  raise exception 'Pixelalty Essentials is the only required rep training. Publish legacy lessons and quizzes as optional content.';
 end if;
 if action='essentials_complete' then
  if (p-array['acknowledged'])<>'{}'::jsonb or coalesce((p->>'acknowledged')::boolean,false) is not true then raise exception 'Confirm that you have read and understand Pixelalty Essentials.';end if;
  select id into essential_id from public.px_content where kind='lesson' and slug='pixelalty-essentials' and active and required order by version desc limit 1;
  if essential_id is null then raise exception 'Pixelalty Essentials is not available right now.';end if;
  if not exists(select 1 from public.px_training t where t.rep_id=uid and t.content_id=essential_id and t.passed) then
   insert into public.px_training(rep_id,content_id,passed) values(uid,essential_id,true);
   insert into public.px_xp(rep_id,source,source_id,amount)
   select uid,'training',essential_id,coalesce((value->>'xp_training')::int,25)
   from public.px_settings
   limit 1
   on conflict do nothing;
   perform px_private.audit(action,essential_id::text,'Rep confirmed Pixelalty Essentials');
  end if;
  return jsonb_build_object('completed',true,'content_id',essential_id);
 elsif action='recording_quota' then
  perform px_private.require_role(array['sales_admin']);
  if (p->>'quota_bytes')::bigint not between 100000000 and 950000000 then raise exception 'Choose a recording quota from 100 MB through 950 MB.';end if;
  if (p->>'quota_bytes')::bigint<(select coalesce(sum(size_bytes),0) from public.px_call_recordings where status='ready' and deleted_at is null) then raise exception 'The quota cannot be lower than current recording usage.';end if;
  update public.px_settings set value=jsonb_set(value,'{recording_quota_bytes}',to_jsonb((p->>'quota_bytes')::bigint),true) where id;
  perform px_private.audit(action,'recording-storage','Administrator changed the recording storage quota',jsonb_build_object('quota_bytes',(p->>'quota_bytes')::bigint));
  return jsonb_build_object('quota_bytes',(p->>'quota_bytes')::bigint);
 elsif action='recording_begin' then
  if (p-array['request_id','business_id','call_id','deal_id','title','note','markers','mime_type','codec','size_bytes','duration_seconds','device_label','recorded_at'])<>'{}'::jsonb then raise exception 'Unsupported recording fields were provided.';end if;
  select * into r from public.px_call_recordings where request_id=(p->>'request_id')::uuid and rep_id=uid for update;
  if r.id is not null then
   if r.status='uploading' then
    select coalesce((o.metadata->>'size')::bigint,0),coalesce(o.metadata->>'mimetype','') into stored_size,object_mime from storage.objects o where o.bucket_id='call-recordings' and o.name=r.object_key;
    if stored_size=r.size_bytes and object_mime=r.mime_type then
     update public.px_call_recordings set status='ready',updated_at=now() where id=r.id returning * into r;
     perform px_private.audit('recording_finalize',r.id::text,'Recovered a completed private recording upload',jsonb_build_object('bytes',r.size_bytes));
    end if;
   end if;
   return to_jsonb(r);
  end if;
  if (p->>'mime_type') not in ('audio/webm','audio/ogg','audio/mp4') or (p->>'size_bytes')::bigint not between 1 and 45000000 or (p->>'duration_seconds')::numeric<=0 or (p->>'duration_seconds')::numeric>3000 then raise exception 'The recording is empty, too long, or exceeds the 45 MB limit.';end if;
  if length(coalesce(p->>'codec','')) not between 1 and 80 or length(coalesce(p->>'title',''))>120 or length(coalesce(p->>'note',''))>2000 or length(coalesce(p->>'device_label',''))>200 then raise exception 'Recording details exceed the supported length.';end if;
  if jsonb_typeof(coalesce(p->'markers','[]'))<>'array' or jsonb_array_length(coalesce(p->'markers','[]'))>100 then raise exception 'Recording markers are invalid.';end if;
  if nullif(p->>'business_id','') is not null and not exists(select 1 from public.px_businesses where id=(p->>'business_id')::uuid and owner_id=uid) then raise exception 'Choose one of your assigned businesses.' using errcode='42501';end if;
  if nullif(p->>'call_id','') is not null and not exists(select 1 from public.px_calls where id=(p->>'call_id')::uuid and rep_id=uid) then raise exception 'Choose one of your calls.' using errcode='42501';end if;
  if nullif(p->>'deal_id','') is not null and not exists(select 1 from public.px_deals where id=(p->>'deal_id')::uuid and rep_id=uid) then raise exception 'Choose one of your deals.' using errcode='42501';end if;
  if nullif(p->>'business_id','') is not null and nullif(p->>'call_id','') is not null and not exists(select 1 from public.px_calls where id=(p->>'call_id')::uuid and business_id=(p->>'business_id')::uuid) then raise exception 'The selected call does not belong to that business.';end if;
  if nullif(p->>'business_id','') is not null and nullif(p->>'deal_id','') is not null and not exists(select 1 from public.px_deals where id=(p->>'deal_id')::uuid and business_id=(p->>'business_id')::uuid) then raise exception 'The selected deal does not belong to that business.';end if;
  if (select coalesce(sum(size_bytes),0) from public.px_call_recordings where status='ready' and deleted_at is null)+(p->>'size_bytes')::bigint>(select (value->>'recording_quota_bytes')::bigint from public.px_settings where id) then raise exception 'Recording storage is full. Ask an administrator to review saved recordings.';end if;
  yy:=to_char(now(),'YYYY');mm:=to_char(now(),'MM');ext:=case p->>'mime_type' when 'audio/ogg' then 'ogg' when 'audio/mp4' then 'mp4' else 'webm' end;
  r.id:=gen_random_uuid();r.object_key:=uid_text||'/'||yy||'/'||mm||'/'||r.id||'.'||ext;
  insert into public.px_call_recordings(id,request_id,rep_id,business_id,call_id,deal_id,object_key,title,note,markers,mime_type,codec,size_bytes,duration_seconds,device_label,recorded_at)
  values(r.id,(p->>'request_id')::uuid,uid,nullif(p->>'business_id','')::uuid,nullif(p->>'call_id','')::uuid,nullif(p->>'deal_id','')::uuid,r.object_key,trim(coalesce(p->>'title','')),trim(coalesce(p->>'note','')),coalesce(p->'markers','[]'),p->>'mime_type',p->>'codec',(p->>'size_bytes')::bigint,(p->>'duration_seconds')::numeric,left(coalesce(p->>'device_label',''),200),(p->>'recorded_at')::timestamptz)
  returning * into r;
  return to_jsonb(r);
 elsif action='recording_finalize' then
  select * into r from public.px_call_recordings where id=(p->>'id')::uuid and rep_id=uid for update;
  if r.id is null then raise exception 'Recording not found.' using errcode='42501';end if;
  if r.status='ready' then return to_jsonb(r);end if;
  if r.status<>'uploading' then raise exception 'This recording can no longer be finalized.';end if;
  select coalesce((o.metadata->>'size')::bigint,0),coalesce(o.metadata->>'mimetype','') into stored_size,object_mime from storage.objects o where o.bucket_id='call-recordings' and o.name=r.object_key;
  if stored_size<>r.size_bytes or object_mime<>r.mime_type then raise exception 'The uploaded recording could not be verified. Keep the recording and retry the upload.';end if;
  update public.px_call_recordings set status='ready',updated_at=now() where id=r.id returning * into r;
  perform px_private.audit(action,r.id::text,'Private call recording stored',jsonb_build_object('bytes',r.size_bytes,'duration_seconds',r.duration_seconds,'mime_type',r.mime_type));
  return to_jsonb(r);
 elsif action='recording_access' then
  select * into r from public.px_call_recordings where id=(p->>'id')::uuid and status='ready' and deleted_at is null;
  if r.id is null then raise exception 'Recording not found.';end if;
  is_admin:=r.rep_id<>uid;
  if is_admin then perform px_private.require_role(array['sales_admin','compliance_admin']);end if;
  if not is_admin and r.rep_id<>uid then raise exception 'Recording not found.' using errcode='42501';end if;
  if is_admin or coalesce((p->>'download')::boolean,false) then perform px_private.audit(case when (p->>'download')::boolean then 'recording_download' else 'recording_playback' end,r.id::text,'Authorized private recording access');end if;
  return jsonb_build_object('id',r.id,'object_key',r.object_key,'mime_type',r.mime_type,'title',r.title);
 elsif action='recording_delete_begin' then
  select * into r from public.px_call_recordings where id=(p->>'id')::uuid and status in ('uploading','ready','upload_failed','delete_pending') and deleted_at is null for update;
  if r.id is null then raise exception 'Recording not found.';end if;
  is_admin:=r.rep_id<>uid;
  if is_admin then
   perform px_private.require_role(array['sales_admin','compliance_admin']);
   if length(why)<5 then raise exception 'Enter a deletion reason of at least five characters.';end if;
  elsif coalesce((p->>'confirmed')::boolean,false) is not true then raise exception 'Confirm that you want to delete this recording.';end if;
  update public.px_call_recordings set status='delete_pending',deleted_by=uid,updated_at=now() where id=r.id;
  perform px_private.audit(action,r.id::text,case when is_admin then why else 'Rep confirmed deletion' end,jsonb_build_object('rep_id',r.rep_id,'bytes',r.size_bytes));
  return jsonb_build_object('id',r.id,'object_key',r.object_key);
 elsif action in ('recording_delete_complete','recording_delete_restore') then
  select * into r from public.px_call_recordings where id=(p->>'id')::uuid and status='delete_pending' for update;
  if r.id is null then raise exception 'Recording deletion is not pending.';end if;
  if r.rep_id<>uid then perform px_private.require_role(array['sales_admin','compliance_admin']);end if;
  if action='recording_delete_complete' then
   update public.px_call_recordings set status='deleted',deleted_at=now(),updated_at=now() where id=r.id;
   perform px_private.audit(action,r.id::text,'Private recording object removed');
  else update public.px_call_recordings set status='ready',deleted_by=null,updated_at=now() where id=r.id;
  end if;
  return '{}';
 end if;
 return px_private.action_before_essentials_recordings(action,p);
end$$;
revoke all on function px_private.action(text,jsonb) from public,anon;
grant execute on function px_private.action(text,jsonb) to authenticated;
create or replace function public.px_action(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.action(action,p)$$;

alter function px_private.report(text,jsonb) rename to report_before_essentials_recordings;
revoke all on function px_private.report_before_essentials_recordings(text,jsonb) from public,anon,authenticated;
create function px_private.report(kind text,p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();admin_view boolean:=coalesce((p->>'admin')::boolean,false);pg int:=greatest(0,least(10000,coalesce((p->>'page')::int,0)));q text:=left(trim(coalesce(p->>'q','')),100);status_filter text:=coalesce(p->>'status','ready');result jsonb;quota bigint;used bigint;warning int;
begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();
 if kind='recordings' then
  if admin_view then perform px_private.require_role(array['sales_admin','compliance_admin']);end if;
  if status_filter not in ('all','uploading','ready','upload_failed','deleted') then status_filter:='ready';end if;
  select (value->>'recording_quota_bytes')::bigint into quota from public.px_settings where id;
  select coalesce(sum(size_bytes),0) into used from public.px_call_recordings where status='ready' and deleted_at is null;
  warning:=case when used>=quota*95/100 then 95 when used>=quota*85/100 then 85 when used>=quota*70/100 then 70 else 0 end;
  select jsonb_build_object(
   'rows',coalesce(jsonb_agg(to_jsonb(x)),'[]'),
   'total',(select count(*) from public.px_call_recordings rr left join public.px_reps rp on rp.id=rr.rep_id left join public.px_businesses bb on bb.id=rr.business_id where (admin_view or rr.rep_id=uid) and (status_filter='all' or rr.status=status_filter) and (q='' or rr.title ilike '%'||q||'%' or rr.note ilike '%'||q||'%' or rp.name ilike '%'||q||'%' or bb.name ilike '%'||q||'%')),
   'usage',jsonb_build_object('bytes',used,'quota_bytes',quota,'percent',case when quota>0 then round(100.0*used/quota,1) else 0 end,'warning',warning,'count',(select count(*) from public.px_call_recordings where status='ready' and deleted_at is null),'max_bytes',(select (value->>'recording_max_bytes')::bigint from public.px_settings where id),'max_seconds',(select (value->>'recording_max_seconds')::int from public.px_settings where id))
  ) into result from (
   select rr.id,rr.rep_id,rp.name rep_name,rp.code rep_code,rr.business_id,bb.name business_name,rr.call_id,rr.deal_id,rr.title,rr.note,rr.markers,rr.status,rr.mime_type,rr.codec,rr.size_bytes,rr.duration_seconds,rr.device_label,rr.recorded_at,rr.created_at
   from public.px_call_recordings rr join public.px_reps rp on rp.id=rr.rep_id left join public.px_businesses bb on bb.id=rr.business_id
   where (admin_view or rr.rep_id=uid) and (status_filter='all' or rr.status=status_filter) and (q='' or rr.title ilike '%'||q||'%' or rr.note ilike '%'||q||'%' or rp.name ilike '%'||q||'%' or bb.name ilike '%'||q||'%')
   order by case when p->>'sort'='size' and p->>'direction'='asc' then rr.size_bytes end asc,case when p->>'sort'='size' then rr.size_bytes end desc,case when p->>'sort'='duration' and p->>'direction'='asc' then rr.duration_seconds end asc,case when p->>'sort'='duration' then rr.duration_seconds end desc,case when p->>'direction'='asc' then rr.recorded_at end asc,rr.recorded_at desc,rr.id
   limit 50 offset pg*50
  )x;
  return result;
 elsif kind='recording_options' then
  return jsonb_build_object(
   'businesses',(select coalesce(jsonb_agg(x),'[]') from (select id,name,code from public.px_businesses where owner_id=uid and not archived order by name limit 200)x),
   'calls',(select coalesce(jsonb_agg(x),'[]') from (select c.id,c.business_id,c.outcome,c.created_at,b.name business_name from public.px_calls c join public.px_businesses b on b.id=c.business_id where c.rep_id=uid order by c.created_at desc limit 100)x),
   'deals',(select coalesce(jsonb_agg(x),'[]') from (select d.id,d.business_id,d.code,d.package_name,d.created_at,b.name business_name from public.px_deals d join public.px_businesses b on b.id=d.business_id where d.rep_id=uid order by d.created_at desc limit 100)x)
  );
 end if;
 return px_private.report_before_essentials_recordings(kind,p);
end$$;
revoke all on function px_private.report(text,jsonb) from public,anon;
grant execute on function px_private.report(text,jsonb) to authenticated;
create or replace function public.px_report(kind text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.report(kind,p)$$;

comment on table public.px_call_recordings is 'Private room-audio microphone recordings. Metadata only; audio objects are stored in the private call-recordings bucket.';
