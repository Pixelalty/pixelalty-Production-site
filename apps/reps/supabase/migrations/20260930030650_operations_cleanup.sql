-- Operational cleanup: reuse the catalog, settings, identity history and media bucket.
alter table public.px_packages add column display_order int not null default 50 check(display_order between 1 and 1000);
alter table public.px_packages add column starts_at boolean not null default false;
alter table public.px_packages add column visible boolean not null default true;
update public.px_packages set display_order=case code when 'launch' then 10 when 'growth' then 20 when 'premium' then 30 when 'advanced' then 40 else 50 end,starts_at=(code='advanced');
alter table public.px_packages drop constraint px_packages_price_cents_check;
alter table public.px_packages add constraint px_packages_price_cents_check check(price_cents>=0);


-- Preserve the effective catalog window for delayed payment webhooks.
alter table public.px_packages add column retired_at timestamptz;
update public.px_packages p set retired_at=coalesce((select min(created_at) from public.px_packages newer where newer.code=p.code and newer.version>p.version),now()) where not active;
create function px_private.package_catalog_window() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='UPDATE' and old.active and not new.active then new.retired_at:=now();end if;
 if TG_OP='INSERT' then
  new.display_order:=case new.code when 'launch' then 10 when 'growth' then 20 when 'premium' then 30 when 'advanced' then 40 else new.display_order end;
  if not new.active then new.retired_at:=new.created_at;end if;
 end if;
 return new;
end$$;
create trigger package_catalog_window before insert or update on public.px_packages for each row execute function px_private.package_catalog_window();
revoke all on function px_private.package_catalog_window() from public,anon,authenticated;

alter table px_private.account_deletions add column former_name text;
alter table px_private.account_deletions add column former_email text;
alter table public.px_diagnostics add column action text;
alter table public.px_diagnostics add column error_type text;
alter table public.px_diagnostics add column safe_context jsonb not null default '{}';

update public.px_settings set value=value||jsonb_build_object('support_channels',jsonb_build_array(
 jsonb_build_object('id','whatsapp-direct','title','Message Pixelalty Support','description','For account questions, CRM issues, payout questions, or anything else you need help with.','type','link','url','https://wa.me/12392870299?s=p','email','','button_text','Message Pixelalty','qr_path','/support/whatsapp-direct.png','qr_alt','QR code that opens the direct Pixelalty Support WhatsApp chat','display_order',10,'active',true,'icon','message'),
 jsonb_build_object('id','whatsapp-updates','title','Pixelalty Updates','description','Follow the Pixelalty Updates WhatsApp channel for CRM changes, fixes, new features, and important rep announcements.','type','link','url','https://whatsapp.com/channel/0029Vb9T6Y2DJ6GvZaXRnb2F','email','','button_text','Follow Pixelalty Updates','qr_path','/support/whatsapp-updates.png','qr_alt','QR code that opens the official Pixelalty WhatsApp updates channel','display_order',20,'active',true,'icon','bell'),
 jsonb_build_object('id','instagram','title','Pixelalty Instagram','description','Visit Pixelalty on Instagram for brand updates and announcements.','type','link','url','https://www.instagram.com/pixelalty/','email','','button_text','Open Instagram','qr_path','','qr_alt','','display_order',30,'active',true,'icon','globe'),
 jsonb_build_object('id','support-email','title','Email Pixelalty Support','description','Send your question to the Pixelalty team.','type','email','url','','email','support@pixelalty.com','button_text','Email Support','qr_path','','qr_alt','','display_order',40,'active',true,'icon','mail')
)) where not (value ? 'support_channels');

-- Removed leads with protected evidence are hidden by a restrictive policy.
-- Ordinary leads are physically deleted; no prospect graveyard is created.
alter table public.px_businesses add column deleted_at timestamptz;
alter table public.px_businesses drop constraint px_businesses_phone_check;
alter table public.px_businesses add constraint px_businesses_phone_check check(phone~'^\+[0-9]{11,15}$' or (deleted_at is not null and phone=''));
drop index public.px_business_phone;
create unique index px_business_phone on public.px_businesses(phone) where deleted_at is null;
create policy business_not_deleted on public.px_businesses as restrictive for select to authenticated using(deleted_at is null);

