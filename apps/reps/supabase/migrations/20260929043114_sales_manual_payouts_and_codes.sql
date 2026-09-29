-- Manual V1 progress tracking. No bank data, provider credentials, or API calls.
-- Existing Connect rows, references, and financial history remain untouched.
create table public.px_payout_setup(
 rep_id uuid primary key references public.px_reps(id),
 email text not null check(length(email)<=254 and email~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 phone text not null check(phone~'^\+[0-9]{11,15}$'),
 legal_first_name text not null check(length(legal_first_name) between 1 and 100 and legal_first_name!~'[[:cntrl:]<>]'),
 legal_last_name text not null check(length(legal_last_name) between 1 and 100 and legal_last_name!~'[[:cntrl:]<>]'),
 status text not null default 'submitted' check(status in ('submitted','stripe_setup_pending','ready','needs_correction')),
 submitted_at timestamptz not null default now(),stripe_setup_sent_at timestamptz,ready_at timestamptz,needs_correction_at timestamptz,
 correction_reason text not null default '' check(length(correction_reason)<=500),
 reviewed_by uuid references px_private.identities(id),approved_by uuid references px_private.identities(id),
 stripe_recipient_reference text check(stripe_recipient_reference~'^(acct|rcp|recipient)_[A-Za-z0-9_]{3,100}$'),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index px_payout_setup_queue on public.px_payout_setup(status,submitted_at);
create index px_payout_setup_reviewer on public.px_payout_setup(reviewed_by);
create index px_payout_setup_approver on public.px_payout_setup(approved_by);
alter table public.px_payout_setup enable row level security;
revoke all on public.px_payout_setup from public,anon,authenticated;
grant select on public.px_payout_setup to authenticated;
grant all on public.px_payout_setup to service_role;
create policy payout_setup_read on public.px_payout_setup for select to authenticated using(rep_id=(select auth.uid()) or px_private.has_role(array['finance_admin']));

create table public.px_sales_codes(
 id uuid primary key default gen_random_uuid(),rep_id uuid not null references public.px_reps(id),
 code text not null check(code~'^[A-Z0-9]{2,24}$'),active boolean not null default true,
 stripe_promotion_code_id text check(stripe_promotion_code_id~'^promo_[A-Za-z0-9]{3,100}$'),
 assigned_by uuid not null references px_private.identities(id),created_at timestamptz not null default now(),deactivated_at timestamptz
);
create unique index px_sales_code_active_code on public.px_sales_codes(code) where active;
create unique index px_sales_code_active_rep on public.px_sales_codes(rep_id) where active;
create index px_sales_code_history on public.px_sales_codes(rep_id,created_at desc);
create index px_sales_code_actor on public.px_sales_codes(assigned_by);
alter table public.px_sales_codes enable row level security;
revoke all on public.px_sales_codes from public,anon,authenticated;
grant select on public.px_sales_codes to authenticated;
grant all on public.px_sales_codes to service_role;
create policy sales_codes_read on public.px_sales_codes for select to authenticated using(rep_id=(select auth.uid()) or px_private.has_role(array['sales_admin','finance_admin']));

-- Grandfather current active users' workspace access, never their payout approval.
alter table public.px_reps add column manual_setup_legacy_access boolean not null default false;
update public.px_reps set manual_setup_legacy_access=true where status='active';
alter function px_private.onboarding(uuid) rename to onboarding_before_manual;
revoke all on function px_private.onboarding_before_manual(uuid) from public,anon,authenticated;
create function px_private.onboarding(rid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; steps jsonb; setup public.px_payout_setup; sc public.px_sales_codes; ready boolean;
begin
 result:=px_private.onboarding_before_manual(rid);
 select * into setup from public.px_payout_setup where rep_id=rid;
 select * into sc from public.px_sales_codes where rep_id=rid and active;
 select jsonb_agg(case when s->>'key'='payout' then s||jsonb_build_object(
  'title','Payout setup approved','required',true,'complete',coalesce(setup.status='ready',false),
  'actor',case when setup.rep_id is null or setup.status='needs_correction' then 'rep' else 'admin' end,
  'message',case setup.status when 'submitted' then 'Submitted — awaiting Stripe setup' when 'stripe_setup_pending' then 'Stripe setup pending. Check your inbox and Spam/Junk folder.' when 'ready' then 'Payout setup complete — approved by Pixelalty.' when 'needs_correction' then setup.correction_reason else 'Submit your contact information. Stripe collects banking details separately.' end,
  'action',case when setup.rep_id is null then 'Set Up Payouts' when setup.status='needs_correction' then 'Update payout information' else null end)
  else s end order by ord) into steps from jsonb_array_elements(result->'steps') with ordinality a(s,ord);
 steps:=steps||jsonb_build_array(jsonb_build_object('key','sales_code','title','Sales code assigned','complete',sc.id is not null,'required',true,'actor','admin','message',case when sc.id is null then 'Waiting for Pixelalty' else 'Your customer promotion code is assigned.' end,'link','/onboarding?step=sales-code','action',null));
 ready:=not exists(select 1 from jsonb_array_elements(steps) s where (s->>'required')::boolean and not (s->>'complete')::boolean and s->>'key'<>'activation');
 return result||jsonb_build_object('steps',steps,'ready',ready,'payout',jsonb_build_object('started',setup.rep_id is not null,'ready',coalesce(setup.status='ready',false),'status',coalesce(setup.status,'not_started')),'sales_code',sc.code);
end$$;

alter function px_private.action(text,jsonb) rename to action_before_manual;
revoke all on function px_private.action_before_manual(text,jsonb) from public,anon,authenticated;
create function px_private.action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();rid uuid; setup public.px_payout_setup; sc public.px_sales_codes; code_value text; why text:=trim(coalesce(p->>'reason','')); next_status text; result jsonb;
begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();
 if action='payout_submit' then
  if (p-array['email','phone','legal_first_name','legal_last_name','acknowledged'])<>'{}'::jsonb then raise exception 'Only contact information and legal name are accepted.';end if;
  perform 1 from public.px_reps where id=uid and status in ('onboarding','active') for update;
  if not found then raise exception 'Payout setup is not available for this account.';end if;
  if coalesce((p->>'acknowledged')::boolean,false) is not true then raise exception 'Confirm that your information is accurate.';end if;
  p:=p||jsonb_build_object('email',lower(trim(p->>'email')),'phone',trim(p->>'phone'),'legal_first_name',trim(p->>'legal_first_name'),'legal_last_name',trim(p->>'legal_last_name'));
  if coalesce(p->>'email','')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p->>'email')>254 then raise exception 'Enter a valid email address.';end if;
  if coalesce(p->>'phone','')!~'^\+[0-9]{11,15}$' then raise exception 'Enter a valid phone number with country code.';end if;
  if coalesce(length(p->>'legal_first_name'),0) not between 1 and 100 or coalesce(length(p->>'legal_last_name'),0) not between 1 and 100 or ((p->>'legal_first_name')||(p->>'legal_last_name'))~'[[:cntrl:]<>]' then raise exception 'Enter your legal first and last name, each up to 100 characters.';end if;
  select * into setup from public.px_payout_setup where rep_id=uid for update;
  if setup.status in ('submitted','stripe_setup_pending','ready') then
   if setup.email=p->>'email' and setup.phone=p->>'phone' and setup.legal_first_name=p->>'legal_first_name' and setup.legal_last_name=p->>'legal_last_name' then return to_jsonb(setup);end if;
   raise exception 'Your submission is under review. Contact Pixelalty if a correction is needed.';
  end if;
  insert into public.px_payout_setup(rep_id,email,phone,legal_first_name,legal_last_name) values(uid,p->>'email',p->>'phone',p->>'legal_first_name',p->>'legal_last_name')
  on conflict(rep_id) do update set email=excluded.email,phone=excluded.phone,legal_first_name=excluded.legal_first_name,legal_last_name=excluded.legal_last_name,status='submitted',submitted_at=now(),updated_at=now(),correction_reason='',ready_at=null,approved_by=null,stripe_setup_sent_at=null returning * into setup;
  perform px_private.audit(action,uid::text,'Rep submitted basic payout contact information',jsonb_build_object('status','submitted'));
  return to_jsonb(setup);
 elsif action in ('payout_sent','payout_ready','payout_correction') then
  perform px_private.require_role(array['finance_admin']);rid:=(p->>'id')::uuid;
  perform 1 from public.px_reps where id=rid and status in ('onboarding','active') for update;
  if not found then raise exception 'Select an active or onboarding rep.';end if;
  select * into setup from public.px_payout_setup where rep_id=rid for update;
  if setup.rep_id is null then raise exception 'The rep must submit payout setup first.';end if;
  if coalesce((p->>'confirmed')::boolean,false) is not true then raise exception 'Confirm the completed manual review.';end if;
  next_status:=case action when 'payout_sent' then 'stripe_setup_pending' when 'payout_ready' then 'ready' else 'needs_correction' end;
  if setup.status=next_status then return to_jsonb(setup);end if;
  if p->>'expected_status' is distinct from setup.status then raise exception 'This request changed. Refresh before reviewing it.';end if;
  if (action='payout_sent' and setup.status<>'submitted') or (action='payout_ready' and setup.status<>'stripe_setup_pending') or (action='payout_correction' and setup.status not in ('submitted','stripe_setup_pending')) then raise exception 'This payout status transition is not available.';end if;
  if action='payout_correction' and (length(why) not between 5 and 500 or why~'[[:cntrl:]]') then raise exception 'Enter a correction reason of 5–500 characters. Do not include sensitive information.';end if;
  update public.px_payout_setup set status=next_status,updated_at=now(),reviewed_by=uid,
   stripe_setup_sent_at=case when action='payout_sent' then now() else stripe_setup_sent_at end,
   ready_at=case when action='payout_ready' then now() else ready_at end,approved_by=case when action='payout_ready' then uid else approved_by end,
   needs_correction_at=case when action='payout_correction' then now() else needs_correction_at end,
   correction_reason=case when action='payout_correction' then why else '' end,
   stripe_recipient_reference=coalesce(nullif(trim(p->>'stripe_recipient_reference'),''),stripe_recipient_reference) where rep_id=rid;
  perform px_private.audit(action,rid::text,case when action='payout_correction' then why else 'Admin confirmed manual Stripe step' end,jsonb_build_object('before',setup.status,'after',next_status));
  insert into public.px_notifications(rep_id,title,body,link) values(rid,
   case action when 'payout_sent' then 'Stripe setup pending' when 'payout_ready' then 'Payout setup complete' else 'Payout setup needs correction' end,
   case action when 'payout_sent' then 'Pixelalty initiated your Stripe setup. Check your email and Spam/Junk folder. Enter banking details only on Stripe’s secure page.' when 'payout_ready' then 'Pixelalty has approved your payout setup. Eligible commissions can now be paid.' else why end,'/onboarding?step=payout');
  return (select to_jsonb(t) from public.px_payout_setup t where rep_id=rid);
 elsif action in ('sales_code_save','sales_code_remove') then
  perform px_private.require_role(array['sales_admin']);rid:=(p->>'id')::uuid;
  perform 1 from public.px_reps where id=rid and status in ('onboarding','active','suspended') for update;
  if not found then raise exception 'Select an available rep.';end if;
  select * into sc from public.px_sales_codes where rep_id=rid and active for update;
  if action='sales_code_save' then
   code_value:=upper(trim(coalesce(p->>'code','')));
   if code_value!~'^[A-Z0-9]{2,24}$' then raise exception 'Use 2–24 letters and numbers for the exact Stripe promotion code.';end if;
   perform pg_advisory_xact_lock(hashtextextended('pixelalty-sales-code:'||code_value,0));
   if exists(select 1 from public.px_sales_codes where code=code_value and active and rep_id<>rid) then raise exception 'This code is already assigned to another rep. Neither assignment was changed.';end if;
   if sc.code=code_value then return to_jsonb(sc);end if;
  end if;
  update public.px_sales_codes set active=false,deactivated_at=now() where rep_id=rid and active;
  if action='sales_code_save' then
   insert into public.px_sales_codes(rep_id,code,assigned_by,stripe_promotion_code_id) values(rid,code_value,uid,nullif(trim(p->>'stripe_promotion_code_id'),''));
  else
   -- New accounts must keep an assigned code before accessing the selling workspace.
   -- Existing active accounts retain their pre-migration access, not payout approval.
   update public.px_reps set status='onboarding' where id=rid and status='active' and not manual_setup_legacy_access;
  end if;
  perform px_private.audit(action,rid::text,'Manual Pixelalty code mapping; Stripe code managed by owner',jsonb_build_object('before',sc.code,'after',code_value));
  insert into public.px_notifications(rep_id,title,body,link) values(rid,case when code_value is null then 'Sales code awaiting assignment' else 'Sales code assigned' end,case when code_value is null then 'Pixelalty will assign your replacement sales code. Historical sales are unchanged.' else 'Your customer promotion code is '||code_value||'. Customers get 2% off; your normal commission is unchanged.' end,'/money');
  return jsonb_build_object('code',code_value);
 elsif action='rep_activate' then
  perform px_private.require_role(array['sales_admin']);rid:=(p->>'id')::uuid;
  if length(why)<5 then raise exception 'Enter an audit reason.';end if;
  perform 1 from public.px_reps where id=rid and status in ('onboarding','suspended','active') and deleted_at is null for update;
  if not found then raise exception 'Select an available rep.';end if;
  result:=px_private.onboarding(rid);
  if not (result->>'ready')::boolean then raise exception 'Can''t activate yet. Complete required items: %; payout approval and sales-code assignment are required.',(select string_agg(s->>'title',', ') from jsonb_array_elements(result->'steps') s where (s->>'required')::boolean and not (s->>'complete')::boolean and s->>'key'<>'activation');end if;
  update public.px_reps set status='active' where id=rid;
  update public.px_applicants set stage='activated' where rep_id=rid;
  perform px_private.audit(action,rid::text,why);
  insert into public.px_notifications(rep_id,title,body,link,event_key) values(rid,'Your workspace is ready','Your account is active. Get your first leads to begin.','/leads','activated') on conflict do nothing;
  return '{}';
 end if;
 return px_private.action_before_manual(action,p);
end$$;
revoke all on function px_private.action(text,jsonb) from public,anon;
grant execute on function px_private.action(text,jsonb) to authenticated;
create or replace function public.px_action(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.action(action,p)$$;

alter function px_private.report(text,jsonb) rename to report_before_manual;
revoke all on function px_private.report_before_manual(text,jsonb) from public,anon,authenticated;
create function px_private.report(kind text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid:=coalesce(nullif(p->>'id','')::uuid,auth.uid()); pg int:=greatest(0,least(10000,coalesce((p->>'page')::int,0))); result jsonb;
begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();
 if kind='payout_setup' then
  if rid<>auth.uid() then perform px_private.require_role(array['finance_admin']);end if;
  return jsonb_build_object('setup',(select to_jsonb(s) from public.px_payout_setup s where rep_id=rid),'email',(select email from public.px_rep_private where rep_id=rid),'phone',(select details->>'phone' from public.px_applicants where rep_id=rid order by created_at desc limit 1));
 elsif kind='sales_code' then
  if rid<>auth.uid() then perform px_private.require_role(array['sales_admin','finance_admin']);end if;
  return jsonb_build_object('code',(select to_jsonb(s) from public.px_sales_codes s where rep_id=rid and active));
 elsif kind='payout_setup_queue' then
  perform px_private.require_role(array['finance_admin']);
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(t),'[]') from (select s.*,r.code rep_code,r.name rep_name from public.px_payout_setup s join public.px_reps r on r.id=s.rep_id where (coalesce(p->>'status','') in ('','all') or s.status=p->>'status') order by s.submitted_at desc,s.rep_id limit 50 offset pg*50)t),
   'total',(select count(*) from public.px_payout_setup s where coalesce(p->>'status','') in ('','all') or s.status=p->>'status'));
 end if;
 result:=px_private.report_before_manual(kind,p);
 if kind='money' then result:=(result-'connect')||jsonb_build_object('payout_setup',(select status from public.px_payout_setup where rep_id=auth.uid()));end if;
 return result;
end$$;
revoke all on function px_private.report(text,jsonb) from public,anon;
grant execute on function px_private.report(text,jsonb) to authenticated;
create or replace function public.px_report(kind text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.report(kind,p)$$;

comment on table public.px_connect is 'Legacy Connect history only. Not V1 payout readiness; do not create new accounts.';

-- Verified customer payments include direct Payment Link purchases with no CRM deal.
create table public.px_verified_sales(
 id uuid primary key default gen_random_uuid(),payment_intent text not null unique,checkout_id text not null unique,
 rep_id uuid references public.px_reps(id),sales_code_id uuid references public.px_sales_codes(id),
 promotion_code text,promotion_code_id text,package_id uuid references public.px_packages(id),package_name text not null,
 deal_id uuid unique references public.px_deals(id),
 subtotal_cents int not null check(subtotal_cents>0),discount_cents int not null check(discount_cents>=0),amount_cents int not null check(amount_cents>0),
 commission_cents int not null check(commission_cents>=0),sale_xp int not null check(sale_xp>=0),
 attribution text not null check(attribution in ('attributed','direct','code_unmapped','discount_mismatch','package_unmapped')),
 paid_at timestamptz not null,created_at timestamptz not null default now()
);
create index px_sales_rep on public.px_verified_sales(rep_id,paid_at desc);
create index px_sales_code on public.px_verified_sales(sales_code_id);
create index px_sales_package on public.px_verified_sales(package_id);
alter table public.px_verified_sales enable row level security;
revoke all on public.px_verified_sales from public,anon,authenticated;
grant select on public.px_verified_sales to authenticated;
grant all on public.px_verified_sales to service_role;
create policy verified_sales_read on public.px_verified_sales for select to authenticated using(rep_id=(select auth.uid()) or px_private.has_role(array['finance_admin','sales_admin']));
create trigger immutable_sale before update or delete on public.px_verified_sales for each row execute function px_private.immutable();
alter table public.px_payments alter column deal_id drop not null;
alter table public.px_payments add column sale_id uuid unique references public.px_verified_sales(id);
alter table public.px_payments add constraint payment_source check(deal_id is not null or sale_id is not null);
alter table public.px_commissions alter column deal_id drop not null;
alter table public.px_commissions add column sale_id uuid unique references public.px_verified_sales(id);
alter table public.px_commissions add constraint commission_source check(deal_id is not null or sale_id is not null);
alter table public.px_commissions drop constraint px_commissions_status_check;
alter table public.px_commissions add constraint px_commissions_status_check check(status in ('hold','payable','queued','transferred','recovery_review','reversed','paid'));

create table public.px_manual_payouts(
 id uuid primary key,rep_id uuid not null references public.px_reps(id),amount_cents int not null check(amount_cents>0),
 paid_at timestamptz not null,stripe_reference text check(stripe_reference~'^(op|obp|po|poi|payout|outbound)_[A-Za-z0-9_]{3,100}$'),
 note text not null default '' check(length(note)<=500),confirmed_by uuid not null references px_private.identities(id),
 created_at timestamptz not null default now()
);
create table public.px_manual_payout_items(
 commission_id uuid primary key references public.px_commissions(id),payout_id uuid not null references public.px_manual_payouts(id),amount_cents int not null check(amount_cents>0)
);
create index px_manual_payout_rep on public.px_manual_payouts(rep_id,paid_at desc);
create index px_manual_payout_actor on public.px_manual_payouts(confirmed_by);
create index px_manual_payout_items_parent on public.px_manual_payout_items(payout_id);
alter table public.px_manual_payouts enable row level security;
alter table public.px_manual_payout_items enable row level security;
revoke all on public.px_manual_payouts,public.px_manual_payout_items from public,anon,authenticated;
grant select on public.px_manual_payouts,public.px_manual_payout_items to authenticated;
grant all on public.px_manual_payouts,public.px_manual_payout_items to service_role;
create policy manual_payout_read on public.px_manual_payouts for select to authenticated using(rep_id=(select auth.uid()) or px_private.has_role(array['finance_admin']));
create policy manual_payout_item_read on public.px_manual_payout_items for select to authenticated using(exists(select 1 from public.px_manual_payouts p where p.id=payout_id));
create trigger immutable_manual_payout before update or delete on public.px_manual_payouts for each row execute function px_private.immutable();
create trigger immutable_manual_payout_item before update or delete on public.px_manual_payout_items for each row execute function px_private.immutable();

alter function px_private.service_guard(text,jsonb) rename to service_guard_before_manual;
revoke all on function px_private.service_guard_before_manual(text,jsonb) from public,anon,authenticated,service_role;
create function px_private.service_guard(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
    select * into pkg from public.px_packages where code=p->>'package_code' and active;
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
revoke all on function px_private.service_guard(text,jsonb) from public,anon,authenticated;
grant execute on function px_private.service_guard(text,jsonb) to service_role;
create or replace function public.px_service(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.service_guard(action,p)$$;

alter function px_private.action(text,jsonb) rename to action_before_manual_finance;
revoke all on function px_private.action_before_manual_finance(text,jsonb) from public,anon,authenticated;
create function px_private.action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.px_commissions; py public.px_payments; paid public.px_manual_payouts; ids uuid[]; rid uuid; amount int; why text:=trim(coalesce(p->>'reason','')); result jsonb;
begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();
 if action='manual_mark_paid' then
  perform px_private.require_role(array['finance_admin']);
  if coalesce((p->>'confirmed')::boolean,false) is not true then raise exception 'Confirm that you actually sent this payout in Stripe.';end if;
  select array_agg(distinct v::uuid order by v::uuid) into ids from jsonb_array_elements_text(p->'commission_ids') v;
  if coalesce(cardinality(ids),0) not between 1 and 100 then raise exception 'Select 1–100 eligible commissions for one rep.';end if;
  perform pg_advisory_xact_lock(hashtextextended('pixelalty-manual-payout:'||(p->>'request_id'),0));
  select * into paid from public.px_manual_payouts where id=(p->>'request_id')::uuid;
  if paid.id is not null then
   if paid.amount_cents<>(p->>'amount_cents')::int or ids is distinct from (select array_agg(commission_id order by commission_id) from public.px_manual_payout_items where payout_id=paid.id) then raise exception 'A confirmed payout cannot be changed.';end if;
   return to_jsonb(paid);
  end if;
  -- Lock payment snapshots before commissions, matching webhook reconciliation.
  perform 1 from public.px_payments payment_row join public.px_commissions commrow on (payment_row.sale_id=commrow.sale_id or (commrow.sale_id is null and payment_row.deal_id=commrow.deal_id)) where commrow.id=any(ids) order by payment_row.id for update of payment_row;
  perform 1 from public.px_commissions where id=any(ids) order by id for update;
  if (select count(*) from public.px_commissions where id=any(ids))<>cardinality(ids) then raise exception 'A selected commission is unavailable.';end if;
  for c in select * from public.px_commissions where id=any(ids) order by id loop
   if rid is not null and rid<>c.rep_id then raise exception 'Choose commissions for one rep per payout.';end if;rid:=c.rep_id;
   select * into py from public.px_payments where sale_id=c.sale_id or (c.sale_id is null and deal_id=c.deal_id);
   if c.status<>'payable' or c.manual_hold or c.hold_until>now() or c.transfer_id is not null or py.id is null or not py.settled or py.refunded_cents>0 or py.disputed or exists(select 1 from public.px_manual_payout_items where commission_id=c.id) then raise exception 'A selected commission is no longer payable. Refresh Finance.';end if;
  end loop;
  perform 1 from public.px_payout_setup where rep_id=rid and status='ready' for share;
  if not found then raise exception 'Pixelalty must approve this rep’s payout setup first.';end if;
  if not exists(select 1 from public.px_rep_private where rep_id=rid and tax_status='verified') then raise exception 'Verify the rep’s tax setup before recording payment.';end if;
  select sum(amount_cents) into amount from public.px_commissions where id=any(ids);
  if amount is distinct from (p->>'amount_cents')::int then raise exception 'The payout amount changed. Refresh before confirming.';end if;
  if nullif(p->>'paid_at','') is null or (p->>'paid_at')::timestamptz>now()+interval '5 minutes' or (p->>'paid_at')::timestamptz<now()-interval '1 year' then raise exception 'Enter the actual payment date (not a future date).';end if;
  insert into public.px_manual_payouts(id,rep_id,amount_cents,paid_at,stripe_reference,note,confirmed_by) values((p->>'request_id')::uuid,rid,amount,(p->>'paid_at')::timestamptz,nullif(trim(p->>'stripe_reference'),''),trim(coalesce(p->>'note','')),auth.uid()) returning * into paid;
  insert into public.px_manual_payout_items(commission_id,payout_id,amount_cents) select id,paid.id,amount_cents from public.px_commissions where id=any(ids);
  update public.px_commissions set status='paid' where id=any(ids);
  insert into public.px_commission_events(commission_id,event,amount_cents,actor_id,reason) select id,'manual_paid',amount_cents,auth.uid(),'Admin confirmed payment sent in Stripe; payout '||paid.id from public.px_commissions where id=any(ids);
  perform px_private.audit(action,paid.id::text,'Admin confirmed actual payout',jsonb_build_object('rep_id',rid,'amount_cents',amount,'commission_ids',ids,'paid_at',paid.paid_at));
  return to_jsonb(paid);
 elsif action in ('commission_hold','commission_release') then
  perform px_private.require_role(array['finance_admin']);
  if length(why)<5 then raise exception 'Enter an audit reason.';end if;
  select * into c from public.px_commissions where id=(p->>'id')::uuid for update;
  if c.id is null then raise exception 'Commission not found.';end if;
  if c.status in ('paid','queued','transferred','reversed','recovery_review') or exists(select 1 from public.px_manual_payout_items where commission_id=c.id) then raise exception 'Paid or reconciled history requires an adjustment, not a status rewrite.';end if;
  select * into py from public.px_payments where sale_id=c.sale_id or (c.sale_id is null and deal_id=c.deal_id);
  if action='commission_release' and (py.id is null or py.refunded_cents>0 or py.disputed) then raise exception 'Resolve the refund or dispute before releasing this commission.';end if;
  update public.px_commissions set manual_hold=action='commission_hold',status=case when action='commission_release' and hold_until<=now() and py.settled then 'payable' else 'hold' end where id=c.id;
  insert into public.px_commission_events(commission_id,event,reason,actor_id) values(c.id,action,why,auth.uid());
  perform px_private.audit(action,c.id::text,why);return '{}';
 end if;
 return px_private.action_before_manual_finance(action,p);
end$$;
revoke all on function px_private.action(text,jsonb) from public,anon;
grant execute on function px_private.action(text,jsonb) to authenticated;
create or replace function public.px_action(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.action(action,p)$$;

-- A unified verified-sales view for reporting; historical attribution is kept.
create function px_private.sale_totals() returns table(rep_id uuid,amount_cents int,paid_at timestamptz) language sql stable security definer set search_path='' as $$
 select s.rep_id,py.amount_cents,s.paid_at from public.px_verified_sales s join public.px_payments py on py.sale_id=s.id where s.rep_id is not null and py.refunded_cents=0 and not py.disputed
 union all select d.rep_id,py.amount_cents,py.created_at from public.px_payments py join public.px_deals d on d.id=py.deal_id where py.sale_id is null and py.refunded_cents=0 and not py.disputed
$$;
revoke all on function px_private.sale_totals() from public,anon,authenticated;
-- Preserve the existing explicit grant/revoke precedence for achievements.
create or replace function px_private.progress_summary(rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('streak_adjustment',(select coalesce(sum(amount),0) from px_private.progression_events where rep_id=rid and kind='streak'),'freeze_adjustment',(select coalesce(sum(amount),0) from px_private.progression_events where rep_id=rid and kind='freeze' and created_at>=date_trunc('month',now())),
 'achievements',(select coalesce(jsonb_agg(key),'[]') from (select key,coalesce((select e.amount>0 from px_private.progression_events e where e.rep_id=rid and kind='achievement' and achievement=key order by created_at desc,id desc limit 1),earned) enabled from (
 select 'first_call' key,exists(select 1 from public.px_calls where rep_id=rid and qualifying) earned
 union all select 'first_sale',exists(select 1 from px_private.sale_totals() s where s.rep_id=rid)
 union all select 'trained',exists(select 1 from public.px_content where kind='lesson' and required and active) and not exists(select 1 from public.px_content c where kind='lesson' and required and active and not exists(select 1 from public.px_training t where t.rep_id=rid and t.content_id=c.id and t.passed))
 ) a) b where enabled));
$$;
alter function px_private.report(text,jsonb) rename to report_before_manual_finance;
revoke all on function px_private.report_before_manual_finance(text,jsonb) from public,anon,authenticated;
create function px_private.report(kind text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; uid uuid:=auth.uid(); pg int:=greatest(0,least(10000,coalesce((p->>'page')::int,0))); start_at timestamptz; metric text;
begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();
 if kind='manual_finance' then
  perform px_private.require_role(array['finance_admin']);
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(t),'[]') from (
   select c.*,r.name rep_name,r.code rep_code,coalesce(s.package_name,d.package_name) package_name,coalesce(py.amount_cents,0) sale_cents,
    coalesce(ps.status='ready',false) payout_ready,coalesce(ps.status,'not_started') payout_status,pr.tax_status,
    (c.status='payable' and not c.manual_hold and c.hold_until<=now() and c.transfer_id is null and py.settled and py.refunded_cents=0 and not py.disputed and ps.status='ready' and pr.tax_status='verified' and not exists(select 1 from public.px_manual_payout_items where commission_id=c.id)) eligible
   from public.px_commissions c join public.px_reps r on r.id=c.rep_id join public.px_rep_private pr on pr.rep_id=r.id
   left join public.px_payout_setup ps on ps.rep_id=r.id left join public.px_verified_sales s on s.id=c.sale_id left join public.px_deals d on d.id=c.deal_id
   left join public.px_payments py on py.sale_id=c.sale_id or (c.sale_id is null and py.deal_id=c.deal_id)
   where coalesce(p->>'status','all')='all' or c.status=p->>'status' order by c.created_at desc,c.id limit 50 offset pg*50)t),
   'total',(select count(*) from public.px_commissions c where coalesce(p->>'status','all')='all' or c.status=p->>'status'),
   'weekly',(select coalesce(jsonb_agg(t),'[]') from (select r.id,r.name,r.code,sum(c.amount_cents) amount_cents,count(*) commissions,coalesce(ps.status='ready',false) payout_ready from public.px_commissions c join public.px_reps r on r.id=c.rep_id left join public.px_payout_setup ps on ps.rep_id=r.id where c.status='payable' group by r.id,ps.status order by r.name)t));
 elsif kind='leaderboard' then
  if not px_private.has_role(array['sales_admin']) and exists(select 1 from public.px_rep_private where rep_id=uid and access_overrides->>'leaderboard'='false') then raise exception 'This view is not available for your account.' using errcode='42501';end if;
  start_at:=case when p->>'period'='all' then '-infinity'::timestamptz else date_trunc('month',now()) end;metric:=coalesce(p->>'metric','sales');
  with stats as (
   select r.id,r.name,r.code,coalesce(x.xp,0) xp,coalesce(c.calls,0) calls,coalesce(c.conversations,0) conversations,coalesce(s.sales,0) sales,coalesce(s.revenue_cents,0) revenue_cents,
    case when coalesce(c.calls,0)>=100 then round(100.0*coalesce(s.sales,0)/c.calls,2) else null end conversion
   from public.px_reps r
   left join (select rep_id,sum(amount) xp from public.px_xp group by rep_id)x on x.rep_id=r.id
   left join (select rep_id,count(*) filter(where qualifying) calls,count(*) filter(where qualifying and outcome in ('conversation','interested','meeting','proposal')) conversations from public.px_calls where created_at>=start_at group by rep_id)c on c.rep_id=r.id
   left join (select t.rep_id,count(*) sales,sum(t.amount_cents) revenue_cents from px_private.sale_totals() t where t.paid_at>=start_at group by t.rep_id)s on s.rep_id=r.id where r.status='active'
  ), ranked as(select *,row_number() over(order by (case metric when 'revenue' then revenue_cents when 'calls' then calls when 'conversations' then conversations when 'conversion' then coalesce(conversion,-1) else sales end) desc,xp desc,code) rank from stats)
  select coalesce(jsonb_agg(to_jsonb(t) order by rank),'[]') into result from ranked t where rank between pg*50+1 and (pg+1)*50 or abs(rank-coalesce((select rank from ranked where id=uid),0))<=2;
  return result;
 end if;
 result:=px_private.report_before_manual_finance(kind,p);
 if kind='money' then
  result:=result||jsonb_build_object('paid',(select coalesce(sum(amount_cents),0) from public.px_manual_payouts where rep_id=uid));
 elsif kind='dashboard' then
  result:=result||jsonb_build_object('sales',(select count(*) from px_private.sale_totals() where rep_id=uid),'month_sales',(select count(*) from px_private.sale_totals() where rep_id=uid and paid_at>=date_trunc('month',now())),
   'month_commission',(select coalesce(sum(c.amount_cents),0) from public.px_commissions c join public.px_payments py on py.sale_id=c.sale_id or (c.sale_id is null and py.deal_id=c.deal_id) where c.rep_id=uid and py.refunded_cents=0 and not py.disputed and py.created_at>=date_trunc('month',now())));
 end if;
 return result;
end$$;
revoke all on function px_private.report(text,jsonb) from public,anon;
grant execute on function px_private.report(text,jsonb) to authenticated;
create or replace function public.px_report(kind text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.report(kind,p)$$;

-- Explicit secure-archive acknowledgment is distinct from downloading or review.
alter table px_private.tax_documents add column securely_archived_at timestamptz;
alter table px_private.tax_documents add column securely_archived_by uuid references px_private.identities(id);
create index px_tax_archive_actor on px_private.tax_documents(securely_archived_by);
alter table px_private.tax_events drop constraint tax_events_event_check;
alter table px_private.tax_events add constraint tax_events_event_check check(event in ('uploaded','downloaded','under_review','verified','needs_correction','replaced','archived','securely_archived'));
alter function px_private.tax(text,jsonb) rename to tax_before_secure_archive;
revoke all on function px_private.tax_before_secure_archive(text,jsonb) from public,anon,authenticated;
create function px_private.tax(action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare doc px_private.tax_documents;result jsonb;
begin
 perform px_private.require_access();perform px_private.require_enrolled_mfa();
 if action in ('download','download_authorize','confirm_secure_archive') then
  perform px_private.require_role(array['finance_admin']);
  select * into doc from px_private.tax_documents where id=(p->>'id')::uuid for update;
  if doc.id is null then raise exception 'Document not found.';end if;
  if action='confirm_secure_archive' then
   if doc.securely_archived_at is not null then return '{}';end if;
   if doc.status<>'verified' or coalesce((p->>'confirmed')::boolean,false) is not true then raise exception 'Verify the W-9 and confirm that you stored it in encrypted storage first.';end if;
   if not exists(select 1 from px_private.tax_events where document_id=doc.id and actor_id=auth.uid() and event='downloaded') then raise exception 'Download the W-9 and securely archive it before confirming.';end if;
   update px_private.tax_documents set securely_archived_at=now(),securely_archived_by=auth.uid() where id=doc.id;
   insert into px_private.tax_events(document_id,rep_id,actor_id,event,reason) values(doc.id,doc.rep_id,auth.uid(),'securely_archived','Admin confirms storage in an encrypted retention location');
   perform px_private.audit(action,doc.id::text,'Admin confirmed secure external archive; portal download disabled');return '{}';
  elsif doc.securely_archived_at is not null then raise exception 'This W-9 has been securely archived. Use the protected external archive; portal downloads are disabled.';
  end if;
 end if;
 result:=px_private.tax_before_secure_archive(action,p);
 if action='summary' and result->'document' is not null and result->'document'<>'null'::jsonb then
  select * into doc from px_private.tax_documents where id=(result->'document'->>'id')::uuid;
  result:=jsonb_set(result,'{document}',result->'document'||jsonb_build_object('securely_archived',doc.securely_archived_at is not null,'securely_archived_at',doc.securely_archived_at));
 end if;
 if action='summary' and jsonb_typeof(result->'history')='array' then
  result:=jsonb_set(result,'{history}',(select coalesce(jsonb_agg(h||jsonb_build_object('securely_archived',d.securely_archived_at is not null) order by ord),'[]') from jsonb_array_elements(result->'history') with ordinality a(h,ord) left join px_private.tax_documents d on d.id=(h->>'id')::uuid));
 end if;
 return result;
end$$;
revoke all on function px_private.tax(text,jsonb) from public,anon;
grant execute on function px_private.tax(text,jsonb) to authenticated;
create or replace function public.px_tax(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.tax(action,p)$$;

alter table px_private.mail_outbox drop constraint mail_outbox_template_check;
alter table px_private.mail_outbox add constraint mail_outbox_template_check check(template in ('activated','onboarding','payout_setup'));
create function px_private.queue_payout_mail() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.title='Stripe setup pending' then insert into px_private.mail_outbox(event_key,rep_id,template) values('payout-setup:'||new.id,new.rep_id,'payout_setup') on conflict do nothing;end if;return new;
end$$;
revoke all on function px_private.queue_payout_mail() from public,anon,authenticated;
create trigger pixelalty_payout_email after insert on public.px_notifications for each row execute function px_private.queue_payout_mail();
alter function px_private.mail_action(text,jsonb) rename to mail_before_payout;
revoke all on function px_private.mail_before_payout(text,jsonb) from public,anon,authenticated,service_role;
create function px_private.mail_action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare job px_private.mail_outbox; result jsonb;
begin
 result:=px_private.mail_before_payout(action,p);
 if action='claim' and (result is null or result='null'::jsonb) then
  select m.* into job from px_private.mail_outbox m join public.px_reps r on r.id=m.rep_id join auth.users u on u.id=r.id
  where m.template='payout_setup' and m.status in ('pending','sending') and m.available_at<=now() and (m.lease_until is null or m.lease_until<now()) and r.status in ('active','onboarding') and u.email_confirmed_at is not null
  order by m.created_at for update of m skip locked limit 1;
  if job.id is null then return 'null';end if;
  update px_private.mail_outbox set status='sending',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=job.id returning * into job;
  return to_jsonb(job)||jsonb_build_object('email',(select email from auth.users where id=job.rep_id));
 end if;return result;
end$$;
revoke all on function px_private.mail_action(text,jsonb) from public,anon;
grant execute on function px_private.mail_action(text,jsonb) to authenticated,service_role;
create or replace function public.px_mail(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.mail_action(action,p)$$;

-- Optional, consent-based transactional SMS. Not authentication or marketing.
-- Provider sends have no app idempotency guarantee, so uncertain attempts require
-- review and are never automatically repeated. No backfill sends to old applicants.
create table px_private.sms_jobs(
 id uuid primary key default gen_random_uuid(),applicant_id uuid not null unique references public.px_applicants(id),
 phone text not null check(phone~'^\+[0-9]{11,15}$'),consented_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','review','sent','cancelled')),
 attempted_at timestamptz,sent_at timestamptz,provider_id text,created_at timestamptz not null default now()
);
create table px_private.sms_optouts(phone text primary key,opted_out_at timestamptz not null default now());
alter table px_private.sms_jobs enable row level security;
alter table px_private.sms_optouts enable row level security;
revoke all on px_private.sms_jobs,px_private.sms_optouts from public,anon,authenticated;
grant all on px_private.sms_jobs,px_private.sms_optouts to service_role;
create index sms_ready on px_private.sms_jobs(created_at) where status='pending';
create function px_private.queue_approval_sms() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.rep_id is not null and old.rep_id is null and new.details->>'sms_opt_in'='true'
  and new.details->>'sms_consent_source'='application_optional_checkbox'
  and new.details->>'phone'~'^\+[0-9]{11,15}$' and nullif(new.details->>'sms_opt_in_at','') is not null then
  insert into px_private.sms_jobs(applicant_id,phone,consented_at) values(new.id,new.details->>'phone',(new.details->>'sms_opt_in_at')::timestamptz) on conflict do nothing;
 end if;return new;
end$$;
create trigger approved_sms after update of rep_id on public.px_applicants for each row execute function px_private.queue_approval_sms();
create function px_private.sms_action(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare job px_private.sms_jobs; number text:=p->>'phone';
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501';end if;
 if action='claim' then
  update px_private.sms_jobs j set status='cancelled' where status='pending' and
   (exists(select 1 from px_private.sms_optouts o where o.phone=j.phone) or exists(select 1 from public.px_applicants a where a.id=j.applicant_id and (a.stage in ('rejected','withdrawn','inactive','approval_error') or a.details->>'sms_opt_in' is distinct from 'true')));
  select * into job from px_private.sms_jobs where status='pending' order by created_at for update skip locked limit 1;
  if job.id is null then return 'null';end if;
  update px_private.sms_jobs set status='review',attempted_at=now() where id=job.id;
  return jsonb_build_object('id',job.id,'phone',job.phone);
 elsif action in ('sent','review') then
  update px_private.sms_jobs set status=action,sent_at=case when action='sent' then now() else null end,provider_id=case when p->>'provider_id'~'^SM[A-Za-z0-9]{32}$' then p->>'provider_id' else null end where id=(p->>'id')::uuid and status='review';
 elsif action='stop' then
  if coalesce(number,'')!~'^\+[0-9]{11,15}$' then raise exception 'Invalid phone number.';end if;
  insert into px_private.sms_optouts(phone) values(number) on conflict do nothing;
  update px_private.sms_jobs set status='cancelled' where phone=number and status='pending';
 else raise exception 'Unknown SMS action.';end if;
 return '{}';
end$$;
revoke all on function px_private.queue_approval_sms(),px_private.sms_action(text,jsonb) from public,anon,authenticated;
grant execute on function px_private.sms_action(text,jsonb) to service_role;
create function public.px_sms(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.sms_action(action,p)$$;
revoke all on function public.px_sms(text,jsonb) from public,anon,authenticated;
grant execute on function public.px_sms(text,jsonb) to service_role;

-- Account deletion keeps attribution and immutable paid evidence while minimizing
-- contact information. Only the existing authorized, service-only deletion flow
-- can invoke this cleanup, after the Auth account has actually been removed.
alter function px_private.protected_history(uuid) rename to protected_history_before_manual;
create function px_private.protected_history(rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select px_private.protected_history_before_manual(rid) or exists(select 1 from public.px_sales_codes where rep_id=rid)
 or exists(select 1 from public.px_verified_sales where rep_id=rid) or exists(select 1 from public.px_manual_payouts where rep_id=rid)
$$;
alter function public.px_account_complete(jsonb) set schema px_private;
alter function px_private.px_account_complete(jsonb) rename to account_complete_before_manual;
revoke all on function px_private.account_complete_before_manual(jsonb),px_private.protected_history_before_manual(uuid) from public,anon,authenticated,service_role;
create function public.px_account_complete(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid:=(p->>'id')::uuid; result jsonb;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501';end if;
 if exists(select 1 from auth.users where id=rid) or not exists(select 1 from px_private.account_deletions where user_id=rid) then raise exception 'Authorized authentication removal must finish first.';end if;
 delete from public.px_payout_setup where rep_id=rid;
 update public.px_sales_codes set active=false,deactivated_at=coalesce(deactivated_at,now()) where rep_id=rid;
 delete from px_private.sms_jobs where applicant_id in (select id from public.px_applicants where rep_id=rid);
 result:=px_private.account_complete_before_manual(p);
 return result;
end$$;
revoke all on function public.px_account_complete(jsonb) from public,anon,authenticated;
grant execute on function public.px_account_complete(jsonb) to service_role;
