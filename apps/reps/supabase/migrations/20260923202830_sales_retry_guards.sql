-- Persist attempts before provider calls so a retry after Stripe's idempotency
-- retention window cannot silently create another checkout or reversal.
alter table public.px_deals add column checkout_started_at timestamptz;
create table public.px_reversal_requests(id uuid primary key,commission_id uuid not null references public.px_commissions(id),amount_cents int not null check(amount_cents>0),reason text not null,status text not null default 'pending' check(status in ('pending','complete')),reversal_id text unique,created_at timestamptz not null default now());
alter table public.px_reversal_requests enable row level security;
revoke all on public.px_reversal_requests from anon,authenticated;
grant select on public.px_reversal_requests to authenticated;
grant all on public.px_reversal_requests to service_role;
create policy reversal_requests_finance on public.px_reversal_requests for select to authenticated using(px_private.has_role(array['finance_admin']));
create index px_reversal_requests_commission on public.px_reversal_requests(commission_id);
create function px_private.service_guard(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare deal public.px_deals;comm public.px_commissions;request public.px_reversal_requests;result jsonb;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501';end if;
 if action='checkout_begin' then
  select * into deal from public.px_deals where id=(p->>'deal_id')::uuid for update;
  if deal.id is null or deal.rep_id::text<>p->>'rep_id' or deal.stage in ('paid','cancelled') then raise exception 'Checkout is not available.';end if;
  if deal.checkout_id is null and deal.checkout_started_at<now()-interval '23 hours' then raise exception 'Reconcile the previous Stripe checkout attempt before creating another.';end if;
  update public.px_deals set checkout_started_at=coalesce(checkout_started_at,now()) where id=deal.id returning * into deal;
  return to_jsonb(deal);
 elsif action='reversal_begin' then
  select * into comm from public.px_commissions where id=(p->>'commission_id')::uuid for update;
  if comm.id is null or comm.transfer_id is null then raise exception 'A recorded transfer is required.';end if;
  select * into request from public.px_reversal_requests where id=(p->>'request_id')::uuid;
  if request.id is not null then
   if request.commission_id<>comm.id or request.amount_cents<>(p->>'amount_cents')::int then raise exception 'Reversal request cannot be changed.';end if;
   if request.status='pending' and request.created_at<now()-interval '23 hours' then raise exception 'Reconcile the previous Stripe reversal before retrying.';end if;
   return to_jsonb(request);
  end if;
  if (p->>'amount_cents')::int<=0 or (p->>'amount_cents')::int+comm.reversed_cents+coalesce((select sum(amount_cents) from public.px_reversal_requests where commission_id=comm.id and status='pending'),0)>comm.amount_cents then raise exception 'Reversal exceeds the unreserved transfer amount.';end if;
  insert into public.px_reversal_requests(id,commission_id,amount_cents,reason) values((p->>'request_id')::uuid,comm.id,(p->>'amount_cents')::int,p->>'reason') returning * into request;return to_jsonb(request);
 else
  result:=px_private.service(action,p);
  if action='reversal' and p->>'request_id' is not null then update public.px_reversal_requests set status='complete',reversal_id=p->>'reversal_id' where id=(p->>'request_id')::uuid and amount_cents=(p->>'amount_cents')::int and commission_id in (select id from public.px_commissions where transfer_id=p->>'transfer_id');end if;
  return result;
 end if;
end $$;
grant execute on function px_private.service_guard(text,jsonb) to service_role;
create or replace function public.px_service(action text,p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select px_private.service_guard(action,p)$$;
