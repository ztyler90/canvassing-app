-- ============================================================
-- KnockIQ — Organization lifecycle (pause / cancel / delete)
-- ============================================================
-- Door-knocking is seasonal, so a chunk of owners want to step away
-- for the off-season WITHOUT losing their territories, reps, pipeline,
-- and history. Before this migration the only "exit" was leaving the
-- account active (still billed) or having a super-admin flip the org —
-- there was no self-serve pause OR cancel, and no proper delete.
--
-- This adds the data model for four lifecycle states on
-- public.organizations.status (a free-text column today — note that the
-- super-admin MRR math in lib/supabase.js already treats 'paused' /
-- 'cancelled' / 'inactive' / 'churned' as "dead", so we're formalizing
-- a concept the analytics layer already assumes):
--
--   trial      (existing) — reverse Pro trial, 14 days
--   active     (existing) — paying
--   paused     (NEW)      — billing suspended to a low "keep-warm" fee,
--                           ALL data retained, auto-resumes on resume_at
--   cancelled  (NEW)      — billing stopped, soft-deleted, data kept
--                           through a 90-day grace window (purge_at) so
--                           seasonal owners can come back next season
--
-- Hard delete (auth + data teardown) is NOT a status — it's performed
-- by the manage-team edge function's `delete_org` action, owner-only.
--
-- We deliberately do NOT add a CHECK constraint on status: the column
-- has no constraint today (the only status CHECK in the schema is on
-- users.subscription_status), several values are already in live use,
-- and adding one risks rejecting an existing value we can't see from
-- migrations alone. The allowed set is documented here and enforced in
-- the edge function instead.
-- ============================================================

-- ── 1. Lifecycle columns on organizations ──────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS paused_at        TIMESTAMPTZ,
  -- resume_at: when a paused org automatically flips back to active.
  -- NULL while active/cancelled. The access gate compares now() against
  -- this so a paused org that's reached its resume date is treated as
  -- active even before the nightly reactivation job runs.
  ADD COLUMN IF NOT EXISTS resume_at        TIMESTAMPTZ,
  -- pause_fee_cents: the reduced "keep my data warm" charge applied while
  -- paused. Stored in cents to match Stripe. Default $5/mo. The Stripe
  -- pause wiring swaps the subscription to a flat keep-warm price built
  -- from this amount (see manage-team `pause_org`).
  ADD COLUMN IF NOT EXISTS pause_fee_cents  INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS cancelled_at     TIMESTAMPTZ,
  -- purge_at: cancelled_at + 90 days. The nightly purge job hard-deletes
  -- the org's data after this date. NULL unless cancelled.
  ADD COLUMN IF NOT EXISTS purge_at         TIMESTAMPTZ,
  -- lifecycle_reason: the free-text/why captured during the pause or
  -- cancel flow ("seasonal", "too_expensive", etc.). Drives win-back
  -- and churn-reason analytics.
  ADD COLUMN IF NOT EXISTS lifecycle_reason TEXT,
  -- pause_prev_price_id / pause_prev_quantity: snapshot of the org's normal
  -- per-seat Stripe subscription item BEFORE we swap it to the flat $5
  -- keep-warm price on pause. resume_org reads these to restore the exact
  -- plan + seat count. NULL when not paused / no Stripe subscription.
  ADD COLUMN IF NOT EXISTS pause_prev_price_id TEXT,
  ADD COLUMN IF NOT EXISTS pause_prev_quantity INTEGER;

COMMENT ON COLUMN public.organizations.status IS
  'Lifecycle state: trial | active | paused | cancelled (+ legacy inactive/churned). '
  'paused = billing suspended to keep-warm fee, data retained, auto-resumes on resume_at. '
  'cancelled = billing stopped, soft-deleted, purged after purge_at (90d).';

COMMENT ON COLUMN public.organizations.resume_at IS
  'When a paused org auto-reactivates. Compared against now() by the access gate and the nightly reactivation job.';
COMMENT ON COLUMN public.organizations.purge_at IS
  'cancelled_at + 90 days. Nightly job hard-deletes the org data after this.';

