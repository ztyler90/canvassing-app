-- Managers edit rep data from the dashboard: Session Detail "Edit Session
-- Totals" (UPDATE canvassing_sessions) and the pipeline LeadDetailModal —
-- advance stage, edit price/contact, reassign closer, mark lost (UPDATE
-- interactions). But the only permissive UPDATE policies on these tables were
-- "rep owns own" (rep_id = auth.uid()) and, for interactions, "closer owns
-- assigned". A manager editing a REP's row matched no permissive policy, so the
-- UPDATE touched 0 rows and `.update().select().single()` failed with
-- "Cannot coerce the result to a single JSON object". The RESTRICTIVE
-- tenant_isolation policy only narrows; it can't grant the write.
--
-- These additive UPDATE policies let a same-org manager (and super-admins)
-- edit sessions/interactions in their org. They use the SECURITY DEFINER
-- auth_is_manager() / auth_is_super_admin() helpers (which read users without
-- re-entering RLS), so there's no policy recursion. Reps' and closers' own-row
-- policies are unchanged. org scoping is enforced in both USING and WITH CHECK,
-- and the RESTRICTIVE tenant_isolation policy still applies on top.

create policy "Managers update same-org sessions"
  on public.canvassing_sessions for update
  using ((organization_id = auth_organization_id() and auth_is_manager()) or auth_is_super_admin())
  with check ((organization_id = auth_organization_id() and auth_is_manager()) or auth_is_super_admin());

create policy "Managers update same-org interactions"
  on public.interactions for update
  using ((organization_id = auth_organization_id() and auth_is_manager()) or auth_is_super_admin())
  with check ((organization_id = auth_organization_id() and auth_is_manager()) or auth_is_super_admin());
