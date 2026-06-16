-- Payroll-accurate commission: stamp WHEN a job became booked.
--
-- Problem: commission was inferred from canvassing-session totals, which only
-- capture jobs booked AT THE DOOR. A job that was an estimate last week and is
-- converted to booked this week (via the pipeline / updateLeadStage) only flips
-- `stage='booked'` — it never touched session revenue and had no timestamp for
-- when it converted, so its commission was either uncounted or mis-dated to the
-- original knock (created_at).
--
-- Fix: a dedicated `booked_at` timestamp, set automatically the moment a row
-- reaches stage='booked' (works for both door-bookings on INSERT and pipeline
-- conversions on UPDATE), and cleared if a job moves back out of booked. The
-- app then computes commission from booked jobs bucketed by booked_at, so each
-- job's pay lands in the week it actually converted.

ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS booked_at timestamptz;

COMMENT ON COLUMN public.interactions.booked_at IS
  'When this job became booked (stage reached booked). Drives payroll-period commission attribution. Set by trigger set_interaction_booked_at; NULL when not booked.';

CREATE OR REPLACE FUNCTION public.set_interaction_booked_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stage = 'booked' THEN
    -- First time it becomes booked, stamp it; preserve an existing stamp so
    -- later edits to a booked row don't reset the conversion date.
    IF NEW.booked_at IS NULL THEN
      NEW.booked_at := now();
    END IF;
  ELSE
    -- Moved out of booked (or never booked) → no booked date.
    NEW.booked_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_interaction_booked_at ON public.interactions;
CREATE TRIGGER trg_set_interaction_booked_at
  BEFORE INSERT OR UPDATE ON public.interactions
  FOR EACH ROW EXECUTE FUNCTION public.set_interaction_booked_at();

-- Backfill: existing booked jobs get their knock date as a best-available
-- booked_at (we have no historical conversion timestamp). Accurate going
-- forward; only pre-existing rows fall back to created_at.
UPDATE public.interactions
  SET booked_at = created_at
  WHERE stage = 'booked' AND booked_at IS NULL;

-- Index to keep period-bucketed commission queries fast (rep + booked window).
CREATE INDEX IF NOT EXISTS idx_interactions_rep_booked_at
  ON public.interactions (rep_id, booked_at)
  WHERE stage = 'booked';
