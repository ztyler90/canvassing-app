-- ============================================================
-- Pipeline · Phase 1 — schema for the Pipeline tab rebuild
--
-- Adds the data foundation for the new Pipeline (formerly Bookings)
-- experience. Everything in this migration is additive and idempotent;
-- it does NOT touch the existing `outcome` column on interactions, so
-- the current canvassing flow keeps working unchanged until the
-- canvasser-side updates land in Phase 3.
--
-- Touched objects:
--   1. organizations          + sales_cycle, lead_routing_mode,
--                               quote_followup_hours, hot_lead_stale_days
--   2. users                  + closer role, closer_notification_pref
--   3. interactions           + stage, appointment_at, estimate_sent_at,
--                               closer_id, lost_reason, lost_reason_notes,
--                               lost_at, hot_lead_started_at
--   4. RLS policies           + closer can read/update own assigned leads
--
-- Out of scope (Phase 2 / 3 / 4):
--   • Closer Inbox screen + invite flow
--   • Canvassing flow updates to populate appointment_at / closer_id
--   • Pipeline tab rebuild on top of these fields
-- ============================================================

-- ── 1. organizations.sales_cycle ──────────────────────────────────────────
-- 'mixed' is the safe default: shows all four kanban columns and lets the
-- rep pick whether each deal needs an appt. Manager opts into the more
-- opinionated 'appointment_based' or 'quick_quote' modes in Pipeline
-- Settings once they know which fits.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS sales_cycle TEXT
    NOT NULL DEFAULT 'mixed'
    CHECK (sales_cycle IN ('appointment_based', 'quick_quote', 'mixed'));

-- ── 2. organizations.lead_routing_mode ────────────────────────────────────
-- Drives the closer-assignment UI in the canvassing flow. Default
-- 'manager_assigns' is the lowest-friction option for orgs with no closers
-- configured yet: setter logs the appt unassigned, manager dispatches
-- later from the Pipeline tab.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS lead_routing_mode TEXT
    NOT NULL DEFAULT 'manager_assigns'
    CHECK (lead_routing_mode IN (
      'setter_picks',
      'round_robin',
      'manager_assigns',
      'territory_based'
    ));

-- ── 3. organizations.quote_followup_hours ─────────────────────────────────
-- For quick-quote orgs: how many hours after a Hot Lead is logged should
-- the rep follow up with a quote. Drives the "follow-up overdue" trigger
-- in the action queue. Default 24 = next business day.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS quote_followup_hours INTEGER
    NOT NULL DEFAULT 24
    CHECK (quote_followup_hours BETWEEN 1 AND 240);

-- ── 4. organizations.hot_lead_stale_days ──────────────────────────────────
-- How long a Hot Lead can sit in the first kanban column with no activity
-- before it auto-graduates to Closed — Stale. 14 days matches the design
-- discussion; manager can dial it tighter or looser per their cycle.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS hot_lead_stale_days INTEGER
    NOT NULL DEFAULT 14
    CHECK (hot_lead_stale_days BETWEEN 1 AND 90);

-- ── 5. users.role · add 'closer' ──────────────────────────────────────────
-- Drop and re-add the CHECK with the new value. Existing rows untouched
-- (no 'closer' rows exist yet).
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
    CHECK (role IN ('rep', 'manager', 'closer'));

-- ── 6. users.closer_notification_pref ─────────────────────────────────────
-- Hybrid closer model: by default a closer gets email notifications when
-- a lead is assigned. They can opt into the app (login), SMS, or both.
-- Only meaningful when role = 'closer' — nullable so reps/managers don't
-- carry an irrelevant value.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS closer_notification_pref TEXT
    DEFAULT 'email'
    CHECK (closer_notification_pref IN ('app', 'email', 'sms', 'both'));

