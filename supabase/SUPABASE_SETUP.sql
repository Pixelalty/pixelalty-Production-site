-- Pixelalty: run ONCE in a NEW Supabase project's SQL Editor as project owner.
-- No secret is needed by the browser. Public submissions use narrowly scoped RPCs.
-- Existing installations: back up and use a reviewed migration; do not drop live tables.
begin;
create schema if not exists pixelalty_private;
revoke all on schema pixelalty_private from public, anon, authenticated;
grant usage on schema pixelalty_private to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin','viewer'))
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  display_name text not null check (char_length(display_name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254),
  business_name text not null default '' check (char_length(business_name) <= 150),
  service_type text not null check (service_type in ('launch','growth','premium','advanced','listing','other')),
  rating smallint not null check (rating between 1 and 5),
  title text not null default '' check (char_length(title) <= 120),
  body text not null check (char_length(body) between 20 and 3000),
  order_reference text not null default '' check (char_length(order_reference) <= 100),
  genuine_confirmation boolean not null check (genuine_confirmation),
  status text not null default 'pending' check (status in ('pending','approved','hidden')),
  is_verified_customer boolean not null default false,
  is_featured boolean not null default false,
  admin_response text not null default '' check (char_length(admin_response) <= 2000),
  moderation_reason text not null default '' check (char_length(moderation_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_featured or status = 'approved'),
  check (status <> 'hidden' or char_length(btrim(moderation_reason)) >= 8)
);
create table public.contact_inquiries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  name text not null check (char_length(name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254),
  business_name text not null default '' check (char_length(business_name) <= 150),
  service_interest text not null check (service_interest in ('launch','growth','premium','advanced','listing','other')),
  message text not null check (char_length(message) between 10 and 5000),
  scope_details jsonb not null default '{}'::jsonb check (jsonb_typeof(scope_details) = 'object'),
  status text not null default 'new' check (status in ('new','read','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reviews_status_date on public.reviews(status, created_at desc, id desc);
create index reviews_featured_date on public.reviews(created_at desc) where status='approved' and is_featured;
create index inquiries_status_date on public.contact_inquiries(status, created_at desc, id desc);
create table pixelalty_private.rate_limits (
  rate_key text primary key,
  day date not null,
  count integer not null default 0,
  last_at timestamptz not null
);
create index rate_limits_cleanup on pixelalty_private.rate_limits(last_at);
create table pixelalty_private.settings (id boolean primary key default true check(id), rate_salt text not null);
insert into pixelalty_private.settings(id,rate_salt) values (true, gen_random_uuid()::text);
revoke all on all tables in schema pixelalty_private from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.reviews enable row level security;
alter table public.contact_inquiries enable row level security;
alter table pixelalty_private.rate_limits enable row level security;
alter table pixelalty_private.settings enable row level security;
revoke all on public.profiles, public.reviews, public.contact_inquiries from public, anon, authenticated;

-- The role comes from a protected table, never user-editable auth metadata.
create function pixelalty_private.admin_role() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.role='admin');
$$;
create function pixelalty_private.admin_mfa() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()->>'aal') = 'aal2', false) and pixelalty_private.admin_role();
$$;
revoke all on function pixelalty_private.admin_role() from public, anon, authenticated;
revoke all on function pixelalty_private.admin_mfa() from public, anon, authenticated;
grant execute on function pixelalty_private.admin_role(), pixelalty_private.admin_mfa() to authenticated;
-- Allows first-login MFA enrollment; this reveals only the caller's own role check.
create function public.admin_identity() returns boolean
language sql stable security invoker set search_path = '' as $$ select pixelalty_private.admin_role(); $$;
revoke all on function public.admin_identity() from public, anon;
grant execute on function public.admin_identity() to authenticated;

create policy profile_self on public.profiles for select to authenticated using (user_id=(select auth.uid()));
grant select on public.profiles to authenticated;
create policy reviews_admin_read on public.reviews for select to authenticated using ((select pixelalty_private.admin_mfa()));
create policy reviews_admin_update on public.reviews for update to authenticated using ((select pixelalty_private.admin_mfa())) with check ((select pixelalty_private.admin_mfa()));
create policy reviews_admin_delete on public.reviews for delete to authenticated using ((select pixelalty_private.admin_mfa()));
create policy inquiries_admin_read on public.contact_inquiries for select to authenticated using ((select pixelalty_private.admin_mfa()));
create policy inquiries_admin_update on public.contact_inquiries for update to authenticated using ((select pixelalty_private.admin_mfa())) with check ((select pixelalty_private.admin_mfa()));
create policy inquiries_admin_delete on public.contact_inquiries for delete to authenticated using ((select pixelalty_private.admin_mfa()));
grant select, delete on public.reviews, public.contact_inquiries to authenticated;
grant update(status,is_verified_customer,is_featured,admin_response,moderation_reason) on public.reviews to authenticated;
grant update(status) on public.contact_inquiries to authenticated;
-- There are intentionally NO direct insert grants/policies for public or admins.

create function pixelalty_private.guard_review() returns trigger
language plpgsql set search_path = '' as $$
begin
  if row(new.id,new.request_id,new.display_name,new.email,new.business_name,new.service_type,new.rating,new.title,new.body,new.order_reference,new.genuine_confirmation,new.created_at)
     is distinct from row(old.id,old.request_id,old.display_name,old.email,old.business_name,old.service_type,old.rating,old.title,old.body,old.order_reference,old.genuine_confirmation,old.created_at) then
    raise exception 'Customer review content cannot be rewritten.' using errcode='42501';
  end if;
  new.updated_at=now();
  return new;
end; $$;
create trigger preserve_review_integrity before update on public.reviews for each row execute function pixelalty_private.guard_review();
create function pixelalty_private.touch_inquiry() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at=now(); return new; end; $$;
create trigger inquiry_timestamp before update on public.contact_inquiries for each row execute function pixelalty_private.touch_inquiry();
revoke all on function pixelalty_private.guard_review(), pixelalty_private.touch_inquiry() from public,anon,authenticated;

-- These SECURITY DEFINER functions expose explicit safe columns, never table rows.
create function public.get_public_reviews(p_category text default 'all',p_featured boolean default false,p_limit integer default 12,p_offset integer default 0)
returns table(id uuid,display_name text,business_name text,service_type text,rating smallint,title text,body text,created_at timestamptz,is_verified_customer boolean,admin_response text)
language sql stable security definer set search_path = '' as $$
 select r.id,r.display_name,r.business_name,r.service_type,r.rating,r.title,r.body,r.created_at,r.is_verified_customer,r.admin_response
 from public.reviews r where r.status='approved'
 and (not coalesce(p_featured,false) or r.is_featured)
 and (p_category='all' or (p_category='web' and r.service_type in ('launch','growth','premium','advanced')) or (p_category='listing' and r.service_type='listing'))
 order by r.created_at desc,r.id desc
 limit least(greatest(coalesce(p_limit,12),1),24)
 offset least(greatest(coalesce(p_offset,0),0),100000);
$$;
create function public.public_review_count() returns bigint
language sql stable security definer set search_path = '' as $$ select count(*) from public.reviews where status='approved'; $$;
revoke all on function public.get_public_reviews(text,boolean,integer,integer), public.public_review_count() from public,anon,authenticated;
grant execute on function public.get_public_reviews(text,boolean,integer,integer), public.public_review_count() to anon,authenticated;

-- Basic abuse prevention without an additional Edge Function deployment.
-- Per normalized email: 60-second cooldown and daily quota; not a CAPTCHA or IP firewall.
create function pixelalty_private.check_rate(kind text, submitted_email text, daily_max integer) returns void
language plpgsql security definer set search_path = '' as $$
declare k text; r pixelalty_private.rate_limits; salt text;
begin
 select rate_salt into salt from pixelalty_private.settings where id=true;
 k=md5(salt || ':' || kind || ':' || lower(btrim(submitted_email)));
 perform pg_advisory_xact_lock(hashtextextended(k,0));
 select * into r from pixelalty_private.rate_limits where rate_key=k;
 if found then
  if r.last_at > now()-interval '60 seconds' or (r.day=current_date and r.count>=daily_max) then
   raise exception 'RATE_LIMIT' using errcode='P0001';
  end if;
  update pixelalty_private.rate_limits set count=case when day=current_date then count+1 else 1 end,day=current_date,last_at=now() where rate_key=k;
 else
  insert into pixelalty_private.rate_limits values(k,current_date,1,now());
 end if;
 delete from pixelalty_private.rate_limits where last_at < now()-interval '7 days';
end; $$;
revoke all on function pixelalty_private.check_rate(text,text,integer) from public,anon,authenticated;

create function public.submit_review(payload jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare dn text; em text; bn text; svc text; rt text; ttl text; txt text; ref text; rid uuid; started timestamptz;
begin
 if payload is null or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>22000 then raise exception 'INVALID_SUBMISSION'; end if;
 dn=btrim(coalesce(payload->>'display_name','')); em=lower(btrim(coalesce(payload->>'email','')));
 bn=btrim(coalesce(payload->>'business_name','')); svc=coalesce(payload->>'service_type',''); rt=coalesce(payload->>'rating','');
 ttl=btrim(coalesce(payload->>'title','')); txt=btrim(coalesce(payload->>'body','')); ref=btrim(coalesce(payload->>'order_reference',''));
 begin rid=(payload->>'request_id')::uuid; started=(payload->>'started_at')::timestamptz; exception when others then raise exception 'INVALID_SUBMISSION'; end;
 if rid is null or started is null or started>now()-interval '3 seconds' or started<now()-interval '2 days'
 or coalesce(payload->>'website','')<>'' or coalesce(payload->>'consent','')<>'true'
 or char_length(dn) not between 1 and 100 or char_length(em)>254 or em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or char_length(bn)>150 or svc not in ('launch','growth','premium','advanced','listing','other') or rt !~ '^[1-5]$'
 or char_length(ttl)>120 or char_length(txt) not between 20 and 3000 or char_length(ref)>100 then raise exception 'INVALID_SUBMISSION'; end if;
 perform pg_advisory_xact_lock(hashtextextended('review:'||rid::text,0));
 if exists(select 1 from public.reviews r where r.request_id=rid and r.email=em) then return true; end if;
 perform pixelalty_private.check_rate('review',em,5);
 insert into public.reviews(request_id,display_name,email,business_name,service_type,rating,title,body,order_reference,genuine_confirmation,status,is_verified_customer,is_featured)
 values(rid,dn,em,bn,svc,rt::smallint,ttl,txt,ref,true,'pending',false,false);
 return true;
end; $$;
revoke all on function public.submit_review(jsonb) from public,anon,authenticated;
grant execute on function public.submit_review(jsonb) to anon,authenticated;

create function public.submit_contact(payload jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare nm text; em text; bn text; svc text; msg text; raw_scope jsonb; details jsonb; rid uuid; started timestamptz; pages text; products text; booking text; integrations text; functionality text;
begin
 if payload is null or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>40000 then raise exception 'INVALID_SUBMISSION'; end if;
 nm=btrim(coalesce(payload->>'name','')); em=lower(btrim(coalesce(payload->>'email',''))); bn=btrim(coalesce(payload->>'business_name',''));
 svc=coalesce(payload->>'service_interest',''); msg=btrim(coalesce(payload->>'message','')); raw_scope=coalesce(payload->'scope_details','{}'::jsonb);
 begin rid=(payload->>'request_id')::uuid; started=(payload->>'started_at')::timestamptz; exception when others then raise exception 'INVALID_SUBMISSION'; end;
 if rid is null or started is null or started>now()-interval '3 seconds' or started<now()-interval '2 days' or coalesce(payload->>'website','')<>''
 or char_length(nm) not between 1 and 100 or char_length(em)>254 or em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or char_length(bn)>150 or svc not in ('launch','growth','premium','advanced','listing','other') or char_length(msg) not between 10 and 5000
 or jsonb_typeof(raw_scope) is distinct from 'object' then raise exception 'INVALID_SUBMISSION'; end if;
 details='{}'::jsonb;
 if svc='advanced' then
  pages=coalesce(raw_scope->>'page_count',''); products=coalesce(raw_scope->>'product_count',''); booking=btrim(coalesce(raw_scope->>'booking',''));
  integrations=btrim(coalesce(raw_scope->>'integrations','')); functionality=btrim(coalesce(raw_scope->>'functionality',''));
  if pages !~ '^[0-9]{0,6}$' or products !~ '^[0-9]{0,6}$' or char_length(booking)>500 or char_length(integrations)>500 or char_length(functionality)>1000 then raise exception 'INVALID_SUBMISSION'; end if;
  if (pages<>'' and pages::integer>100000) or (products<>'' and products::integer>100000) then raise exception 'INVALID_SUBMISSION'; end if;
  details=jsonb_build_object('page_count',pages,'product_count',products,'booking',booking,'integrations',integrations,'functionality',functionality);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('contact:'||rid::text,0));
 if exists(select 1 from public.contact_inquiries c where c.request_id=rid and c.email=em) then return true; end if;
 perform pixelalty_private.check_rate('contact',em,10);
 insert into public.contact_inquiries(request_id,name,email,business_name,service_interest,message,scope_details,status)
 values(rid,nm,em,bn,svc,msg,details,'new');
 return true;
end; $$;
revoke all on function public.submit_contact(jsonb) from public,anon,authenticated;
grant execute on function public.submit_contact(jsonb) to anon,authenticated;
commit;

-- AFTER you manually create your administrator in Authentication > Users,
-- replace the UUID in this separate example and run it yourself:
-- insert into public.profiles(user_id,role) values ('YOUR-AUTH-USER-UUID','admin');
-- Do not add any public signup, profiles insert, or profiles update policies.
