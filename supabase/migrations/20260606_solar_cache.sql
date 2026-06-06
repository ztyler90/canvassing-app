-- Persistent roof-insights cache (Google Solar · Building Insights).
-- Populated by the `solar` Edge Function so a roof resolved once (by any rep,
-- ever) is reused for free on later visits. Roof geometry is static per
-- building, so unlike geocoding this never needs refreshing — a hit is good
-- forever. Keyed by coordinate snapped to 5 decimals (~1.1 m); reads use a
-- small bounding box for nearest-within-radius reuse.
--
-- `found = false` rows are negative-cache entries: Solar coverage is partial
-- (rural / new construction return 404), so we remember a miss too and never
-- re-bill Google for an address we already know has no data.
--
-- RLS on with NO policies → only the Edge Function (service_role, which
-- bypasses RLS) can read or write. Clients never touch this table directly;
-- they call the function, which is Pro-gated in the app layer.
create table if not exists public.solar_cache (
  gkey             text primary key,            -- "lat5,lng5" snapped key
  lat              double precision not null,
  lng              double precision not null,
  found            boolean not null default false,
  insights         jsonb,                       -- parsed, rep-friendly insight object
  imagery_date     text,                        -- Google imagery capture date (year-month)
  quality          text,                        -- HIGH | MEDIUM | LOW (Google data quality)
  google_requests  integer not null default 0,  -- billable Building Insights calls made
  hits             integer not null default 0,  -- cache reuse counter (cost tracking)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists solar_cache_bbox on public.solar_cache (lat, lng);

alter table public.solar_cache enable row level security;
