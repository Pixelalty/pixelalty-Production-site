-- Workspace-visible cosmetics are separate from editable Auth metadata.
-- No existing migration or financial history is rewritten.
create table public.px_profile_styles (
 rep_id uuid primary key references px_private.identities(id),
 avatar text not null default 'initial', frame text not null default 'simple', banner text not null default 'wash', accent text not null default 'blue',
 avatar_asset uuid, banner_asset uuid,
 avatar_x int not null default 50 check(avatar_x between 0 and 100), avatar_y int not null default 50 check(avatar_y between 0 and 100),
 banner_x int not null default 50 check(banner_x between 0 and 100), banner_y int not null default 50 check(banner_y between 0 and 100),
 banner_fit text not null default 'cover' check(banner_fit in ('cover','contain')),
 earned_xp bigint not null default 0 check(earned_xp>=0), updated_at timestamptz not null default now()
);
alter table public.px_profile_styles enable row level security;
revoke all on public.px_profile_styles from public,anon,authenticated;
grant select on public.px_profile_styles to authenticated;
create policy profile_visible on public.px_profile_styles for select to authenticated using(
 (select px_private.account_allowed()) and exists(select 1 from public.px_reps r where r.id=rep_id and r.deleted_at is null)
 and (rep_id=(select auth.uid()) or px_private.has_role(array['sales_admin','manager','support']) or exists(select 1 from public.px_reps me where me.id=(select auth.uid()) and me.status in ('active','onboarding') and me.deleted_at is null))
);
create table px_private.profile_assets (
 id uuid primary key, rep_id uuid not null references px_private.identities(id), kind text not null check(kind in ('avatar','banner')),
 object_key text not null unique, static_key text not null unique, mime text not null,
 width int not null, height int not null, bytes int not null check(bytes between 1 and 5242880), animated boolean not null,
 status text not null default 'reserved' check(status in ('reserved','ready','removing')), created_at timestamptz not null default now()
);
alter table px_private.profile_assets enable row level security;
revoke all on px_private.profile_assets from public,anon,authenticated;
create index profile_assets_owner on px_private.profile_assets(rep_id,created_at);
alter table public.px_profile_styles add foreign key(avatar_asset) references px_private.profile_assets(id);
alter table public.px_profile_styles add foreign key(banner_asset) references px_private.profile_assets(id);
create index profile_avatar_asset on public.px_profile_styles(avatar_asset) where avatar_asset is not null;
create index profile_banner_asset on public.px_profile_styles(banner_asset) where banner_asset is not null;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('pixelalty-profile-media','pixelalty-profile-media',false,5242880,array['image/png','image/jpeg','image/webp','image/gif']);
create policy profile_media_private on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'pixelalty-profile-media') with check(bucket_id<>'pixelalty-profile-media');

-- Peak earned XP preserves legitimate unlocks after a correction. Only ledger
-- events update this value; callers cannot submit their own XP or unlock state.
insert into public.px_profile_styles(rep_id,avatar,frame,banner,earned_xp)
 select r.id,
 case when to_jsonb(u)->'raw_user_meta_data'->'pixelalty_workspace'->>'avatar' in ('initial','monogram','outline') then to_jsonb(u)->'raw_user_meta_data'->'pixelalty_workspace'->>'avatar' else 'initial' end,
 case when to_jsonb(u)->'raw_user_meta_data'->'pixelalty_workspace'->>'frame' in ('simple','line','double') then to_jsonb(u)->'raw_user_meta_data'->'pixelalty_workspace'->>'frame' else 'simple' end,
 case when to_jsonb(u)->'raw_user_meta_data'->'pixelalty_workspace'->>'banner' in ('plain','wash','grid') then to_jsonb(u)->'raw_user_meta_data'->'pixelalty_workspace'->>'banner' else 'wash' end,
 greatest(0,coalesce((select max(balance) from (select sum(amount) over(order by created_at,id) balance from public.px_xp where rep_id=r.id)x),0))
 from public.px_reps r join auth.users u on u.id=r.id where r.deleted_at is null;
