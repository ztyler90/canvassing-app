-- Pipeline / Territories performance: composite index on interactions.
--
-- The manager Pipeline and Territories tabs read the interactions table
-- scoped to the caller's org. The client now passes an explicit
-- organization_id filter (see getPipelineLeads / getAllDoorHistory etc.
-- in src/lib/supabase.js), which already lets the planner use
-- idx_interactions_organization instead of seq-scanning all orgs behind
-- RLS (the multi-second hang).
--
-- This composite index makes the kanban query
--   WHERE organization_id = $1 AND stage IN (...) ORDER BY created_at DESC
-- fully index-served end-to-end (org + stage narrowing AND the sort),
-- instead of a bitmap-AND + separate sort step.
--
-- CONCURRENTLY so the build does not lock writes on the live table.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block;
-- if your migration runner wraps statements in a txn, run this statement
-- on its own (it was applied to prod out-of-band via the dashboard).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interactions_org_stage_created
  ON public.interactions (organization_id, stage, created_at DESC);
