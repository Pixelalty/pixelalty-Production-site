-- Pixelalty Appearance v1: SAFE UPGRADE for an existing installation.
-- Run this file alone in Supabase SQL Editor as project owner. Safe to rerun.
-- No existing reviews, inquiries, profiles, Auth users, policies, or MFA factors are changed.
-- No design is published by this migration. The website has a built-in Premium Hybrid fallback.
begin;

do $$ begin
  if to_regprocedure('pixelalty_private.admin_mfa()') is null or to_regclass('public.profiles') is null then
    raise exception 'Pixelalty base schema is missing. Stop: this migration requires the existing secured installation.';
  end if;
end $$;

create or replace function pixelalty_private.appearance_luminance(p_color text) returns double precision
language plpgsql immutable strict set search_path = '' as $$
declare bytes bytea; channel double precision; result double precision := 0; i integer;
begin
  if p_color !~ '^#[0-9A-Fa-f]{6}$' then return null; end if;
  bytes := decode(substr(p_color,2),'hex');
  for i in 0..2 loop
    channel := get_byte(bytes,i)::double precision / 255.0;
    channel := case when channel <= 0.04045 then channel/12.92 else power((channel+0.055)/1.055,2.4) end;
    result := result + channel * (case i when 0 then 0.2126 when 1 then 0.7152 else 0.0722 end);
  end loop;
  return result;
end $$;

create or replace function pixelalty_private.appearance_contrast(a text,b text) returns double precision
language sql immutable strict set search_path = '' as $$
  select (greatest(pixelalty_private.appearance_luminance(a),pixelalty_private.appearance_luminance(b))+0.05) /
         (least(pixelalty_private.appearance_luminance(a),pixelalty_private.appearance_luminance(b))+0.05);
$$;

create or replace function pixelalty_private.appearance_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  colors constant text[] := array['pageBg','sectionBg','surface','textPrimary','textMuted','accent','border'];
  allowed constant jsonb := '{"preset":["premium-hybrid","light","dark","custom"],"header":["light","dark","hero"],"footer":["light","dark"],"cardStyle":["flat","outlined","elevated"],"borderStrength":["soft","medium","strong"],"shadow":["none","subtle","medium"],"radius":["minimal","medium","rounded"],"buttonStyle":["solid","outline","soft"],"heroTreatment":["clean","glow","grid"],"spacing":["compact","normal","spacious"],"animation":["off","subtle","full"],"logo":["auto","original","reversed"],"font":["manrope","system","humanist","editorial"]}';
  key text; bg text; ink text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text)>4096 then return false; end if;
  if (select count(*) from jsonb_object_keys(p)) <> 21 or p->'schemaVersion' is distinct from '1'::jsonb then return false; end if;
  foreach key in array colors loop
    if jsonb_typeof(p->key) is distinct from 'string' or (p->>key) !~ '^#[0-9A-Fa-f]{6}$' then return false; end if;
  end loop;
  for key in select jsonb_object_keys(allowed) loop
    if jsonb_typeof(p->key) is distinct from 'string' or not ((allowed->key) ? (p->>key)) then return false; end if;
  end loop;
  -- Both normal-size text colors must pass WCAG AA on every configurable content surface.
  foreach bg in array array['pageBg','sectionBg','surface'] loop
    foreach ink in array array['textPrimary','textMuted'] loop
      if pixelalty_private.appearance_contrast(p->>ink,p->>bg)<4.5 then return false; end if;
    end loop;
    if pixelalty_private.appearance_contrast(p->>'accent',p->>bg)<3 then return false; end if;
  end loop;
  return true;
end $$;

create table if not exists public.site_settings (
  id boolean primary key default true check (id),
  published jsonb check (published is null or pixelalty_private.appearance_valid(published)),
  draft jsonb check (draft is null or pixelalty_private.appearance_valid(draft)),
  revision bigint not null default 0 check (revision >= 0),
  published_version bigint not null default 0 check (published_version >= 0),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null
);
create table if not exists public.site_settings_history (
  version bigint primary key check (version > 0),
  configuration jsonb not null check (pixelalty_private.appearance_valid(configuration)),
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null
);
insert into public.site_settings(id) values(true) on conflict (id) do nothing;
alter table public.site_settings enable row level security;
alter table public.site_settings_history enable row level security;
revoke all on public.site_settings,public.site_settings_history from public,anon,authenticated;
grant select on public.site_settings,public.site_settings_history to authenticated;

