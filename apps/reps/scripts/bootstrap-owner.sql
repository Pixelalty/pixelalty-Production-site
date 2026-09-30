-- Run only in the selected project's SQL editor after migrations.
-- First run: select set_config('px.owner_user_id', 'THE_CONFIRMED_AUTH_USER_UUID', false);
-- Use an existing verified Auth user's UUID. This creates no user or invitation.
do $$
declare selected_user uuid := nullif(current_setting('px.owner_user_id', true), '')::uuid;
begin
  if selected_user is null then
    raise exception 'Set px.owner_user_id to the intended confirmed Auth user UUID first.';
  end if;
  if not exists(select 1 from auth.users where id=selected_user and email_confirmed_at is not null) then
    raise exception 'The selected Auth user must exist and have a confirmed email.';
  end if;
  insert into public.px_roles(user_id, role) values(selected_user, 'owner') on conflict do nothing;
  insert into public.px_audit(actor_id, action, target_id, reason)
  values(selected_user, 'owner_bootstrap', selected_user::text, 'Explicit account-owner bootstrap through database administration');
end $$;
