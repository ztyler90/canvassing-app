-- Managers/owners (and super-admins) must READ their org's operational data
-- to populate the dashboard. Postgres RLS = (any PERMISSIVE policy passes)
-- AND (every RESTRICTIVE policy passes); restrictive policies only narrow,
-- they never grant access. These tables had a single rep-owns-own PERMISSIVE
-- policy, so any non-rep (manager/owner/super-admin) matched no permissive
-- policy and saw ZERO rows — blanking the Overview (sessions), Bookings, and
-- Live/Map (gps_points, rep_locations) tabs. The interactions table already
-- had a same-org read policy, which is why only the Pipeline tab worked.
--
-- These additive SELECT policies grant same-org (and super-admin) reads. The
-- existing RESTRICTIVE tenant_isolation policy keeps every read org-scoped,
-- and the rep-owns-own policies are unchanged.

create policy "Org members can read same-org sessions"
  on public.canvassing_sessions for select
  using (organization_id = auth_organization_id() or auth_is_super_admin());

create policy "Org members can read same-org bookings"
  on public.bookings for select
  using (organization_id = auth_organization_id() or auth_is_super_admin());

create policy "Org members can read same-org gps points"
  on public.gps_points for select
  using (organization_id = auth_organization_id() or auth_is_super_admin());

create policy "Org members can read same-org rep locations"
  on public.rep_locations for select
  using (organization_id = auth_organization_id() or auth_is_super_admin());
