alter table public.px_diagnostics add column provider_detail text;
alter function px_private.service_guard(text,jsonb) rename to service_before_diagnostics;
revoke all on function px_private.service_before_diagnostics(text,jsonb) from public,anon,authenticated,service_role;
create function px_private.service_guard(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=px_private.service_before_diagnostics(action,p);
 if action='diagnostic' then
  update public.px_diagnostics set provider_detail=left(p->>'provider_detail',600) where id=(p->>'id')::uuid;
 end if;
 return result;
end$$;
grant execute on function px_private.service_guard(text,jsonb) to service_role;
