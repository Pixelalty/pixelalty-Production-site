-- Preserve the union of the existing self/team/admin and finance policies while
-- evaluating one permissive SELECT policy. Restrictive session/MFA policies stay.
alter policy reps_read on public.px_reps
  using (
    id = (select auth.uid())
    or px_private.team_scope(id)
    or (select px_private.has_role(array['sales_admin', 'support', 'finance_admin']))
  );

drop policy reps_finance_read on public.px_reps;
