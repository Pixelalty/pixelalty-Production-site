-- Record server-confirmed consent time and require an explicit consent assertion
-- before a private upload reservation can be created.
alter table public.px_call_recordings
add column consent_confirmed_at timestamptz not null default now();

alter function px_private.action(text,jsonb) rename to action_before_recording_consent;
revoke all on function px_private.action_before_recording_consent(text,jsonb) from public,anon,authenticated;
create function px_private.action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform px_private.require_access();
 perform px_private.require_enrolled_mfa();
 if action='recording_begin' then
  if coalesce((p->>'consent_confirmed')::boolean,false) is not true then
   raise exception 'Confirm participant consent before saving a recording.';
  end if;
  return px_private.action_before_recording_consent(action,p-'consent_confirmed');
 end if;
 return px_private.action_before_recording_consent(action,p);
end$$;
revoke all on function px_private.action(text,jsonb) from public,anon;
grant execute on function px_private.action(text,jsonb) to authenticated;
create or replace function public.px_action(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.action(action,p)$$;

-- Expand the authorized recordings report with the operational filters and
-- consent/context metadata required by the admin review workspace.
alter function px_private.report(text,jsonb) rename to report_before_recording_filters;
revoke all on function px_private.report_before_recording_filters(text,jsonb) from public,anon,authenticated;
create function px_private.report(kind text,p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 admin_view boolean:=coalesce((p->>'admin')::boolean,false);
 pg int:=greatest(0,least(10000,coalesce((p->>'page')::int,0)));
 q text:=left(trim(coalesce(p->>'q','')),100);
 business_q text:=left(trim(coalesce(p->>'business','')),100);
 status_filter text:=coalesce(p->>'status','ready');
 sort_field text:=coalesce(p->>'sort','date');
 sort_direction text:=coalesce(p->>'direction','desc');
 rep_filter uuid;
 from_day date;
 through_day date;
 min_duration numeric;
 max_duration numeric;
 result jsonb;
 quota bigint;
 used bigint;
 warning int;
begin
 perform px_private.require_access();
 perform px_private.require_enrolled_mfa();
 if kind<>'recordings' then
  return px_private.report_before_recording_filters(kind,p);
 end if;
 if admin_view then perform px_private.require_role(array['sales_admin','compliance_admin']);end if;
 if status_filter not in ('all','uploading','ready','upload_failed','deleted') then status_filter:='ready';end if;
 if sort_field not in ('date','duration','size') then sort_field:='date';end if;
 if sort_direction not in ('asc','desc') then sort_direction:='desc';end if;
 if admin_view and coalesce(p->>'rep_id','')<>'' then
  if (p->>'rep_id')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then raise exception 'Choose a valid rep filter.';end if;
  rep_filter:=(p->>'rep_id')::uuid;
 end if;
 if coalesce(p->>'date_from','')<>'' then from_day:=(p->>'date_from')::date;end if;
 if coalesce(p->>'date_to','')<>'' then through_day:=(p->>'date_to')::date;end if;
 if coalesce(p->>'min_duration','')~'^[0-9]{1,4}$' then min_duration:=greatest(0,least(3000,(p->>'min_duration')::numeric));end if;
 if coalesce(p->>'max_duration','')~'^[0-9]{1,4}$' then max_duration:=greatest(0,least(3000,(p->>'max_duration')::numeric));end if;
 if min_duration is not null and max_duration is not null and min_duration>max_duration then raise exception 'Minimum duration cannot exceed maximum duration.';end if;
 select (value->>'recording_quota_bytes')::bigint into quota from public.px_settings where id;
 select coalesce(sum(size_bytes),0) into used from public.px_call_recordings where status='ready' and deleted_at is null;
 warning:=case when used>=quota*95/100 then 95 when used>=quota*85/100 then 85 when used>=quota*70/100 then 70 else 0 end;
 with filtered as (
  select rr.id,rr.rep_id,rp.name rep_name,rp.code rep_code,rr.business_id,bb.name business_name,rr.call_id,rr.deal_id,rr.title,rr.note,rr.markers,rr.status,rr.mime_type,rr.codec,rr.size_bytes,rr.duration_seconds,rr.device_label,rr.recorded_at,rr.consent_confirmed_at,rr.created_at,rr.updated_at
  from public.px_call_recordings rr
  join public.px_reps rp on rp.id=rr.rep_id
  left join public.px_businesses bb on bb.id=rr.business_id
  where (case when admin_view then rep_filter is null or rr.rep_id=rep_filter else rr.rep_id=uid end)
   and (status_filter='all' or rr.status=status_filter)
   and (q='' or rr.title ilike '%'||q||'%' or rr.note ilike '%'||q||'%' or rp.name ilike '%'||q||'%' or bb.name ilike '%'||q||'%')
   and (business_q='' or bb.name ilike '%'||business_q||'%')
   and (from_day is null or rr.recorded_at>=from_day::timestamptz)
   and (through_day is null or rr.recorded_at<(through_day+1)::timestamptz)
   and (min_duration is null or rr.duration_seconds>=min_duration)
   and (max_duration is null or rr.duration_seconds<=max_duration)
 ), page_rows as (
  select * from filtered
  order by
   case when sort_field='size' and sort_direction='asc' then size_bytes end asc,
   case when sort_field='size' and sort_direction='desc' then size_bytes end desc,
   case when sort_field='duration' and sort_direction='asc' then duration_seconds end asc,
   case when sort_field='duration' and sort_direction='desc' then duration_seconds end desc,
   case when sort_field='date' and sort_direction='asc' then recorded_at end asc,
   case when sort_field='date' and sort_direction='desc' then recorded_at end desc,
   id
  limit 50 offset pg*50
 )
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(to_jsonb(x)) from page_rows x),'[]'),
  'total',(select count(*) from filtered),
  'reps',case when admin_view then coalesce((select jsonb_agg(to_jsonb(x)) from (select id,name,code from public.px_reps where status<>'deleted' order by name,code)x),'[]') else '[]'::jsonb end,
  'usage',jsonb_build_object('bytes',used,'quota_bytes',quota,'percent',case when quota>0 then round(100.0*used/quota,1) else 0 end,'warning',warning,'count',(select count(*) from public.px_call_recordings where status='ready' and deleted_at is null),'max_bytes',(select (value->>'recording_max_bytes')::bigint from public.px_settings where id),'max_seconds',(select (value->>'recording_max_seconds')::int from public.px_settings where id))
 ) into result;
 return result;
end$$;
revoke all on function px_private.report(text,jsonb) from public,anon;
grant execute on function px_private.report(text,jsonb) to authenticated;
create or replace function public.px_report(kind text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.report(kind,p)$$;
