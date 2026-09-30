-- Keep privileged implementations out of the exposed API schema. Both private
-- entry points enforce immediate account/session revocation before any reads.
alter function px_private.context() rename to context_before_access;
revoke all on function px_private.context_before_access() from public,anon,authenticated;
create function px_private.context() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform px_private.require_access();
 return px_private.context_before_access()||jsonb_build_object('career_xp',(select coalesce(sum(amount),0) from public.px_xp where rep_id=auth.uid()),'access_options',coalesce((select access_overrides from public.px_rep_private where rep_id=auth.uid()),'{}'));
end$$;
grant execute on function px_private.context() to authenticated;
create or replace function public.px_context() returns jsonb language sql security invoker set search_path='' as $$select px_private.context()$$;

alter function px_private.tax(text,jsonb) rename to tax_before_access;
revoke all on function px_private.tax_before_access(text,jsonb) from public,anon,authenticated;
create function px_private.tax(action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
begin perform px_private.require_access();return px_private.tax_before_access(action,p);end$$;
grant execute on function px_private.tax(text,jsonb) to authenticated;
create or replace function public.px_tax(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.tax(action,p)$$;

-- Preserve historic deliveries, but distinguish unattributed sandbox traffic
-- from failures on a rep's actual payment or onboarding journey.
update public.px_stripe_events set status='unattributed',error='CONNECT_UNATTRIBUTED',channel='connect'
where status='failed' and error in ('Connected account is not attributed to a rep.','Connected account not found.');