-- Idempotency receipts contain identifiers and counts, never deleted lead PII.
create table px_private.lead_removal_requests(request_id uuid primary key,actor_id uuid not null references px_private.identities(id),ids uuid[] not null,result jsonb,created_at timestamptz not null default now());
alter table px_private.lead_removal_requests enable row level security;
revoke all on px_private.lead_removal_requests from public,anon,authenticated;
create index px_lead_removal_actor on px_private.lead_removal_requests(actor_id);

-- Narrow, transaction-scoped deletion exception. All financial/audit rows stay immutable.
create or replace function px_private.immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='DELETE' and TG_TABLE_SCHEMA='public' and TG_TABLE_NAME in ('px_training','px_xp','px_assignments') then
  if exists(select 1 from px_private.account_deletions where user_id=(to_jsonb(old)->>'rep_id')::uuid and mode='purge' and status='purging') then return old;end if;
 end if;
 if TG_OP='DELETE' and TG_TABLE_SCHEMA='public' and TG_TABLE_NAME in ('px_calls','px_notes','px_assignments') and px_private.has_role(array['sales_admin']) then
  if exists(select 1 from px_private.lead_removal_requests where actor_id=auth.uid() and result is null and (to_jsonb(old)->>'business_id')::uuid=any(ids)) then return old;end if;
 end if;
 raise exception 'This record is append-only.';
end$$;

