-- Organization services — manager-configurable list of offerings
-- ──────────────────────────────────────────────────────────────────
-- Each row is one service a company sells (e.g. "Window Cleaning",
-- "HVAC Tune-Up", "Solar Consultation"). Reps pick from this list
-- when booking a job, replacing the previously-hardcoded exterior-
-- cleaning defaults baked into InteractionModal.jsx.
--
-- Design notes:
--   • Org-scoped — every service belongs to exactly one organization
--     and is invisible to other tenants via the standard tenant_isolation
--     RESTRICTIVE policy (same shape as territory_completions, etc.).
--   • sort_order lets managers control display order in the rep app.
--     We default to 0 and treat ties as alphabetical at the query layer.
--   • label is unique per org (case-insensitive) to keep the chip list
--     clean and prevent rep-side duplicates like "Window Cleaning" vs
--     "window cleaning".
--   • No seed data — per product decision, existing orgs start empty
--     and the manager must add services before reps see chips. This
--     keeps the UX consistent for orgs in industries (insurance, solar,
--     pest control, etc.) where the old defaults made no sense.

-- ── 1. Table ─────────────────────────────────────────────────────────────
create table if not exists public.organization_services (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  label           text        not null check (length(trim(label)) > 0),
  sort_order      integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Case-insensitive uniqueness per org. A manager who tries to add
-- "Window Cleaning" twice (or "WINDOW CLEANING") hits a clean unique-
-- violation that the UI can map to a friendly inline error.
create unique index if not exists ux_org_services_org_label_ci
  on public.organization_services (organization_id, lower(label));

-- Query pattern is "all services for the caller's org, ordered for
-- display". Composite index covers that exact access path.
create index if not exists idx_org_services_org_sort
  on public.organization_services (organization_id, sort_order, label);

-- Keep updated_at fresh on label/sort_order changes so the manager UI
-- can show "last edited" if we want to surface it later.
create or replace function public.touch_organization_services_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_organization_services_touch on public.organization_services;
create trigger trg_organization_services_touch
  before update on public.organization_services
  for each row execute procedure public.touch_organization_services_updated_at();

-- ── 2. RLS ───────────────────────────────────────────────────────────────
alter table public.organization_services enable row level security;
alter table public.organization_services force row level security;

-- Tenant isolation — identical shape to the rest of the schema.
-- `auth_organization_id()` returns the caller's org; `auth_is_super_admin()`
-- is the escape hatch for internal support tooling.
drop policy if exists tenant_isolation on public.organization_services;
create policy tenant_isolation
  on public.organization_services
  as restrictive
  for all
  using       (organization_id = auth_organization_id() or auth_is_super_admin())
  with check  (organization_id = auth_organization_id() or auth_is_super_admin());

-- SELECT: everyone in the org (reps and managers) reads the list.
-- Reps need it to render service chips in the booking modal; managers
-- need it to populate the Settings editor.
drop policy if exists "Org members read services" on public.organization_services;
create policy "Org members read services"
  on public.organization_services
  for select
  using (
    organization_id = (
      select organization_id from public.users where id = (select auth.uid())
    )
  );

-- INSERT / UPDATE / DELETE: managers only. Reps can read but not
-- modify — service definition is a manager responsibility (and a
-- billing/reporting concern we don't want field reps editing).
drop policy if exists "Managers manage services" on public.organization_services;
create policy "Managers manage services"
  on public.organization_services
  for all
  using (
    exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role = 'manager'
        and u.organization_id = public.organization_services.organization_id
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role = 'manager'
        and u.organization_id = public.organization_services.organization_id
    )
  );
