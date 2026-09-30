-- Preserve the existing recording system and its history. Serialize new
-- reservations against the existing settings row, and verify Storage state
-- before marking an upload or deletion complete.
alter function px_private.action(text,jsonb) rename to action_before_recording_integrity;
revoke all on function px_private.action_before_recording_integrity(text,jsonb) from public,anon,authenticated;

create function px_private.action(action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 r public.px_call_recordings;
 reserved_bytes bigint;
 quota bigint;
 stored_size bigint;
 stored_mime text;
 result jsonb;
begin
 perform px_private.require_access();
 perform px_private.require_enrolled_mfa();

 if action in ('recording_begin','recording_quota') then
  -- Every reservation and quota edit takes this lock before any recording
  -- row lock. Pending uploads count too, so concurrent saves cannot overbook.
  select (value->>'recording_quota_bytes')::bigint into quota
  from public.px_settings where id for update;
  select coalesce(sum(size_bytes),0) into reserved_bytes
  from public.px_call_recordings where status<>'deleted';
  if action='recording_quota' then
   perform px_private.require_role(array['sales_admin']);
   if (p->>'quota_bytes')::bigint<reserved_bytes then
    raise exception 'The quota cannot be lower than saved recordings and pending uploads. Review unfinished uploads first.';
   end if;
  else
   select * into r from public.px_call_recordings
   where request_id=(p->>'request_id')::uuid and rep_id=uid for update;
   if found then
    if r.status in ('deleted','delete_pending') then
     raise exception 'This recording was deleted or is being deleted. Start a new recording.';
    end if;
   elsif reserved_bytes+(p->>'size_bytes')::bigint>quota then
    raise exception 'Recording storage is full. Ask an administrator to review saved recordings and unfinished uploads.';
   end if;
  end if;
 elsif action='recording_finalize' then
  select * into r from public.px_call_recordings
  where id=(p->>'id')::uuid and rep_id=uid for update;
  if not found then raise exception 'Recording not found.' using errcode='42501';end if;
  select (metadata->>'size')::bigint,metadata->>'mimetype'
  into stored_size,stored_mime from storage.objects
  where bucket_id='call-recordings' and name=r.object_key;
  if not found or stored_size is distinct from r.size_bytes or stored_mime is distinct from r.mime_type then
   raise exception 'The uploaded recording could not be verified. Keep the recording and retry the upload.';
  end if;
 elsif action in ('recording_delete_complete','recording_delete_restore') then
  select * into r from public.px_call_recordings
  where id=(p->>'id')::uuid and status='delete_pending' for update;
  if not found then raise exception 'Recording deletion is not pending.';end if;
  if r.rep_id<>uid then perform px_private.require_role(array['sales_admin','compliance_admin']);end if;
  if action='recording_delete_complete' and exists(
   select 1 from storage.objects where bucket_id='call-recordings' and name=r.object_key
  ) then
   raise exception 'The recording is still in private storage. Retry deletion before marking it removed.';
  end if;
  if action='recording_delete_restore' then
   result:=px_private.action_before_recording_integrity(action,p);
   -- A failed deletion of an unfinished upload must remain an upload, never
   -- become a playable recording without a verified object.
   if not exists(select 1 from storage.objects where bucket_id='call-recordings'
     and name=r.object_key and (metadata->>'size')::bigint=r.size_bytes
     and metadata->>'mimetype'=r.mime_type) then
    update public.px_call_recordings set status='uploading' where id=r.id;
   end if;
   return result;
  end if;
 end if;
 return px_private.action_before_recording_integrity(action,p);
end$$;
revoke all on function px_private.action(text,jsonb) from public,anon;
grant execute on function px_private.action(text,jsonb) to authenticated;
create or replace function public.px_action(action text,p jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select px_private.action(action,p)$$;