create function px_private.profile_xp_peak() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.px_reps where id=new.rep_id and deleted_at is null) then return new;end if;
 insert into public.px_profile_styles(rep_id,earned_xp) values(new.rep_id,greatest(0,(select coalesce(sum(amount),0) from public.px_xp where rep_id=new.rep_id)))
 on conflict(rep_id) do update set earned_xp=greatest(px_profile_styles.earned_xp,excluded.earned_xp);
 return new;
end$$;

-- Optional rep MFA protects direct API/RLS access too. The context endpoint
-- remains available to display the challenge, without granting mutation access.
create function px_private.mfa_satisfied() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'aal','')='aal2' or not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified');
$$;
revoke all on function px_private.mfa_satisfied() from public,anon;
grant execute on function px_private.mfa_satisfied() to authenticated;
do $$declare t record;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename like 'px\_%' escape '\' loop
  execute format('create policy pixelalty_enrolled_mfa on public.%I as restrictive for all to authenticated using ((select px_private.mfa_satisfied())) with check ((select px_private.mfa_satisfied()))',t.tablename);
 end loop;
end$$;
create function px_private.require_enrolled_mfa() returns void language plpgsql security definer set search_path='' as $$begin
 if not px_private.mfa_satisfied() then raise exception 'Verify your authenticator before continuing.' using errcode='42501';end if;
end$$;
revoke all on function px_private.require_enrolled_mfa() from public,anon,authenticated;
create trigger profile_xp_peak after insert on public.px_xp for each row execute function px_private.profile_xp_peak();

create function px_private.cosmetic_xp(kind text,preset text) returns int language plpgsql immutable set search_path='' as $$begin
 if (kind='avatar' and preset in ('initial','monogram','outline','solid','gradient','pixel','minimal_badge')) or (kind='frame' and preset in ('simple','line','double','soft','squared','minimal_ring')) or (kind='banner' and preset in ('plain','wash','grid','gradient','dots','lines','soft_mesh')) then return 0;end if;
 if (kind='avatar' and preset in ('dual_tone','halo','glass','carbon','prism')) or (kind='frame' and preset in ('accent_ring','split_ring','corners','technical','pixel_edge','layered')) or (kind='banner' and preset in ('blueprint','pixel_field','contours','waves','geometric','horizon')) then return 1000;end if;
 if (kind='avatar' and preset in ('animated_halo','orbit','pulse','moving_gradient','energy_ring')) or (kind='frame' and preset in ('pulse','orbit','neon','moving_dashes','energy')) or (kind='banner' and preset in ('animated_gradient','flowing_mesh','moving_grid','scanning_line','orbiting_shapes')) then return 10000;end if;
 if (kind='avatar' and preset in ('aurora','holographic','geometry','constellation')) or (kind='frame' and preset in ('holographic','aurora','comet','geometry','dynamic_wave')) or (kind='banner' and preset in ('aurora','holographic','constellation','comet_trails','pixelalty_motif')) then return 50000;end if;
 raise exception 'Choose an available profile style.';
end$$;

