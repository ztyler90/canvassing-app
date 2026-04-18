-- ============================================================
-- KnockIQ — Super-Admin insights
-- Lets the super-admin read cross-organization data for the
-- enhanced SuperAdminDashboard + OrganizationDetail screens.
-- ============================================================
--
-- WITHOUT these policies the existing manager-scoped policies would
-- silently filter `users` and `canvassing_sessions` to the caller's
-- own org, making every other org look empty on the platform
-- dashboard. Super-admins need an explicit cross-org read gate.
--
-- The check is: caller exists in public.users with is_super_admin=true.
-- Same shape as every other manager-gated policy in this schema.
-- ============================================================

-- Cross-org read on users
DROP POLICY IF EXISTS "Super admins read all users" ON public.users;
CREATE POLICY "Super admins read all users"
  ON public.users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users sa
      WHERE sa.id = auth.uid() AND sa.is_super_admin = true
    )
  );

-- Cross-org read on canvassing sessions
DROP POLICY IF EXISTS "Super admins read all sessions" ON public.canvassing_sessions;
CREATE POLICY "Super admins read all sessions"
  ON public.canvassing_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users sa
      WHERE sa.id = auth.uid() AND sa.is_super_admin = true
    )
  );

-- Cross-org read on interactions
DROP POLICY IF EXISTS "Super admins read all interactions" ON public.interactions;
CREATE POLICY "Super admins read all interactions"
  ON public.interactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users sa
      WHERE sa.id = auth.uid() AND sa.is_super_admin = true
    )
  );

-- Cross-org read on rep_locations (live visibility)
DROP POLICY IF EXISTS "Super admins read all rep_locations" ON public.rep_locations;
CREATE POLICY "Super admins read all rep_locations"
  ON public.rep_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users sa
      WHERE sa.id = auth.uid() AND sa.is_super_admin = true
    )
  );

-- ============================================================
-- Notes
--   * These policies are SELECT-only. Super-admins can already
--     update organizations.tier via the existing policy added in
--     the Phase 1 organizations migration.
--   * Existing policies for reps/managers stay untouched.
-- ============================================================