alter function px_private.protected_history(uuid) rename to protected_history_before_operations;
create function px_private.protected_history(rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select px_private.protected_history_before_operations(rid) or exists(select 1 from public.px_call_recordings where rep_id=rid)
$$;
revoke all on function px_private.protected_history_before_operations(uuid),px_private.protected_history(uuid) from public,anon,authenticated;

alter function px_private.action(text,jsonb) rename to action_before_operations;
revoke all on function px_private.action_before_operations(text,jsonb) from public,anon,authenticated;
create function px_private.action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<op>>
declare uid uuid:=auth.uid(); rid uuid; b public.px_businesses; r public.px_reps; pkg public.px_packages; cfg jsonb; cards jsonb; card jsonb; prior jsonb; result jsonb; new_id uuid; key text; n int; deleted_n int:=0; protected_n int:=0; absent_n int:=0; ids uuid[]; request_key uuid; v_former_name text; v_former_email text;
begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();
 if action in ('claim_selected','package_settings','account_delete_begin','account_purge_begin') then rid:=nullif(p->>'id','')::uuid;end if;
 if action='claim_selected' then
  -- Rep row first serializes capacity checks for concurrent claims by one rep.
  select * into r from public.px_reps where id=uid for update;
  if r.id is null or r.status<>'active' or r.deleted_at is not null then raise exception 'An active rep account is required.' using errcode='42501';end if;
  select * into b from public.px_businesses where id=rid for update;
  if b.id is null or b.owner_id is not null or b.archived or b.deleted_at is not null or b.dnc or b.customer or b.bad_number or b.stage in ('lost','won','dnc') or exists(select 1 from public.px_dnc where phone=b.phone and active) then
   raise exception 'This lead was just claimed by another rep. Choose another available lead.';
  end if;
  select count(*) into n from public.px_businesses where owner_id=uid and not archived and not dnc and not customer and deleted_at is null and stage not in ('lost','won','dnc');
  if n>=r.capacity then raise exception 'You have reached your lead capacity. Finish or release a current lead first.';end if;
  select value into cfg from public.px_settings where id;
  update public.px_businesses set owner_id=uid,claimed_at=now(),expires_at=now()+make_interval(hours=>(cfg->>'first_attempt_hours')::int),first_attempt_at=null where id=rid;
  insert into public.px_assignments(business_id,rep_id,action,actor_id) values(rid,uid,'claim',uid);
  perform px_private.audit('claim_selected',rid::text,'Rep selected an available lead');
  return jsonb_build_object('claimed',1,'id',rid);
 elsif action='package_settings' then
  perform px_private.require_role(array['sales_admin','finance_admin']);
  perform 1 from public.px_settings where id for update;
  select * into pkg from public.px_packages where id=rid for update;
  if pkg.id is null or exists(select 1 from public.px_packages where code=pkg.code and version>pkg.version) then raise exception 'This package changed. Reload the current version and try again.';end if;
  if length(trim(coalesce(p->>'name',''))) not between 1 and 120 or (p->>'price_cents') is null or (p->>'commission_cents') is null or (p->>'price_cents')::bigint not between 0 and 100000000 or (p->>'commission_cents')::bigint not between 0 and (p->>'price_cents')::bigint or coalesce((p->>'display_order')::int,0) not between 1 and 1000 then raise exception 'Enter a name, valid price and commission, and display order.';end if;
  if coalesce((p->>'active')::boolean,true) and (p->>'price_cents')::int=0 then raise exception 'An active package needs a customer price greater than zero. Deactivate it to save a zero price.';end if;
  -- Stable tier slots are independent of the editable display names.
  n:=case pkg.code when 'launch' then 10 when 'growth' then 20 when 'premium' then 30 when 'advanced' then 40 else (p->>'display_order')::int end;
  if pkg.code in ('launch','growth','premium','advanced') and n<>(p->>'display_order')::int then raise exception 'The four core packages keep their Launch, Growth, Premium, Advanced order.';end if;
  update public.px_packages set active=false where id=rid;
  insert into public.px_packages(code,name,version,price_cents,commission_cents,sale_xp,description,display_order,starts_at,visible,active)
  values(pkg.code,trim(p->>'name'),pkg.version+1,(p->>'price_cents')::int,(p->>'commission_cents')::int,pkg.sale_xp,coalesce(p->>'description',pkg.description),n,coalesce((p->>'starts_at')::boolean,false),coalesce((p->>'visible')::boolean,true),coalesce((p->>'active')::boolean,true)) returning id into new_id;
  perform px_private.audit('package_settings',new_id::text,coalesce(p->>'reason','Prospective catalog update'),jsonb_build_object('before',to_jsonb(pkg),'after',(select to_jsonb(x) from public.px_packages x where id=new_id)));
  return jsonb_build_object('id',new_id);
 elsif action='support_media_retire' then
  perform px_private.require_role(array['support','sales_admin']);
  select value into cfg from public.px_settings where id for update;
  if coalesce(p->>'path','')!~'^support/[a-f0-9-]{36}\.(png|jpg|webp)$' then raise exception 'Invalid support image.';end if;
  if exists(select 1 from jsonb_array_elements(cfg->'support_channels') c where c->>'qr_path'=p->>'path') then return '{"removable":false}';end if;
  if not coalesce(cfg->'support_media_retired','[]') ? (p->>'path') then
   update public.px_settings set value=jsonb_set(value,'{support_media_retired}',coalesce(value->'support_media_retired','[]')||jsonb_build_array(p->>'path')) where id;
  end if;
  return '{"removable":true}';
 elsif action in ('support_card_save','support_card_delete') then
  perform px_private.require_role(array['support','sales_admin']);
  select value into cfg from public.px_settings where id for update;
  cards:=coalesce(cfg->'support_channels','[]');key:=coalesce(nullif(p->>'card_id',''),gen_random_uuid()::text);
  select value into prior from jsonb_array_elements(cards) where value->>'id'=key;
  if action='support_card_save' then
   if length(trim(coalesce(p->>'title',''))) not between 1 and 100 or length(coalesce(p->>'description',''))>1000 or length(trim(coalesce(p->>'button_text',''))) not between 1 and 80 or coalesce(p->>'type','') not in ('link','email') or coalesce(p->>'icon','') not in ('message','mail','bell','globe','help','users') then raise exception 'Complete the support card title, button, type and icon.';end if;
   if (p->>'type'='link' and (coalesce(p->>'url','')!~'^https://[^[:space:]<>"@]+$' or length(p->>'url')>2000)) or (p->>'type'='email' and (coalesce(p->>'email','')!~'^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(p->>'email')>254)) then raise exception 'Enter a secure HTTPS link or a valid support email.';end if;
   if coalesce((p->>'display_order')::int,0) not between 1 and 1000 then raise exception 'Display order must be between 1 and 1000.';end if;
   if coalesce(cfg->'support_media_retired','[]') ? (p->>'qr_path') then raise exception 'This image was replaced. Upload it again to reuse it.';end if;
   if coalesce(p->>'qr_path','')<>'' then
    if length(trim(coalesce(p->>'qr_alt',''))) not between 1 and 200 then raise exception 'Describe the QR code destination for accessibility.';end if;
    if p->>'qr_path' not in ('/support/whatsapp-direct.png','/support/whatsapp-updates.png') and not exists(select 1 from storage.objects where bucket_id='pixelalty-profile-media' and name=p->>'qr_path' and name~'^support/[0-9a-f-]{36}\.(png|jpg|webp)$') then raise exception 'Upload a valid QR image before saving.';end if;
   end if;
   card:=jsonb_build_object('id',key,'title',trim(p->>'title'),'description',trim(coalesce(p->>'description','')),'type',p->>'type','url',case when p->>'type'='link' then trim(p->>'url') else '' end,'email',case when p->>'type'='email' then lower(trim(p->>'email')) else '' end,'button_text',trim(p->>'button_text'),'qr_path',coalesce(p->>'qr_path',''),'qr_alt',trim(coalesce(p->>'qr_alt','')),'display_order',(p->>'display_order')::int,'active',coalesce((p->>'active')::boolean,true),'icon',p->>'icon');
  else
   if prior is null then return '{}';end if;
  end if;
  select coalesce(jsonb_agg(value order by (value->>'display_order')::int,value->>'id'),'[]') into cards from jsonb_array_elements((select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(cards) where value->>'id'<>key)||case when card is null then '[]'::jsonb else jsonb_build_array(card) end);
  if jsonb_array_length(cards)>30 then raise exception 'Keep at most 30 support options.';end if;
  update public.px_settings set value=jsonb_set(value,'{support_channels}',cards) where id;
  perform px_private.audit(action,key,coalesce(p->>'reason','Support hub update'),jsonb_build_object('before',prior,'after',card));
  return jsonb_build_object('id',key,'previous_qr',prior->>'qr_path');
 elsif action in ('leads_delete','leads_archive') then
  perform px_private.require_role(array['sales_admin']);
  if jsonb_typeof(p->'ids') is distinct from 'array' or jsonb_array_length(p->'ids') not between 1 and 500 then raise exception 'Select between 1 and 500 businesses.';end if;
  select array_agg(distinct value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p->'ids');
  if length(trim(coalesce(p->>'reason','')))<3 then raise exception 'Enter a reason for this change.';end if;
  if action='leads_delete' then
   if p->>'confirmation' is distinct from 'DELETE '||cardinality(ids)::text||' LEADS' then raise exception 'Type the exact permanent-deletion confirmation.';end if;
   request_key:=(p->>'request_id')::uuid;
   insert into px_private.lead_removal_requests(request_id,actor_id,ids) values(request_key,uid,ids) on conflict do nothing;
   select q.result into result from px_private.lead_removal_requests q where request_id=request_key and actor_id=uid and q.ids=op.ids for update;
   if not found then raise exception 'This deletion reference belongs to another selection.';end if;
   if result is not null then return result;end if;
  end if;
  -- A deterministic row order prevents competing bulk operations deadlocking.
  for b in select * from public.px_businesses where id=any(ids) and deleted_at is null order by id for update loop
   update public.px_followups set status='cancelled' where business_id=b.id and status='open';
   delete from public.px_favorites where business_id=b.id;
   if action='leads_archive' then
    update public.px_businesses set archived=true,owner_id=null,claimed_at=null,expires_at=null where id=b.id;
    deleted_n:=deleted_n+1;continue;
   end if;
   -- Remove retained spreadsheet copies in every batch, including duplicate reports.
   update public.px_import_rows set data='{}',error='Business permanently removed',status='rejected' where data->>'phone'=b.phone or (b.domain<>'' and data->>'domain'=b.domain);
   delete from public.px_followups where business_id=b.id;
   if b.customer or b.dnc or exists(select 1 from public.px_dnc where phone=b.phone and active) or exists(select 1 from public.px_deals where business_id=b.id) or exists(select 1 from public.px_call_recordings where business_id=b.id) then
    update public.px_businesses set name='Removed business',phone='',domain='',email='',contact='',city='',state='',industry='',notes='',metadata='{}',tags='{}',external_id='',source='',owner_id=null,claimed_at=null,expires_at=null,archived=true,deleted_at=now() where id=b.id;
    protected_n:=protected_n+1;
   else
    delete from public.px_quote_requests where business_id=b.id;
    delete from public.px_notes where business_id=b.id;
    delete from public.px_calls where business_id=b.id;
    delete from public.px_assignments where business_id=b.id;
    delete from public.px_businesses where id=b.id;
    deleted_n:=deleted_n+1;
   end if;
  end loop;
  absent_n:=cardinality(ids)-deleted_n-protected_n;
  result:=jsonb_build_object('deleted',case when action='leads_delete' then deleted_n else 0 end,'archived',case when action='leads_archive' then deleted_n else 0 end,'protected',protected_n,'already_removed',absent_n,'failed',0);
  if action='leads_delete' then update px_private.lead_removal_requests set result=op.result where request_id=request_key;end if;
  perform px_private.audit(action,request_key::text,p->>'reason',result||jsonb_build_object('ids',to_jsonb(ids)));
  return result;
 elsif action in ('account_delete_begin','account_purge_begin') then
  perform px_private.require_role(array['owner']);
  select target.name,pr.email into v_former_name,v_former_email from public.px_reps target left join public.px_rep_private pr on pr.rep_id=target.id where target.id=rid;
  result:=px_private.action_before_operations(action,p);
  update px_private.account_deletions set former_name=coalesce(account_deletions.former_name,v_former_name),former_email=coalesce(account_deletions.former_email,v_former_email) where user_id=rid;
  return result;
 end if;
 return px_private.action_before_operations(action,p);
end$$;
revoke all on function px_private.action(text,jsonb) from public,anon;
grant execute on function px_private.action(text,jsonb) to authenticated;
create or replace function public.px_action(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.action(action,p)$$;

create policy reps_finance_read on public.px_reps for select to authenticated using(px_private.has_role(array['finance_admin']));

alter function px_private.report(text,jsonb) rename to report_before_operations;
revoke all on function px_private.report_before_operations(text,jsonb) from public,anon,authenticated;
create function px_private.report(kind text,p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;uid uuid:=auth.uid();rid uuid:=nullif(p->>'id','')::uuid;pg int:=greatest(0,least(10000,coalesce((p->>'page')::int,0)));q text:=left(trim(coalesce(p->>'q','')),100);r public.px_reps;
begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();
 if kind='rep_summary' then
  perform px_private.require_role(array['sales_admin','finance_admin','support','manager']);
  select * into r from public.px_reps where code=p->>'code';
  if r.id is null or (not px_private.has_role(array['sales_admin','finance_admin','support']) and not px_private.team_scope(r.id)) then raise exception 'Rep not found.' using errcode='42501';end if;
  return jsonb_build_object('rep',jsonb_build_object('id',r.id,'name',r.name,'code',r.code,'status',case when r.deleted_at is not null then 'deleted' else r.status end,'email',(select email from public.px_rep_private where rep_id=r.id)));
 elsif kind='package_catalog' then
  perform px_private.require_role(array['sales_admin','finance_admin']);
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(x) order by display_order,code),'[]') from (select distinct on(code) * from public.px_packages order by code,version desc)x));
 elsif kind='support_hub' then
  if coalesce(p->>'admin','false')='true' then perform px_private.require_role(array['sales_admin','support']);end if;
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(c order by (c->>'display_order')::int,c->>'id'),'[]') from public.px_settings,jsonb_array_elements(value->'support_channels') c where id and ((c->>'active')::boolean or p->>'admin'='true')));
 elsif kind='available_leads' then
  select * into r from public.px_reps where id=uid and status='active' and deleted_at is null;
  if r.id is null then raise exception 'An active rep account is required.' using errcode='42501';end if;
  with candidates as (
   select b.id,b.code,b.name,b.industry,b.city,b.state,b.timezone,b.contact,b.phone,b.domain,b.metadata->>'website_assessment' opportunity,b.metadata->>'business_description' description,b.metadata->>'services' services,b.created_at
   from public.px_businesses b where b.owner_id is null and not b.archived and not b.customer and not b.dnc and not b.bad_number and b.deleted_at is null and b.stage not in ('lost','won','dnc') and not exists(select 1 from public.px_dnc where phone=b.phone and active)
    and (q='' or b.name ilike '%'||q||'%' or b.code ilike '%'||q||'%' or b.industry ilike '%'||q||'%' or b.city ilike '%'||q||'%')
  ) select jsonb_build_object('rows',(select coalesce(jsonb_agg(x),'[]') from (select * from candidates order by name,id limit 50 offset pg*50)x),'total',(select count(*) from candidates),'remaining',greatest(0,r.capacity-(select count(*) from public.px_businesses where owner_id=uid and not archived and not customer and not dnc and deleted_at is null and stage not in ('lost','won','dnc')))) into result;
  return result;
 elsif kind in ('deleted_accounts','deleted_account') then
  perform px_private.require_role(array['sales_admin']);
  if kind='deleted_accounts' then
   return jsonb_build_object('rows',(select coalesce(jsonb_agg(x),'[]') from (
    select d.user_id id,d.account_code code,coalesce(d.former_name,'Deleted account') name,d.former_email email,d.created_at deleted_at,d.completed_at,d.actor_id,coalesce(a.name,'Pixelalty administrator') deleted_by,d.status,d.mode
    from px_private.account_deletions d left join public.px_reps a on a.id=d.actor_id where q='' or d.account_code ilike '%'||q||'%' or d.former_name ilike '%'||q||'%' or d.former_email ilike '%'||q||'%' order by d.created_at desc,d.user_id limit 50 offset pg*50)x),
    'total',(select count(*) from px_private.account_deletions where q='' or account_code ilike '%'||q||'%' or former_name ilike '%'||q||'%' or former_email ilike '%'||q||'%'));
  end if;
  if not exists(select 1 from px_private.account_deletions where user_id=rid) then raise exception 'Deleted account record not found.';end if;
  return jsonb_build_object('account',(select to_jsonb(d) from px_private.account_deletions d where user_id=rid),
   'sales',(select coalesce(jsonb_agg(x),'[]') from (select id,package_name,amount_cents,commission_cents,paid_at from public.px_verified_sales where rep_id=rid order by paid_at desc limit 100)x),
   'commissions',(select coalesce(jsonb_agg(x),'[]') from (select id,amount_cents,status,created_at from public.px_commissions where rep_id=rid order by created_at desc limit 100)x),
   'payouts',(select coalesce(jsonb_agg(x),'[]') from (select id,amount_cents,paid_at,stripe_reference from public.px_manual_payouts where rep_id=rid order by paid_at desc limit 100)x),
   'deals',(select coalesce(jsonb_agg(x),'[]') from (select id,code,package_name,price_cents,stage,created_at from public.px_deals where rep_id=rid order by created_at desc limit 100)x),
   'calls',(select coalesce(jsonb_agg(x),'[]') from (select id,business_id,outcome,created_at from public.px_calls where rep_id=rid order by created_at desc limit 100)x),
   'recordings',(select coalesce(jsonb_agg(x),'[]') from (select id,title,recorded_at,status from public.px_call_recordings where rep_id=rid order by recorded_at desc limit 100)x),
   'audit',(select coalesce(jsonb_agg(x),'[]') from (select id,action,actor_id,reason,created_at from public.px_audit where target_id=rid::text or actor_id=rid order by created_at desc limit 100)x));
 elsif kind='business' and exists(select 1 from public.px_businesses where id=rid and deleted_at is not null) then
  raise exception 'This business has been removed.';
 end if;
 result:=px_private.report_before_operations(kind,p);
 -- Add canonical person references to already-authorized rows, never broaden scope.
 if jsonb_typeof(result->'rows')='array' then
  result:=jsonb_set(result,'{rows}',(select coalesce(jsonb_agg(case when rr.id is null then x else x||jsonb_build_object('rep_code',rr.code,'rep_name',rr.name,'rep_deleted_at',rr.deleted_at) end order by ord),'[]') from jsonb_array_elements(result->'rows') with ordinality a(x,ord) left join public.px_reps rr on rr.id=nullif(x->>'rep_id','')::uuid));
 end if;
 return result;
