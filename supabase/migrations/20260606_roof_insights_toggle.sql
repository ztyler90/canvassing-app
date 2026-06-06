-- Roof Insights (Google Solar) per-org opt-in toggle.
--
-- Roof data is a Pro feature, but many teams (e.g. straight appointment-setting
-- crews who don't care about roof size) don't need it — and every lookup is a
-- billable Google Solar call. So it's OFF by default: a manager turns it on in
-- Settings only if their team wants it, which keeps Solar spend at $0 for orgs
-- that never enable it.
--
-- Mirrors the `commission_enabled` add-on flag: Pro-gated in the app, opt-in,
-- default false.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS roof_insights_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.roof_insights_enabled IS
  'Pro-only opt-in: when true, reps/managers see the Google Solar roof-insights panel on doors & leads. Default false so Solar API is never called for teams that do not want it.';
