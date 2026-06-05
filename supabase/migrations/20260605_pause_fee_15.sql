-- ============================================================
-- KnockIQ — Pause keep-warm fee → flat $15/month
--
-- The off-season "keep my data warm" pause fee is a FLAT monthly charge
-- (not per seat). Raising it from $5 to $15. Stripe price for this lives in
-- the "KnockIQ — Paused (Keep-Warm)" product (flat $15/mo).
-- ============================================================

ALTER TABLE public.organizations ALTER COLUMN pause_fee_cents SET DEFAULT 1500;

-- Bring existing orgs still on the old $5 default up to $15; leave custom values.
UPDATE public.organizations SET pause_fee_cents = 1500 WHERE pause_fee_cents = 500;
