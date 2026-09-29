-- Keep administrative recording-deletion lookups and foreign-key maintenance indexed.
create index px_call_recordings_deleted_by
on public.px_call_recordings(deleted_by)
where deleted_by is not null;
