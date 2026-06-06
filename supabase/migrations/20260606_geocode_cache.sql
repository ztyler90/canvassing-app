-- Persistent geocode cache. Populated by the `geocode` Edge Function so a
-- door resolved once (by any rep, ever) is reused for free on later visits.
-- Keyed by coordinate snapped to 5 decimals (~1.1 m); reads use a small
-- bounding box for nearest-within-radius reuse. RLS on with no policies →
-- only the Edge Function (service_role, bypasses RLS) can touch it.
create table if not exists public.geocode_cache (
  gkey              text primary key,            -- "lat5,lng5" snapped key
  lat               double precision not null,
  lng               double precision not null,
  formatted_address text,
  candidates        jsonb not null default '[]'::jsonb,
  source            text  not null default 'google',  -- google | osm | nominatim
  precise           boolean not null default false,
  hits              integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists geocode_cache_bbox on public.geocode_cache (lat, lng);
alter table public.geocode_cache enable row level security;
