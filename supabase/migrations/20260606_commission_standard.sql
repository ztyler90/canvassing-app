-- ============================================================
-- KnockIQ — Commission tracking moves into the Standard package
--
-- Commission tracking is no longer a Pro-only add-on. It's part of the
-- Standard package, gated purely by the per-org `commission_enabled`
-- manager toggle (the app no longer checks tier). New signups default the
-- toggle ON so reps see their commission out of the box; managers can
-- still turn it off in Settings.
--
-- The base hourly rate ("total pay") component is removed product-wide.
-- We leave any historical `base_hourly_rate` values inside the existing
-- commission_config JSONB untouched — the app simply ignores them now.
--
-- Changes:
--   1. organizations.commission_enabled — flip column DEFAULT to true and
--      refresh the comment (no longer Pro-only).
--   2. provision_new_organization() — stamp commission_enabled = true on
--      new orgs, alongside the existing reverse-trial + billing_required
--      provisioning.
--
-- Everything here is additive/idempotent. Existing orgs keep their current
-- commission_enabled value; only the default for future inserts changes.
-- ============================================================

ALTER TABLE public.organizations
  ALTER COLUMN commission_enabled SET DEFAULT true;

COMMENT ON COLUMN public.organizations.commission_enabled IS
  'Standard feature, manager opt-in: when true, commission tracking is active '
  'for the org and reps see their commission. Defaults true for new signups.';

-- Recreate provisioning RPC so new orgs start with commission tracking on.
-- Matches 20260605_billing_required (Pro reverse trial, 14-day, selected_plan
-- intent, billing_required = true) plus commission_enabled = true.
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
  -- billing_required = true so the CompleteCheckout gate enforces card-up-front;
  -- commission_enabled = true so reps see their commission from day one.
  insert into public.organizations (name, slug, owner_user_id, tier, status, trial_ends_at, selected_plan, billing_required, commission_enabled)
    values (safe_name, safe_slug, caller_id, 'pro', 'trial', now() + interval '14 days', safe_plan, true, true)
    returning id into new_org_id;

  update public.users
    set organization_id = new_org_id,
        role            = 'manager'
    where id = caller_id;

  return new_org_id;
end;
$function$;
