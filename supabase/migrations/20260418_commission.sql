-- ============================================================
-- KnockIQ — Commission configuration
-- Stores each rep's commission rule, set by their manager.
--
-- commission_config shape (JSONB):
--   { "type": "flat_pct",    "value": 15 }                      -- 15% of revenue
--   { "type": "per_booking", "value": 75 }                      -- $75 per booked job
--   { "type": "tiered_pct",  "tiers": [                         -- tiered % of revenue
--       { "upto": 10000, "pct": 10 },
--       { "upto": 25000, "pct": 15 },
--       { "upto": null,  "pct": 20 }
--     ] }
--
-- NOTE: `upto` is inclusive; the final tier uses null for "no cap".
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS commission_config JSONB;

-- Allow managers in the same organization to update a rep's commission.
-- (Existing "Users can update own profile" policy stays in place for self-edits.)
DROP POLICY IF EXISTS "Managers update reps in their org" ON public.users;
CREATE POLICY "Managers update reps in their org"
  ON public.users FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users m
      WHERE m.id = auth.uid()
        AND m.role = 'manager'
        AND m.organization_id = public.users.organization_id
    )
  );