end$$;
revoke all on function px_private.report(text,jsonb) from public,anon;
grant execute on function px_private.report(text,jsonb) to authenticated;
create or replace function public.px_report(kind text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.report(kind,p)$$;

alter function px_private.service_guard(text,jsonb) rename to service_before_operations;
revoke all on function px_private.service_before_operations(text,jsonb) from public,anon,authenticated,service_role;
create function px_private.service_guard(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; cfg jsonb; paths jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Service access required.' using errcode='42501';end if;
 if action='support_media_cleanup' then
  select value into cfg from public.px_settings where id for update;
  select coalesce(jsonb_agg(name),'[]') into paths from (select name from storage.objects o where bucket_id='pixelalty-profile-media' and name~'^support/[a-f0-9-]{36}\.(png|jpg|webp)$' and (created_at<now()-interval '1 day' or coalesce(cfg->'support_media_retired','[]') ? name) and not exists(select 1 from jsonb_array_elements(cfg->'support_channels') c where c->>'qr_path'=o.name) order by created_at limit 50)x;
  update public.px_settings set value=jsonb_set(value,'{support_media_retired}',(select coalesce(jsonb_agg(distinct x),'[]') from jsonb_array_elements(coalesce(cfg->'support_media_retired','[]')||paths) x)) where id;
  return paths;
 elsif action='support_media_removed' then
  if exists(select 1 from storage.objects where bucket_id='pixelalty-profile-media' and name=p->>'path') then raise exception 'Finish storage removal first.';end if;
  perform 1 from public.px_settings where id for update;
  update public.px_settings set value=jsonb_set(value,'{support_media_retired}',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(coalesce(value->'support_media_retired','[]')) x where x #>> '{}' <> p->>'path')) where id;
  return '{}';
 end if;
 result:=px_private.service_before_operations(action,p);
 if action='diagnostic' then
  update public.px_diagnostics set action=left(p->>'action',80),error_type=left(p->>'error_type',80),safe_context=case when jsonb_typeof(p->'safe_context')='object' and length((p->'safe_context')::text)<=2000 then p->'safe_context' else '{}' end where id=(p->>'id')::uuid;
 end if;
 return result;
end$$;
revoke all on function px_private.service_guard(text,jsonb) from public,anon,authenticated;
grant execute on function px_private.service_guard(text,jsonb) to service_role;
create or replace function public.px_service(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.service_guard(action,p)$$;

-- Stripe charge timestamps have second precision; use the same precision for catalog windows.
-- Stored sales/deal snapshots remain authoritative on every retry.
-- Same verified-payment workflow, selecting the catalog version effective when paid.
create or replace function px_private.service_before_operations(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.px_verified_sales; m public.px_sales_codes; pkg public.px_packages; d public.px_deals; py public.px_payments; c public.px_commissions; reason text; rid uuid; cid uuid; result jsonb; fresh boolean:=false;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Service access required.' using errcode='42501';end if;
 if action='verified_sale' then
  perform pg_advisory_xact_lock(hashtextextended('pixelalty-payment:'||(p->>'payment_intent'),0));
  select * into s from public.px_verified_sales where payment_intent=p->>'payment_intent' for update;
  if s.id is null then
   if p->>'currency'<>'usd' or (p->>'amount_cents')::int<=0 then raise exception 'A verified USD payment is required.';end if;
   if nullif(p->>'deal_id','') is not null then
    select * into d from public.px_deals where id=(p->>'deal_id')::uuid for update;
    if d.id is null or d.checkout_id is distinct from p->>'checkout_id' or d.price_cents<>(p->>'subtotal_cents')::int then raise exception 'Checkout does not match its deal snapshot.';end if;
    select * into pkg from public.px_packages where id=d.package_id;
    pkg.commission_cents:=d.commission_cents;pkg.sale_xp:=d.sale_xp;
   else
    select * into pkg from public.px_packages where code=p->>'package_code' and date_trunc('second',created_at)<=(p->>'paid_at')::timestamptz and (retired_at is null or date_trunc('second',retired_at)>(p->>'paid_at')::timestamptz) order by version desc limit 1;
    if pkg.id is not null and ((pkg.code<>'advanced' and pkg.price_cents<>(p->>'subtotal_cents')::int) or (pkg.code='advanced' and pkg.price_cents>(p->>'subtotal_cents')::int)) then pkg.id:=null;end if;
   end if;
   reason:=case when pkg.id is null then 'package_unmapped' when nullif(p->>'promotion_code','') is null then 'direct' when coalesce((p->>'discount_valid')::boolean,false) is not true then 'discount_mismatch' else 'code_unmapped' end;
   if reason='code_unmapped' then
    select sc.* into m from public.px_sales_codes sc join public.px_reps r on r.id=sc.rep_id where sc.code=upper(trim(p->>'promotion_code')) and sc.active and r.status='active' and (sc.stripe_promotion_code_id is null or sc.stripe_promotion_code_id=p->>'promotion_code_id') for share of sc;
    if m.id is not null then reason:='attributed';rid:=m.rep_id;end if;
   end if;
   insert into public.px_verified_sales(payment_intent,checkout_id,rep_id,sales_code_id,promotion_code,promotion_code_id,package_id,package_name,deal_id,subtotal_cents,discount_cents,amount_cents,commission_cents,sale_xp,attribution,paid_at)
   values(p->>'payment_intent',p->>'checkout_id',rid,m.id,nullif(upper(trim(p->>'promotion_code')),''),nullif(p->>'promotion_code_id',''),pkg.id,coalesce(pkg.name,'Unmapped customer purchase'),d.id,(p->>'subtotal_cents')::int,(p->>'discount_cents')::int,(p->>'amount_cents')::int,case when rid is null then 0 else pkg.commission_cents end,case when rid is null then 0 else pkg.sale_xp end,reason,(p->>'paid_at')::timestamptz) returning * into s;
   fresh:=true;
  elsif s.checkout_id is distinct from p->>'checkout_id' or s.amount_cents<>(p->>'amount_cents')::int then raise exception 'Payment snapshot cannot be changed.';end if;
  insert into public.px_payments(deal_id,sale_id,payment_intent,charge_id,amount_cents,refunded_cents,disputed,settled,available_at)
  values(s.deal_id,s.id,s.payment_intent,p->>'charge_id',s.amount_cents,(p->>'refunded_cents')::int,(p->>'disputed')::boolean,(p->>'settled')::boolean,(p->>'available_at')::timestamptz)
  on conflict(payment_intent) do update set refunded_cents=greatest(public.px_payments.refunded_cents,excluded.refunded_cents),disputed=excluded.disputed,settled=excluded.settled,available_at=excluded.available_at returning * into py;
  if py.sale_id is distinct from s.id or py.charge_id is distinct from p->>'charge_id' then raise exception 'Payment source cannot be changed.';end if;
  if s.deal_id is not null then
   update public.px_deals set stage='paid' where id=s.deal_id;
   update public.px_businesses set customer=true,stage='won' where id=(select business_id from public.px_deals where id=s.deal_id);
   update public.px_followups set status='cancelled' where business_id=(select business_id from public.px_deals where id=s.deal_id) and status='open';
   insert into public.px_fulfillment(deal_id) values(s.deal_id) on conflict do nothing;
  end if;
  if s.rep_id is not null then
   insert into public.px_commissions(deal_id,sale_id,rep_id,amount_cents,hold_until) values(s.deal_id,s.id,s.rep_id,s.commission_cents,now()+make_interval(days=>(select (value->>'hold_days')::int from public.px_settings))) on conflict(sale_id) do nothing returning id into cid;
   if cid is not null then insert into public.px_commission_events(commission_id,event,amount_cents,external_id,reason) values(cid,'earned',s.commission_cents,s.payment_intent,'Verified Stripe payment and active promotion-code mapping');end if;
   select * into c from public.px_commissions where sale_id=s.id for update;
   if py.refunded_cents>0 or py.disputed then
    update public.px_commissions set status=case when c.status in ('paid','queued','transferred','recovery_review') or c.transfer_id is not null or exists(select 1 from public.px_manual_payout_items where commission_id=c.id) then 'recovery_review' else 'hold' end,manual_hold=true where id=c.id;
    insert into public.px_commission_events(commission_id,event,external_id,reason) values(c.id,'payment_review',p->>'event_id','Refund/dispute: preserve paid history; Finance adjustment required') on conflict do nothing;
   end if;
   insert into public.px_xp(rep_id,source,source_id,amount) values(s.rep_id,'sale',s.id,s.sale_xp) on conflict do nothing;
   if py.refunded_cents=py.amount_cents then insert into public.px_xp(rep_id,source,source_id,amount) values(s.rep_id,'refund',s.id,-s.sale_xp) on conflict do nothing;end if;
   if fresh then insert into public.px_notifications(rep_id,title,body,link) values(s.rep_id,'Sale verified',s.package_name||' payment verified. Your fixed commission is unchanged by the customer discount.','/money');end if;
  end if;
  insert into public.px_stripe_events(id,type,status) values(p->>'event_id',p->>'event_type','processed') on conflict(id) do update set status='processed',error=null;
  return jsonb_build_object('sale_id',s.id,'attribution',s.attribution,'duplicate',not fresh);
 end if;
 result:=px_private.service_guard_before_manual(action,p);
 if action='tick' then
  update public.px_commissions cm set status='payable' from public.px_payments payment_row where payment_row.sale_id=cm.sale_id and cm.status='hold' and not cm.manual_hold and cm.hold_until<=now() and payment_row.settled and payment_row.refunded_cents=0 and not payment_row.disputed;
 end if;
 return result;
end$$;
