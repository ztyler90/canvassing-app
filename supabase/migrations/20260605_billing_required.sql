-- ============================================================
-- KnockIQ — Card-up-front gating (billing_required)
-- ============================================================
-- The checkout flow collects a card at signup. To require it WITHOUT
-- locking out the orgs that signed up before checkout existed, we gate on
-- a per-org flag instead of "has no subscription":
--
--   billing_required = true  → must complete Stripe Checkout; the app's
--                              CompleteCheckout gate holds them until a
--                              subscription lands on the org.
--   billing_required = false → grandfathered (every org that exists today);
--                              never gated.
--
-- The column defaults to false so all existing rows are grandfathered on
-- add. provision_new_organization() is updated to stamp it TRUE for new
-- signups, so only orgs created from here on must pay up front.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS billing_required BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.billing_required IS
  'When true, the org must complete Stripe Checkout before using the app (card-up-front). '
  'Set true for orgs created after the checkout launch; false (grandfathered) for older orgs.';

-- Recreate the reverse-trial provisioning RPC so new orgs are flagged
-- billing_required = true. Everything else matches 20260605_reverse_trial_
-- provisioning (Pro tier, 14-day trial, selected_plan intent).
DROP FUNCTION IF EXISTS public.provision_new_organization(text, text);

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

  -- Reverse trial: full Pro for 14 days; selected_plan = post-trial intent;
  -- billing_required = true so the CompleteCheckout gate enforces card-up-front.
  insert into public.organizations (name, slug, owner_user_id, tier, status, trial_ends_at, selected_plan, billing_required)
    values (safe_name, safe_slug, caller_id, 'pro', 'trial', now() + interval '14 days', safe_plan, true)
    returning id into new_org_id;

  update public.users
    set organization_id = new_org_id,
        role            = 'manager'
    where id = caller_id;

  return new_org_id;
end;
$function$;
