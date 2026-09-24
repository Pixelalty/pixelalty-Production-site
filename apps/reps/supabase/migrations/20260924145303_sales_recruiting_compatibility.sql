-- Older deployed clients still call packages.map(). Preserve the response
-- shape during rollout without returning any package or commission data.
create or replace function px_private.public_config() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'recruiting_open',(value->>'recruiting_open')::boolean,
  'title',value->>'recruiting_title','body',value->>'recruiting_body',
  'requirements',value->>'recruiting_requirements','packages','[]'::jsonb
 ) from public.px_settings
$$;
