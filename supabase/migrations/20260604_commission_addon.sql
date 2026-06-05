-- ============================================================
-- KnockIQ — Commission add-on (Pro tier)
--
-- Commission tracking becomes a Pro-only, opt-in add-on. The manager
-- toggles it on after upgrading; reps only see commission + total pay
-- once it's enabled.
--
-- 1. organizations.commission_enabled — the per-org opt-in flag.
-- 2. commission_config gains an optional `base_hourly_rate` so reps see
--    total pay (commission + hourly × hours), not just commission.
--
-- Updated commission_config shape (JSONB):
--   { "type": "flat_pct",    "value": 15, "base_hourly_rate": 18 }
--   { "type": "per_booking", "value": 75, "base_hourly_rate": 0  }
--   { "type": "tiered_pct",  "tiers": [...], "base_hourly_rate": 20 }
--
-- `base_hourly_rate` is optional and defaults to 0 (commission-only).
-- Everything here is additive and idempotent.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS commission_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.commission_enabled IS
  'Pro-only opt-in: when true, commission tracking + base pay is active for the org.';

-- No schema change needed for base_hourly_rate — it lives inside the
-- existing commission_config JSONB on public.users. Documented here for
-- discoverability.
