-- Team-wide coverage heatmap
-- ──────────────────────────
-- Lets reps read lat/lng/created_at for any interaction logged by a
-- teammate in the same organization. Prior to this migration, the only
-- permissive policies on `public.interactions` were:
--   • "Reps can manage own interactions"      (rep_id = auth.uid())
--   • "Managers can read all interactions"    (role = 'manager')
--
-- So the coverage heatmap could only show a rep's own knocks. Adding the
-- policy below as a *third* permissive SELECT policy expands read access
-- to same-org rows without weakening any existing guard — Postgres OR's
-- permissive policies, so rep-owned and manager-read rows stay visible
-- exactly as before.
--
-- Write/update/delete permissions are UNCHANGED: reps still can't
-- modify another rep's rows (the "manage own" policy scopes to their
-- own rep_id on those operations).

-- Idempotent: Postgres has no `create policy if not exists`, and this
-- migration may have been partially applied directly via SQL before it was
-- captured as a tracked migration. Drop-and-recreate is safe — the policy
-- has no dependents (no view or trigger references it), and its name is
-- unique to this feature.
drop policy if exists "Reps can read same-org interactions" on public.interactions;

create policy "Reps can read same-org interactions"
  on public.interactions
  for select
  using (
    exists (
      select 1 from public.users u
      where u.id = public.interactions.rep_id
        and u.organization_id is not null
        -- `(select auth.uid())` wraps the auth function in an InitPlan so it
        -- evaluates once per query instead of once per row. Raw `auth.uid()`
        -- inside the subquery triggers the auth_rls_initplan advisor warning
        -- and measurably slows SELECTs at scale.
        and u.organization_id = (
          select organization_id from public.users where id = (select auth.uid())
        )
    )
  );

-- Supporting index: the heatmap query filters by created_at desc across
-- every rep in an org, and joins interactions → users on rep_id. An
-- index on rep_id+created_at already exists (idx_interactions_rep); an
-- index on users.organization_id speeds up the RLS join.
create index if not exists idx_users_organization
  on public.users(organization_id);