-- ── 7. interactions: pipeline stage + timestamps ──────────────────────────
-- `stage` supersedes `outcome` for deals that are still active in the
-- pipeline. Keeping both during the transition: `outcome` is what the rep
-- logged at the door, `stage` is the deal's current funnel position.
-- A backfill below seeds `stage` from the existing `outcome` so the
-- Pipeline tab shows historical deals on day one.
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS stage TEXT
    CHECK (stage IN (
      'hot_lead',
      'appt_scheduled',
      'estimate_sent',
      'booked',
      'closed_stale',
      'closed_lost',
      'closed_not_interested'
    ));

ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS appointment_at      TIMESTAMPTZ;
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS estimate_sent_at    TIMESTAMPTZ;
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS hot_lead_started_at TIMESTAMPTZ;

-- Closer assignment. Nullable: quick-quote orgs may never assign a closer.
-- ON DELETE SET NULL so removing a closer from the org doesn't orphan the
-- deal — manager can reassign.
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS closer_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL;

-- Lost-reason capture. Nullable because most active deals haven't lost.
-- Enum values cover the door-stage and post-estimate scenarios discussed
-- in the design. `lost_reason_notes` is free text for the long tail.
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS lost_reason TEXT
    CHECK (lost_reason IN (
      -- Lost at the door
      'has_provider',
      'not_decision_maker',
      'not_in_market',
      'hostile',
      -- Lost after estimate
      'price',
      'timing',
      'competitor',
      'ghosted',
      'diy',
      -- Catch-all
      'other'
    ));
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS lost_reason_notes TEXT;
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ;

-- Indexes powering the Pipeline tab's column filters and the "appts in
-- next N days" calendar strip.
CREATE INDEX IF NOT EXISTS idx_interactions_stage
  ON public.interactions(stage)
  WHERE stage IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_interactions_closer
  ON public.interactions(closer_id)
  WHERE closer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_interactions_appointment
  ON public.interactions(appointment_at)
  WHERE appointment_at IS NOT NULL;

-- ── 8. Backfill `stage` from existing `outcome` ───────────────────────────
-- One-time map so the new Pipeline tab has historical context on day one.
-- Idempotent: only touches rows where stage is still NULL.
UPDATE public.interactions
   SET stage = CASE outcome
     WHEN 'booked'             THEN 'booked'
     WHEN 'estimate_requested' THEN 'hot_lead'
     WHEN 'not_interested'     THEN 'closed_not_interested'
     -- 'no_answer' interactions never entered the pipeline — leave NULL
     ELSE NULL
   END,
   hot_lead_started_at = CASE outcome
     WHEN 'estimate_requested' THEN created_at
     ELSE NULL
   END
 WHERE stage IS NULL;

-- ── 9. RLS: closers can read + update their own assigned leads ────────────
-- Existing policies already let managers read everything in their org and
-- reps manage their own interactions. Closers need a narrow lane:
-- read/update only interactions where closer_id = auth.uid().
DROP POLICY IF EXISTS "Closers can read assigned interactions"
  ON public.interactions;
CREATE POLICY "Closers can read assigned interactions"
  ON public.interactions FOR SELECT
  USING (
    closer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users
       WHERE id = auth.uid() AND role = 'closer'
    )
  );

DROP POLICY IF EXISTS "Closers can update assigned interactions"
  ON public.interactions;
CREATE POLICY "Closers can update assigned interactions"
  ON public.interactions FOR UPDATE
  USING (
    closer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users
       WHERE id = auth.uid() AND role = 'closer'
    )
  );

-- ── 10. Note for Phase 2 ──────────────────────────────────────────────────
-- Auto-graduation of stale Hot Leads (stage='hot_lead' AND
-- hot_lead_started_at < now() - hot_lead_stale_days * interval '1 day'
-- → stage='closed_stale') will be implemented as a scheduled function in
-- Phase 2 alongside the Closer Inbox. Defining it here would require the
-- per-org `hot_lead_stale_days` lookup which is cleaner from edge-fn JS.