create function px_private.profile_summary(rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('style',coalesce((select to_jsonb(s)-'earned_xp'-'rep_id' from public.px_profile_styles s where rep_id=rid),'{}'),'earned_xp',coalesce((select earned_xp from public.px_profile_styles where rep_id=rid),0),'lifetime_xp',(select coalesce(sum(amount),0) from public.px_xp where rep_id=rid));
$$;
create function px_private.profile(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();rid uuid; s public.px_profile_styles; a px_private.profile_assets;v jsonb;key text;asset uuid;req int;out jsonb;
begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();
 rid:=coalesce(nullif(p->>'rep_id','')::uuid,uid);
 if action in ('summary','asset') then
  if action='asset' then select * into a from px_private.profile_assets where id=(p->>'id')::uuid and status='ready';rid:=a.rep_id;end if;
  if rid is null or not exists(select 1 from public.px_reps where id=rid and deleted_at is null) then raise exception 'Profile not found.';end if;
  if rid<>uid and not (px_private.has_role(array['sales_admin','manager','support']) or exists(select 1 from public.px_reps where id=uid and deleted_at is null and status in ('active','onboarding'))) then raise exception 'Profile access required.' using errcode='42501';end if;
  if action='asset' then
   if rid<>uid and not px_private.has_role(array['sales_admin','support']) and not exists(select 1 from public.px_profile_styles where rep_id=rid and a.id in (avatar_asset,banner_asset)) then raise exception 'This image is private.' using errcode='42501';end if;
   return to_jsonb(a);
  end if;
  out:=px_private.profile_summary(rid);
  if rid=uid then out:=out||jsonb_build_object('assets',(select coalesce(jsonb_agg(to_jsonb(t)-'object_key'-'static_key'),'[]') from px_private.profile_assets t where rep_id=uid and status='ready'));end if;
  return out;
 end if;
 if action='moderate' then
  perform px_private.require_role(array['sales_admin','support']);
  if length(trim(coalesce(p->>'reason','')))<5 then raise exception 'Explain why this profile needs moderation.';end if;
  update public.px_profile_styles set avatar_asset=null,banner_asset=null,avatar='initial',frame='simple',banner='wash',updated_at=now() where rep_id=rid;
  update px_private.profile_assets set status='removing' where rep_id=rid;
  perform px_private.audit('profile_moderated',rid::text,p->>'reason');return '{}';
 end if;
 if rid<>uid or not exists(select 1 from public.px_reps where id=uid and deleted_at is null and status in ('active','onboarding')) then raise exception 'You can update only your own available profile.' using errcode='42501';end if;
 insert into public.px_profile_styles(rep_id) values(uid) on conflict do nothing;
 select * into s from public.px_profile_styles where rep_id=uid for update;
 if action='save' then
  v:=p->'style';if jsonb_typeof(v)<>'object' or length(v::text)>2000 then raise exception 'Choose supported profile settings.';end if;
  foreach key in array array['avatar','frame','banner'] loop
   req:=px_private.cosmetic_xp(key,v->>key);if req>s.earned_xp then raise exception 'This style is locked. Earn the required career XP first.';end if;
   asset:=nullif(v->>(key||'_asset'),'')::uuid;
   if key<>'frame' and asset is not null and not exists(select 1 from px_private.profile_assets where id=asset and rep_id=uid and kind=key and status='ready') then raise exception 'Choose one of your uploaded images.';end if;
  end loop;
  if v->>'accent' not in ('blue','emerald','violet','rose','amber','slate') then raise exception 'Choose a profile accent.';end if;
  update public.px_profile_styles set avatar=v->>'avatar',frame=v->>'frame',banner=v->>'banner',accent=v->>'accent',avatar_asset=nullif(v->>'avatar_asset','')::uuid,banner_asset=nullif(v->>'banner_asset','')::uuid,avatar_x=(v->>'avatar_x')::int,avatar_y=(v->>'avatar_y')::int,banner_x=(v->>'banner_x')::int,banner_y=(v->>'banner_y')::int,banner_fit=v->>'banner_fit',updated_at=now() where rep_id=uid;
  return px_private.profile_summary(uid);
 elsif action='reserve' then
  if p->>'kind' not in ('avatar','banner') or p->>'mime' not in ('image/png','image/jpeg','image/webp','image/gif') then raise exception 'Choose a supported image.';end if;
  req:=case when (p->>'animated')::boolean then case when p->>'kind'='banner' then 50000 else 10000 end else 1000 end;
  if s.earned_xp<req then raise exception 'This upload is locked. Earn the required career XP first.';end if;
  if (select count(*) from px_private.profile_assets where rep_id=uid and (status='ready' or created_at>now()-interval '1 day'))>=20 then raise exception 'Remove an older image, or wait until tomorrow before uploading more.';end if;
  asset:=gen_random_uuid();key:=uid::text||'/'||asset::text;
  insert into px_private.profile_assets(id,rep_id,kind,object_key,static_key,mime,width,height,bytes,animated) values(asset,uid,p->>'kind',key||'/original',key||'/still.png',p->>'mime',(p->>'width')::int,(p->>'height')::int,(p->>'bytes')::int,(p->>'animated')::boolean) returning * into a;
  return to_jsonb(a);
 elsif action='remove' then
  asset:=(p->>'id')::uuid;
  update public.px_profile_styles set avatar_asset=case when avatar_asset=asset then null else avatar_asset end,banner_asset=case when banner_asset=asset then null else banner_asset end where rep_id=uid;
  update px_private.profile_assets set status='removing' where id=asset and rep_id=uid;
  return '{}';
 end if;
 raise exception 'Profile action not available.';
end$$;
create function public.px_profile(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.profile(action,p)$$;
revoke all on function public.px_profile(text,jsonb),px_private.profile(text,jsonb) from public,anon;
grant execute on function public.px_profile(text,jsonb),px_private.profile(text,jsonb) to authenticated;

create function px_private.profile_service(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a px_private.profile_assets;out jsonb;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501';end if;
 if action='expire' then
   update px_private.profile_assets set status='removing' where id in (
    select id from px_private.profile_assets where status='reserved' and created_at<now()-interval '24 hours' order by created_at limit 20 for update skip locked
   );
   select coalesce(jsonb_agg(rep_id),'[]') into out from (select distinct rep_id from px_private.profile_assets where status='removing' order by rep_id limit 20) pending;
   return out;
 elsif action='complete' then
  select * into a from px_private.profile_assets where id=(p->>'id')::uuid and status='reserved' for update;
  if a.id is null or not exists(select 1 from storage.objects where bucket_id='pixelalty-profile-media' and name=a.object_key) or not exists(select 1 from storage.objects where bucket_id='pixelalty-profile-media' and name=a.static_key) then raise exception 'The image upload is incomplete.';end if;
  update px_private.profile_assets set status='ready' where id=a.id;
  return jsonb_build_object('id',a.id,'kind',a.kind);
 elsif action='cleanup' then
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'object_key',object_key,'static_key',static_key)),'[]') from px_private.profile_assets where rep_id=(p->>'rep_id')::uuid and status='removing');
 elsif action='removed' then
  delete from px_private.profile_assets where id=(p->>'id')::uuid and status='removing';return '{}';
 end if;raise exception 'Unknown media operation.';
