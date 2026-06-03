-- ============================================================
-- Two pipeline-blocker fixes
--
-- 1. interactions.updated_at — the client (updateInteraction in
--    supabase.js) has been writing updated_at on every patch since the
--    pipeline rework, but the column never existed. PostgREST surfaced
--    this as "Could not find the 'updated_at' column of 'interactions'
--    in the schema cache" and the booking write failed.
--
--    Fix: add the column with a now() default + a BEFORE UPDATE trigger
--    that bumps it on every change, so the audit value stays honest
--    regardless of whether the caller sets it explicitly.
--
-- 2. RLS — interactions has UPDATE policies for reps (own rows) and
--    closers (assigned rows), but NO manager UPDATE policy. So when a
--    manager tried to reassign a closer or change an appointment time
--    from LeadDetailModal, PostgREST silently rejected the row, the
--    update touched 0 rows, and the post-update .select().single()
--    threw "Cannot coerce the result to a single JSON object".
--
--    Fix: add a manager UPDATE policy scoped by role + the existing
--    tenant_isolation restrictive policy (which still enforces same-
--    org scoping, so this isn't a cross-tenant escalation).
-- ============================================================

-- ── 1. interactions.updated_at column + auto-bump trigger ──────────────────
alter table public.interactions
  add column if not exists updated_at timestamptz not null default now();

update public.interactions
  set updated_at = created_at
  where updated_at = created_at
     or updated_at is null;

create or replace function public.interactions_bump_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists interactions_bump_updated_at_trg on public.interactions;
create trigger interactions_bump_updated_at_trg
  before update on public.interactions
  for each row execute function public.interactions_bump_updated_at();

-- ── 2. Manager UPDATE policy on interactions ───────────────────────────────
drop policy if exists "Managers can update interactions in their org"
  on public.interactions;
create policy "Managers can update interactions in their org"
  on public.interactions for update
  using (
    exists (
      select 1 from public.users me
      where me.id = auth.uid() and me.role = 'manager'
    )
  )
  with check (
    exists (
      select 1 from public.users me
      where me.id = auth.uid() and me.role = 'manager'
    )
  );
