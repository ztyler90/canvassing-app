-- ============================================================
-- Shack Shine Canvassing App — Supabase Schema
-- Run this in your Supabase project: SQL Editor → New Query
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────
-- USERS (extends Supabase auth.users)
-- ─────────────────────────────────────────────
create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  phone       text unique not null,
  full_name   text,
  role        text not null default 'rep' check (role in ('rep', 'manager')),
  created_at  timestamptz default now()
);

alter table public.users enable row level security;

create policy "Users can read own profile"
  on public.users for select using (auth.uid() = id);

create policy "Managers can read all users"
  on public.users for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'manager')
  );

create policy "Users can update own profile"
  on public.users for update using (auth.uid() = id);

-- Auto-create user profile on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, phone, full_name)
  values (
    new.id,
    coalesce(new.phone, new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────
-- CANVASSING SESSIONS
-- ─────────────────────────────────────────────
create table public.canvassing_sessions (
  id              uuid primary key default uuid_generate_v4(),
  rep_id          uuid not null references public.users(id),
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  status          text not null default 'active' check (status in ('active', 'submitted', 'abandoned')),
  doors_knocked   integer default 0,
  conversations   integer default 0,
  estimates       integer default 0,
  bookings        integer default 0,
  revenue_booked  numeric(10,2) default 0,
  neighborhood    text,
  notes           text,
  created_at      timestamptz default now()
);

alter table public.canvassing_sessions enable row level security;

create policy "Reps can manage own sessions"
  on public.canvassing_sessions for all using (rep_id = auth.uid());

create policy "Managers can read all sessions"
  on public.canvassing_sessions for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'manager')
  );

-- ─────────────────────────────────────────────
-- GPS POINTS (breadcrumb trail)
-- ─────────────────────────────────────────────
create table public.gps_points (
  id          uuid primary key default uuid_generate_v4(),
  session_id  uuid not null references public.canvassing_sessions(id) on delete cascade,
  rep_id      uuid not null references public.users(id),
  lat         double precision not null,
  lng         double precision not null,
  accuracy    double precision,
  speed       double precision,
  recorded_at timestamptz not null default now()
);

alter table public.gps_points enable row level security;

create policy "Reps can insert own GPS points"
  on public.gps_points for insert with check (rep_id = auth.uid());

create policy "Reps can read own GPS points"
  on public.gps_points for select using (rep_id = auth.uid());

create policy "Managers can read all GPS points"
  on public.gps_points for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'manager')
  );

-- Index for fast session queries
create index idx_gps_points_session on public.gps_points(session_id, recorded_at);

-- ─────────────────────────────────────────────
-- INTERACTIONS (door results)
-- ─────────────────────────────────────────────
create table public.interactions (
  id              uuid primary key default uuid_generate_v4(),
  session_id      uuid not null references public.canvassing_sessions(id) on delete cascade,
  rep_id          uuid not null references public.users(id),
  address         text,
  lat             double precision,
  lng             double precision,
  outcome         text not null check (outcome in ('no_answer', 'not_interested', 'estimate_requested', 'booked')),
  -- Contact info (only for estimate/booked)
  contact_name    text,
  contact_phone   text,
  contact_email   text,
  service_types   text[],
  estimated_value numeric(10,2),
  notes           text,
  created_at      timestamptz not null default now()
);

alter table public.interactions enable row level security;

create policy "Reps can manage own interactions"
  on public.interactions for all using (rep_id = auth.uid());

create policy "Managers can read all interactions"
  on public.interactions for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'manager')
  );

create index idx_interactions_session on public.interactions(session_id);
create index idx_interactions_rep on public.interactions(rep_id, created_at);
create index idx_interactions_outcome on public.interactions(outcome);

-- ─────────────────────────────────────────────
-- BOOKINGS (revenue records)
-- ─────────────────────────────────────────────
create table public.bookings (
  id              uuid primary key default uuid_generate_v4(),
  interaction_id  uuid not null references public.interactions(id),
  session_id      uuid not null references public.canvassing_sessions(id),
  rep_id          uuid not null references public.users(id),
  address         text,
  contact_name    text,
  contact_phone   text,
  service_types   text[],
  estimated_value numeric(10,2),
  actual_value    numeric(10,2),             -- filled in after job completion
  status          text not null default 'booked' check (status in ('booked', 'completed', 'cancelled')),
  booked_at       timestamptz not null default now(),
  completed_at    timestamptz,
  -- Phase 2: external CRM reference
  external_job_id text,
  external_source text
);

alter table public.bookings enable row level security;

create policy "Reps can read own bookings"
  on public.bookings for select using (rep_id = auth.uid());

create policy "Managers can manage all bookings"
  on public.bookings for all using (
    exists (select 1 from public.users where id = auth.uid() and role = 'manager')
  );

-- ─────────────────────────────────────────────
-- HELPER VIEWS
-- ─────────────────────────────────────────────

-- Rep daily summary
create or replace view public.rep_daily_summary as
select
  cs.rep_id,
  u.full_name as rep_name,
  date_trunc('day', cs.started_at) as canvassing_date,
  count(distinct cs.id) as sessions,
  sum(cs.doors_knocked) as total_doors,
  sum(cs.conversations) as total_conversations,
  sum(cs.estimates) as total_estimates,
  sum(cs.bookings) as total_bookings,
  sum(cs.revenue_booked) as total_revenue,
  sum(extract(epoch from (coalesce(cs.ended_at, now()) - cs.started_at)) / 3600.0) as hours_canvassing,
  round(sum(cs.doors_knocked)::numeric /
    nullif(sum(extract(epoch from (coalesce(cs.ended_at, now()) - cs.started_at)) / 3600.0), 0), 1
  ) as doors_per_hour,
  round(sum(cs.revenue_booked) /
    nullif(sum(extract(epoch from (coalesce(cs.ended_at, now()) - cs.started_at)) / 3600.0), 0), 2
  ) as revenue_per_hour
from public.canvassing_sessions cs
join public.users u on u.id = cs.rep_id
where cs.status = 'submitted'
group by cs.rep_id, u.full_name, date_trunc('day', cs.started_at);

-- Neighborhood performance
create or replace view public.neighborhood_performance as
select
  neighborhood,
  count(distinct cs.rep_id) as unique_reps,
  count(distinct cs.id) as sessions,
  sum(cs.doors_knocked) as doors_knocked,
  sum(cs.bookings) as bookings,
  sum(cs.revenue_booked) as revenue,
  round(sum(cs.bookings)::numeric / nullif(sum(cs.doors_knocked), 0) * 100, 1) as booking_rate_pct,
  round(sum(cs.revenue_booked) / nullif(sum(cs.doors_knocked), 0), 2) as revenue_per_door
from public.canvassing_sessions cs
where cs.status = 'submitted' and cs.neighborhood is not null
group by neighborhood
order by revenue desc;

-- ─────────────────────────────────────────────
-- SEED: Create a test manager account
-- (update phone to your number, then sign in)
-- ─────────────────────────────────────────────
-- NOTE: Insert into auth.users via Supabase dashboard or Auth API.
-- Then run: update public.users set role = 'manager' where phone = '+1XXXXXXXXXX';