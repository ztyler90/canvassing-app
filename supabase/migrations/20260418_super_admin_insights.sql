-- ============================================================
-- KnockIQ — Super-Admin insights
-- Lets the super-admin read cross-organization data for the
-- enhanced SuperAdminDashboard + OrganizationDetail screens.
-- ============================================================
--
-- CRITICAL: this migration uses a SECURITY DEFINER helper function
-- (is_current_user_super_admin) instead of an inline EXISTS subquery.
-- The naive "EXISTS (SELECT 1 FROM public.users …)" pattern recurses
-- through RLS on public.users, and stacking it on top of the existing
-- "Managers can read all users" policy (which is already recursive)
-- triggers "infinite recursion detected in policy for relation users".
-- That makes every client-side read of public.users fail — which breaks
-- AuthContext.buildProfile(), wipes user.is_super_admin, and hides the
-- shield icon in the manager header.
--
-- SECURITY DEFINER + `SET search_path = public` runs the function with
-- the owner's privileges (bypassing RLS) and no recursion.
-- ============================================================

-- ── 0. If the earlier recursive version of this migration was applied,
--       clean it up before adding the safe version. Safe to rerun. ───────
DROP POLICY IF EXISTS "Super admins read all users"         ON public.users;
DROP POLICY IF EXISTS "Super admins read all sessions"      ON public.canvassing_sessions;
DROP POLICY IF EXISTS "Super admins read all interactions"  ON public.interactions;
DROP POLICY IF EXISTS "Super admins read all rep_locations" ON public.rep_locations;

-- ── 1. Helper: is the current caller a super-admin? ──────────────────────
-- SECURITY DEFINER bypasses RLS on public.users inside the function body,
-- which is essential — the outer policy is attached TO public.users, so a
-- naive EXISTS would recurse. STABLE means the planner can cache per-txn.
CREATE OR REPLACE FUNCTION public.is_current_user_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid() AND is_super_admin = true
  );
$$;

-- Make sure the authenticated role can call it (service_role can always).
GRANT EXECUTE ON FUNCTION public.is_current_user_super_admin() TO authenticated;

-- ── 2. Cross-org SELECT policies, all delegating to the helper. ──────────
CREATE POLICY "Super admins read all users"
  ON public.users FOR SELECT
  USING (public.is_current_user_super_admin());

CREATE POLICY "Super admins read all sessions"
  ON public.canvassing_sessions FOR SELECT
  USING (public.is_current_user_super_admin());

CREATE POLICY "Super admins read all interactions"
  ON public.interactions FOR SELECT
  USING (public.is_current_user_super_admin());

CREATE POLICY "Super admins read all rep_locations"
  ON public.rep_locations FOR SELECT
  USING (public.is_current_user_super_admin());

-- ============================================================
-- Notes
--   * These policies are SELECT-only. Super-admins can already
--     update organizations.tier via the existing policy added in
--     the Phase 1 organizations migration.
--   * Existing rep/manager policies stay untouched — they continue
--     to work exactly as before for non-super-admin users.
--   * If you ever need to revoke super-admin cross-org read, drop
--     these four policies + the helper function.
-- ============================================================
