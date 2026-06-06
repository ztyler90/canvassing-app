-- Geocoding spend tracking + super-admin readout.
alter table public.geocode_cache add column if not exists google_requests integer not null default 0;

-- Super-admin-only spend summary for the current calendar month.
create or replace function public.geocode_spend_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  month_start timestamptz := date_trunc('month', now());
  reqs        bigint;
  new_rows    bigint;
  total_rows  bigint;
  total_hits  bigint;
begin
  if not public.is_current_user_super_admin() then
    raise exception 'not authorized';
  end if;

  select coalesce(sum(google_requests),0), count(*)
    into reqs, new_rows
    from public.geocode_cache
   where created_at >= month_start and source = 'google';

  select count(*), coalesce(sum(hits),0)
    into total_rows, total_hits
    from public.geocode_cache;

  return jsonb_build_object(
    'month_start',            month_start,
    'google_requests_mtd',    reqs,
    'free_tier',              10000,
    'billable_requests',      greatest(0, reqs - 10000),
    'est_cost_usd',           round(greatest(0, reqs - 10000)::numeric / 1000 * 5.0, 2),
    'new_addresses_mtd',      new_rows,
    'cached_addresses_total', total_rows,
    'lifetime_cache_hits',    total_hits
  );
end;
$$;

revoke execute on function public.geocode_spend_summary() from public, anon;
grant  execute on function public.geocode_spend_summary() to authenticated;