end$$;
create function public.px_profile_service(action text,p jsonb) returns jsonb language sql security invoker set search_path='' as $$select px_private.profile_service(action,p)$$;
revoke all on function public.px_profile_service(text,jsonb),px_private.profile_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.px_profile_service(text,jsonb),px_private.profile_service(text,jsonb) to service_role;
revoke all on function px_private.profile_xp_peak(),px_private.profile_summary(uuid),px_private.cosmetic_xp(text,text) from public,anon,authenticated;

alter function px_private.context() rename to context_before_profile;
revoke all on function px_private.context_before_profile() from public,anon,authenticated;
create function px_private.context() returns jsonb language plpgsql security definer set search_path='' as $$declare roles jsonb;begin
 perform px_private.require_access();
 select coalesce(jsonb_agg(role),'[]') into roles from public.px_roles where user_id=auth.uid();
 if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' and (jsonb_array_length(roles)>0 or not px_private.mfa_satisfied()) then
  return jsonb_build_object('user_id',auth.uid(),'rep',null,'roles',roles,'aal','aal1','mfa_required',true);
 end if;
 return px_private.context_before_profile()||jsonb_build_object('profile',px_private.profile_summary(auth.uid()));
end$$;
grant execute on function px_private.context() to authenticated;

-- Clean removable profile media for both retention and purge deletion modes.
-- An archived identity keeps financial/audit references, never public cosmetics.
create function px_private.profile_before_delete() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.deleted_at is not null and old.deleted_at is null then
  delete from public.px_profile_styles where rep_id=new.user_id;
  update px_private.profile_assets set status='removing' where rep_id=new.user_id;
 end if;return new;
