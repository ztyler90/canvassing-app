-- Same RLS gap as the dashboard tables: these three had a RESTRICTIVE
-- tenant_isolation policy plus only INSERT/DELETE permissive policies, and
-- NO permissive SELECT policy. Net effect: client-side reads returned zero
-- rows for EVERYONE (reps included), because RLS grants a row only when some
-- permissive policy passes.
--
-- Symptoms this fixes:
--   • do_not_knock          — getDoNotKnockList() always empty; reps could
--                             knock addresses already on the DNC list.
--   • territory_assignments — territories embed returns empty assignment
--                             arrays, so "assigned to me" / assignee names
--                             never render on the Territories tab or rep inbox.
--   • territory_completions — reps' "zone done" badges never appear; the
--                             per-rep .eq('rep_id', ...) read returned nothing.
--
-- Additive same-org SELECT grants. The existing RESTRICTIVE tenant_isolation
-- policy keeps every read org-scoped; INSERT/DELETE owner/rep policies are
-- unchanged.

create policy "Org members can read same-org do_not_knock"
  on public.do_not_knock for select
  using (organization_id = auth_organization_id() or auth_is_super_admin());

create policy "Org members can read same-org territory_assignments"
  on public.territory_assignments for select
  using (organization_id = auth_organization_id() or auth_is_super_admin());

create policy "Org members can read same-org territory_completions"
  on public.territory_completions for select
  using (organization_id = auth_organization_id() or auth_is_super_admin());
