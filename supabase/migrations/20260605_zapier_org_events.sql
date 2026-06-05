-- ============================================================
-- KnockIQ — Org-level Zapier webhook + per-event triggers
--
-- Moves the Zapier webhook config from per-user auth metadata to the
-- organization row so that rep-driven events (a rep booking a job or
-- setting an appointment) can fire the webhook — the rep's client reads
-- the org config (allowed by the organizations_select RLS policy), and
-- the org owner manages it in Settings.
--
--   1. organizations.zapier_webhook_url — the Catch Hook URL.
--   2. organizations.zapier_events       — which events fire (JSONB flags).
--
-- Default events: session end, new booking, and appointment scheduled are
-- ON; estimate-requested is OFF (it's the noisiest) — managers tune these
-- in Settings → CRM Integration.
-- Everything here is additive and idempotent.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS zapier_webhook_url TEXT,
  ADD COLUMN IF NOT EXISTS zapier_events JSONB NOT NULL
    DEFAULT '{"session_ended": true, "booking": true, "appointment": true, "estimate": false}'::jsonb;

COMMENT ON COLUMN public.organizations.zapier_webhook_url IS
  'Org-wide Zapier Catch Hook URL. Pro feature; set by the org owner.';
COMMENT ON COLUMN public.organizations.zapier_events IS
  'Per-event toggles for the Zapier webhook: session_ended, booking, appointment, estimate.';