end$$;
create trigger profile_before_delete after insert or update on px_private.account_access for each row execute function px_private.profile_before_delete();
revoke all on function px_private.profile_before_delete() from public,anon,authenticated;

-- Logging is a self-reported disposition, not proof of a phone conversation.
-- Keep immutable records, one qualification per lead/day, plus a realistic
-- cross-lead cooldown for XP. Calls still save when too close together.
create or replace function px_private.prepare_call() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.px_reps where id=new.rep_id for update;
 new.qualifying:=not exists(select 1 from public.px_calls where rep_id=new.rep_id and business_id=new.business_id and created_at>now()-interval '24 hours') and not exists(select 1 from public.px_calls where rep_id=new.rep_id and qualifying and created_at>now()-interval '30 seconds');
 select id into new.session_id from public.px_focus_sessions where rep_id=new.rep_id and ended_at is null and paused_at is null;
 return new;
end$$;

alter function px_private.action(text,jsonb) rename to action_before_enrolled_mfa;
revoke all on function px_private.action_before_enrolled_mfa(text,jsonb) from public,anon,authenticated;
create function px_private.action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();return px_private.action_before_enrolled_mfa(action,p);
end$$;
grant execute on function px_private.action(text,jsonb) to authenticated;
alter function px_private.report(text,jsonb) rename to report_before_enrolled_mfa;
revoke all on function px_private.report_before_enrolled_mfa(text,jsonb) from public,anon,authenticated;
create function px_private.report(kind text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();return px_private.report_before_enrolled_mfa(kind,p);
end$$;
grant execute on function px_private.report(text,jsonb) to authenticated;
alter function px_private.tax(text,jsonb) rename to tax_before_enrolled_mfa;
revoke all on function px_private.tax_before_enrolled_mfa(text,jsonb) from public,anon,authenticated;
create function px_private.tax(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();return px_private.tax_before_enrolled_mfa(action,p);
end$$;
grant execute on function px_private.tax(text,jsonb) to authenticated;

-- Explicit grants only; do not inherit PostgreSQL's default PUBLIC execute.
revoke all on function px_private.context(),px_private.action(text,jsonb),px_private.report(text,jsonb),px_private.tax(text,jsonb) from public,anon;
-- Serialize awards before their insert statement so the peak trigger sees all
-- committed earlier events even when independent awards arrive simultaneously.
create function px_private.serialize_profile_xp() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.px_reps where id=new.rep_id for update;return new;
end$$;
create trigger serialize_profile_xp before insert on public.px_xp for each row execute function px_private.serialize_profile_xp();
revoke all on function px_private.serialize_profile_xp() from public,anon,authenticated;

-- Requirement labels describe the task; completion is a separate verified field.
alter function px_private.onboarding(uuid) rename to onboarding_before_profile;
revoke all on function px_private.onboarding_before_profile(uuid) from public,anon,authenticated;
create function px_private.onboarding(rid uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare out jsonb;begin
 out:=px_private.onboarding_before_profile(rid);
 return jsonb_set(out,'{steps}',(select jsonb_agg(case when s->>'key'='tax' then s||jsonb_build_object('title','Tax documentation') when s->>'key'='payout' then s||jsonb_build_object('title','Payout setup') else s end order by ord) from jsonb_array_elements(out->'steps') with ordinality a(s,ord)));
end$$;
revoke all on function px_private.onboarding(uuid) from public,anon,authenticated;