-- RLS protects private drafts/history. No direct INSERT/UPDATE/DELETE privilege is granted.
-- Mutations go through the checked, atomic RPCs below, so history cannot be bypassed.
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='site_settings' and policyname='appearance_admin_read') then
    create policy appearance_admin_read on public.site_settings for select to authenticated using ((select pixelalty_private.admin_mfa()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='site_settings_history' and policyname='appearance_history_admin_read') then
    create policy appearance_history_admin_read on public.site_settings_history for select to authenticated using ((select pixelalty_private.admin_mfa()));
  end if;
end $$;

-- The ONLY anonymous read surface: one published configuration, version, and timestamp.
-- Never SELECT * here: the same base row also holds the private draft and actor identity.
create or replace function public.get_published_appearance() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when s.published is null then null else jsonb_build_object(
    'configuration',s.published,'publishedVersion',s.published_version,'publishedAt',s.published_at) end
  from public.site_settings s where s.id=true;
$$;

create or replace function public.get_appearance_editor() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not pixelalty_private.admin_mfa() then raise exception 'APPEARANCE_FORBIDDEN' using errcode='42501'; end if;
  select jsonb_build_object('published',s.published,'draft',s.draft,'revision',s.revision,
    'publishedVersion',s.published_version,'publishedAt',s.published_at,'updatedAt',s.updated_at,
    'history',coalesce((select jsonb_agg(jsonb_build_object('version',h.version,'publishedAt',h.published_at,'preset',h.configuration->>'preset') order by h.version desc)
      from (select version,published_at,configuration from public.site_settings_history order by version desc limit 20) h),'[]'::jsonb))
  into result from public.site_settings s where s.id=true;
  return result;
end $$;

create or replace function public.save_appearance_draft(p_configuration jsonb,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_revision bigint;
begin
  if not pixelalty_private.admin_mfa() then raise exception 'APPEARANCE_FORBIDDEN' using errcode='42501'; end if;
  if not pixelalty_private.appearance_valid(p_configuration) then raise exception 'APPEARANCE_INVALID'; end if;
  select revision into current_revision from public.site_settings where id=true for update;
  if current_revision is null or p_expected_revision is distinct from current_revision then raise exception 'APPEARANCE_CONFLICT'; end if;
  update public.site_settings set draft=p_configuration,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=true;
  return public.get_appearance_editor();
end $$;

create or replace function public.publish_appearance(p_configuration jsonb,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_revision bigint; next_version bigint;
begin
  if not pixelalty_private.admin_mfa() then raise exception 'APPEARANCE_FORBIDDEN' using errcode='42501'; end if;
  if not pixelalty_private.appearance_valid(p_configuration) then raise exception 'APPEARANCE_INVALID'; end if;
  select revision,published_version+1 into current_revision,next_version from public.site_settings where id=true for update;
  if current_revision is null or p_expected_revision is distinct from current_revision then raise exception 'APPEARANCE_CONFLICT'; end if;
  insert into public.site_settings_history(version,configuration,published_at,published_by) values(next_version,p_configuration,now(),auth.uid());
  update public.site_settings set published=p_configuration,draft=p_configuration,revision=revision+1,
    published_version=next_version,published_at=now(),updated_at=now(),updated_by=auth.uid() where id=true;
  return public.get_appearance_editor();
end $$;

create or replace function public.revert_appearance_draft(p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_revision bigint;
begin
  if not pixelalty_private.admin_mfa() then raise exception 'APPEARANCE_FORBIDDEN' using errcode='42501'; end if;
  select revision into current_revision from public.site_settings where id=true for update;
  if current_revision is null or p_expected_revision is distinct from current_revision then raise exception 'APPEARANCE_CONFLICT'; end if;
  update public.site_settings set draft=published,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=true;
  return public.get_appearance_editor();
end $$;

create or replace function public.restore_appearance_version(p_version bigint,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare previous jsonb;
begin
  if not pixelalty_private.admin_mfa() then raise exception 'APPEARANCE_FORBIDDEN' using errcode='42501'; end if;
  select configuration into previous from public.site_settings_history where version=p_version;
  if previous is null then raise exception 'APPEARANCE_VERSION_MISSING'; end if;
  -- Restore into the draft only; the editor still requires a separate Publish confirmation.
  return public.save_appearance_draft(previous,p_expected_revision);
end $$;

revoke all on function pixelalty_private.appearance_luminance(text),pixelalty_private.appearance_contrast(text,text),pixelalty_private.appearance_valid(jsonb) from public,anon,authenticated;
revoke all on function public.get_published_appearance(),public.get_appearance_editor(),public.save_appearance_draft(jsonb,bigint),public.publish_appearance(jsonb,bigint),public.revert_appearance_draft(bigint),public.restore_appearance_version(bigint,bigint) from public,anon,authenticated;
grant execute on function public.get_published_appearance() to anon,authenticated;
grant execute on function public.get_appearance_editor(),public.save_appearance_draft(jsonb,bigint),public.publish_appearance(jsonb,bigint),public.revert_appearance_draft(bigint),public.restore_appearance_version(bigint,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
