-- ============================================================
-- KnockIQ — Reverse-trial provisioning
--
-- New orgs start on the Pro tier for a 14-day trial (a "reverse trial"),
-- so every signup experiences the full product during the trial. We store
-- `selected_plan` — the plan they clicked on the pricing page — so the
-- Stripe phase can convert/downgrade them to the right plan at trial end.
--
-- Changes:
--   1. organizations.selected_plan ('standard' | 'pro', default 'standard')
--   2. provision_new_organization(business_name, selected_plan default 'standard')
--      now provisions tier='pro', status='trial', 14-day trial, + selected_plan.
--
-- The trial length moves from 30 → 14 days to match the pricing page.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS selected_plan TEXT NOT NULL DEFAULT 'standard'
    CHECK (selected_plan IN ('standard', 'pro'));

COMMENT ON COLUMN public.organizations.selected_plan IS
  'Plan the org intends to convert to after the reverse (Pro) trial: standard | pro.';

DROP FUNCTION IF EXISTS public.provision_new_organization(text);

CREATE OR REPLACE FUNCTION public.provision_new_organization(
  business_name text,
  selected_plan text DEFAULT 'standard'
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
declare
  caller_id uuid := auth.uid();
  existing_org uuid;
  new_org_id uuid;
  safe_name text := nullif(btrim(business_name), '');
  safe_slug text;
  safe_plan text := case when lower(coalesce(selected_plan, 'standard')) = 'pro' then 'pro' else 'standard' end;
begin
  if caller_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if safe_name is null then
    raise exception 'business_name is required' using errcode = '22023';
  end if;

  select organization_id into existing_org from public.users where id = caller_id;
  if existing_org is not null then
    return existing_org;
  end if;

  safe_slug := regexp_replace(lower(safe_name), '[^a-z0-9]+', '-', 'g');
  safe_slug := btrim(safe_slug, '-');
  if safe_slug = '' then safe_slug := 'org'; end if;
  safe_slug := safe_slug || '-' || substr(md5(random()::text), 1, 6);

  -- Reverse trial: full Pro for 14 days; selected_plan = post-trial intent.
  insert into public.organizations (name, slug, owner_user_id, tier, status, trial_ends_at, selected_plan)
    values (safe_name, safe_slug, caller_id, 'pro', 'trial', now() + interval '14 days', safe_plan)
    returning id into new_org_id;

  update public.users
    set organization_id = new_org_id,
        role            = 'manager'
    where id = caller_id;

  return new_org_id;
end;
$function$;
