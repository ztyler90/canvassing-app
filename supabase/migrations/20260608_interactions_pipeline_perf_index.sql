-- Pipeline / Territories performance on the interactions table.
--
-- Applied to prod 2026-06-09 (recorded migration:
-- 20260609020243_interactions_select_rls_index_friendly). This file is the
-- repo-tracked, transaction-safe + idempotent form of that change.
--
-- Two parts:
--
-- 1. Composite index so org-scoped pipeline reads
--      WHERE organization_id = $1 AND stage IN (...) ORDER BY created_at DESC
--    are fully index-served (org + stage narrowing AND the sort).
--    NOTE: on prod this index was first built with CREATE INDEX CONCURRENTLY
--    (no write lock). Here it is plain + IF NOT EXISTS so it is a safe no-op
--    if this migration is ever replayed inside a transaction.
--
-- 2. Replace the per-row correlated-subquery SELECT policy with an
--    index-friendly equivalent. The RESTRICTIVE tenant_isolation policy
--    already AND-gates every row to
--      (organization_id = auth_organization_id() OR auth_is_super_admin()).
--    The PERMISSIVE "Reps can read same-org interactions" policy is what
--    grants the broad org-wide read used by managers/reps, but it did so via
--    an EXISTS over users that re-derived the caller's org for EVERY row — a
--    SubPlan in every interactions SELECT, app-wide.
--
--    Verified equivalent before applying: 0 of 32,698 rows had
--    organization_id <> the rep's organization_id, so
--      (rep's org = caller's org)  <=>  (interactions.organization_id = caller's org).
--    Post-change verification: manager and same-org rep still see exactly
--    their org's rows; a different-org rep sees 0 of this org's rows.

CREATE INDEX IF NOT EXISTS idx_interactions_org_stage_created
  ON public.interactions (organization_id, stage, created_at DESC);

DROP POLICY IF EXISTS "Reps can read same-org interactions" ON public.interactions;
DROP POLICY IF EXISTS "Org members read same-org interactions" ON public.interactions;

CREATE POLICY "Org members read same-org interactions"
  ON public.interactions
  FOR SELECT
  USING (organization_id = auth_organization_id());
