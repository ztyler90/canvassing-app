-- Territories: org-wide visibility + optional category tag
-- ─────────────────────────────────────────────────────────
-- Two changes ship together because they support a single product change:
-- "when a manager draws a zone, every rep in the org sees it; assignment
-- becomes a priority flag rather than an access gate."
--
-- 1. category (text, nullable): an optional tag surfaced in the rep's
--    territory inbox ("Shack Shine", "Lawn care", etc.). No date attached —
--    a zone is a durable region, not a one-off task.
--
-- 2. RLS: previously the only rep read-path into `territories` was through
--    `territory_assignments` (an assignment row implied the rep could
--    dereference `.territories (*)` in a join). That meant an unassigned
--    rep's `getTerritories()` returned [], even though the manager expected
--    "everyone sees this zone." This migration adds a same-org SELECT
--    policy so any authenticated member of the org can read its zones.
--    Manager-only write policies are left alone.

-- ── 1. Schema: optional category tag ─────────────────────────────────────
alter table public.territories
  add column if not exists category text;

-- Fast filter when the rep's inbox groups zones by category.
create index if not exists idx_territories_category
  on public.territories(organization_id, category);

-- ── 2. RLS: same-org reps can read territories ───────────────────────────
-- Drop-and-recreate so the migration is idempotent (re-running it won't
-- fail on a pre-existing policy name). No dependents, safe to recycle.
drop policy if exists "Same-org can read territories" on public.territories;

create policy "Same-org can read territories"
  on public.territories
  for select
  using (
    -- `(select auth.uid())` wraps the auth call in an InitPlan so it
    -- evaluates once per query instead of once per row — same shape used
    -- by the interactions policy in 20260419_team_coverage_rls.sql.
    organization_id = (
      select organization_id from public.users where id = (select auth.uid())
    )
  );

-- territory_assignments: reps need to read their own assignments to know
-- which zones are flagged as priority. Managers already have a
-- "manage all" policy; this adds a narrow read path for reps.
drop policy if exists "Reps can read own territory assignments" on public.territory_assignments;

create policy "Reps can read own territory assignments"
  on public.territory_assignments
  for select
  using (
    rep_id = (select auth.uid())
    or exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role = 'manager'
    )
  );
