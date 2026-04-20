-- Territory completions — per-rep "I'm done with this zone" state
-- ────────────────────────────────────────────────────────────────
-- Each row is a rep's claim that they've finished canvassing a
-- specific zone. Completion is rep-scoped (rep A marking "done"
-- doesn't hide the zone from rep B) and reversible (delete the row
-- to un-mark). The unique (territory_id, rep_id) constraint means
-- toggling is a simple upsert/delete.
--
-- We stamp organization_id so the RESTRICTIVE tenant_isolation
-- policy shared across the schema can enforce cross-tenant
-- leak-prevention without a join.

-- ── 1. Table ─────────────────────────────────────────────────────────────
create table if not exists public.territory_completions (
  id              uuid        primary key default gen_random_uuid(),
  territory_id    uuid        not null references public.territories(id)   on delete cascade,
  rep_id          uuid        not null references public.users(id)         on delete cascade,
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  completed_at    timestamptz not null default now(),
  unique (territory_id, rep_id)
);

create index if not exists idx_territory_completions_rep
  on public.territory_completions(rep_id, completed_at desc);

create index if not exists idx_territory_completions_territory
  on public.territory_completions(territory_id);

-- ── 2. RLS ───────────────────────────────────────────────────────────────
alter table public.territory_completions enable row level security;
alter table public.territory_completions force row level security;

-- RESTRICTIVE tenant isolation — identical shape to the other tables.
-- `auth_organization_id()` returns the caller's org; `auth_is_super_admin()`
-- is the escape hatch for internal support tooling.
drop policy if exists tenant_isolation on public.territory_completions;
create policy tenant_isolation
  on public.territory_completions
  as restrictive
  for all
  using       (organization_id = auth_organization_id() or auth_is_super_admin())
  with check  (organization_id = auth_organization_id() or auth_is_super_admin());

-- SELECT: a rep sees their own completions; a manager sees every
-- rep's completions in the org (for future "team coverage" views).
drop policy if exists "Read own or manager reads all completions" on public.territory_completions;
create policy "Read own or manager reads all completions"
  on public.territory_completions
  for select
  using (
    rep_id = (select auth.uid())
    or exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role = 'manager'
    )
  );

-- INSERT: a rep can only mark *themselves* as having completed a
-- zone. The tenant_isolation check handles organization scoping;
-- this check enforces that rep_id can't be spoofed.
drop policy if exists "Reps mark own completions" on public.territory_completions;
create policy "Reps mark own completions"
  on public.territory_completions
  for insert
  with check (rep_id = (select auth.uid()));

-- DELETE: un-mark is also rep-owned (plus managers can clean up on
-- behalf of the team if the "completed by mistake" scenario ever
-- needs manual intervention).
drop policy if exists "Reps unmark own completions" on public.territory_completions;
create policy "Reps unmark own completions"
  on public.territory_completions
  for delete
  using (
    rep_id = (select auth.uid())
    or exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role = 'manager'
    )
  );