-- ── 2. Lifecycle audit log ──────────────────────────────────────────────
-- Billing-adjacent state changes need a paper trail (disputes, support,
-- "why did my account get cancelled"). One row per transition.
CREATE TABLE IF NOT EXISTS public.org_lifecycle_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- event: paused | resumed | reactivated | cancelled | deleted
  event           TEXT NOT NULL,
  reason          TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_lifecycle_events_org_idx
  ON public.org_lifecycle_events (organization_id, created_at DESC);

ALTER TABLE public.org_lifecycle_events ENABLE ROW LEVEL SECURITY;

-- Owners/managers can read their own org's lifecycle history. Writes go
-- through the manage-team edge function (service role, bypasses RLS), so
-- there's intentionally no client INSERT policy.
DROP POLICY IF EXISTS org_lifecycle_events_select ON public.org_lifecycle_events;
CREATE POLICY org_lifecycle_events_select
  ON public.org_lifecycle_events FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.users
      WHERE id = auth.uid() AND role = 'manager'
    )
  );

-- ── 3. Nightly auto-reactivation of paused orgs ─────────────────────────
-- Flips paused orgs back to active once they hit resume_at. The access
-- gate already treats "paused but past resume_at" as active in real time,
-- so this is the durable backstop that fixes up the stored status (and is
-- where the Stripe "un-pause collection" call goes once billing is wired).
CREATE OR REPLACE FUNCTION public.reactivate_due_organizations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n INTEGER;
BEGIN
  WITH due AS (
    UPDATE public.organizations
       SET status    = 'active',
           paused_at = NULL,
           resume_at = NULL
     WHERE status = 'paused'
       AND resume_at IS NOT NULL
       AND resume_at <= now()
     RETURNING id
  )
  INSERT INTO public.org_lifecycle_events (organization_id, event, reason)
  SELECT id, 'reactivated', 'auto-resume reached' FROM due;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ── 4. Nightly hard-purge of expired cancelled orgs ─────────────────────
-- After the 90-day grace window, a cancelled org's data is destroyed.
-- We delete per-org inside a loop with a per-org exception guard so one
-- bad row can't abort the whole batch. We delete the org's member rows
-- first, then the org (child tables that reference organization_id with
-- ON DELETE CASCADE go with it).
--
-- NOTE: this purges PUBLIC-schema data only. The corresponding auth.users
-- rows for purged members are left for a scheduled edge function to sweep
-- (the SQL layer can't reliably reach auth.admin). The owner-initiated
-- `delete_org` edge action DOES clean up auth immediately; this nightly
-- job is the unattended 90-day backstop. TODO: pair with an edge-function
-- auth sweep keyed off org_lifecycle_events(event='deleted').
CREATE OR REPLACE FUNCTION public.purge_cancelled_organizations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  org RECORD;
  purged INTEGER := 0;
BEGIN
  FOR org IN
    SELECT id FROM public.organizations
     WHERE status = 'cancelled'
       AND purge_at IS NOT NULL
       AND purge_at <= now()
  LOOP
    BEGIN
      -- Record the teardown BEFORE we delete the org (the FK cascade on
      -- org_lifecycle_events would otherwise take this row with it).
      INSERT INTO public.org_lifecycle_events (organization_id, event, reason)
        VALUES (org.id, 'deleted', 'auto-purge: 90-day grace elapsed');

      DELETE FROM public.users WHERE organization_id = org.id;
      DELETE FROM public.organizations WHERE id = org.id;
      purged := purged + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Leave the org for the next run / manual review; don't abort.
      RAISE WARNING 'purge_cancelled_organizations: skipped org % (%)', org.id, SQLERRM;
    END;
  END LOOP;
  RETURN purged;
END;
$$;

-- ── 5. Schedule both via pg_cron (if available) ─────────────────────────
-- Mirrors the guard used by the data-retention purge migration. On plans
-- without pg_cron, call these from a scheduled Supabase Edge Function.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Reactivate paused orgs that reached their resume date — 03:05 UTC.
    PERFORM cron.schedule(
      'reactivate-due-organizations',
      '5 3 * * *',
      $cron$SELECT public.reactivate_due_organizations();$cron$
    );
    -- Purge cancelled orgs past their 90-day grace — 03:25 UTC (after the
    -- 03:15 data-retention purge).
    PERFORM cron.schedule(
      'purge-cancelled-organizations',
      '25 3 * * *',
      $cron$SELECT public.purge_cancelled_organizations();$cron$
    );
  END IF;
END;
$$;
