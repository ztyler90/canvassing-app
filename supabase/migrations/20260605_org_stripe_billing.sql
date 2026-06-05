-- ============================================================
-- KnockIQ — Org-level Stripe billing identifiers
-- ============================================================
-- Tier gating, the reverse-trial, and the pause/cancel lifecycle all read
-- from the ORGANIZATION, not the individual user — so the org is where the
-- Stripe customer + subscription identifiers belong. The original
-- 20260412_billing.sql put these on public.users, but that migration was
-- never applied to this database (the users table has no stripe_* columns),
-- so there is NOTHING to backfill — this is a clean add to organizations.
--
-- After this lands, the manage-team Edge Function reads
-- organizations.stripe_subscription_id directly (it already fetches the org
-- row) instead of bridging through the owner's users row, and the
-- (future) checkout + webhook functions write the customer/subscription
-- ids straight onto the org.
-- ============================================================

ALTER TABLE public.organizations
  -- Stripe Customer for the org's billing account (cus_…).
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  -- The org's active subscription (sub_…). The pause flow swaps this
  -- subscription's price; cancel sets cancel_at_period_end; delete cancels it.
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  -- Mirror of the Stripe subscription's own status, written by the webhook.
  -- Distinct from organizations.status (our app-level lifecycle state):
  -- this tracks what Stripe thinks of the subscription. Nullable until a
  -- subscription exists. Constraint covers the Stripe subscription status
  -- enum so a webhook write never bounces on an unexpected value.
  ADD COLUMN IF NOT EXISTS subscription_status    TEXT
    CHECK (subscription_status IS NULL OR subscription_status IN (
      'trialing', 'active', 'past_due', 'canceled', 'unpaid',
      'incomplete', 'incomplete_expired', 'paused'
    ));

COMMENT ON COLUMN public.organizations.stripe_customer_id IS
  'Stripe Customer id (cus_…) for this org''s billing account. Set by checkout / webhook.';
COMMENT ON COLUMN public.organizations.stripe_subscription_id IS
  'Stripe Subscription id (sub_…). Read by manage-team for pause/cancel/delete; written by checkout / webhook.';
COMMENT ON COLUMN public.organizations.subscription_status IS
  'Mirror of the Stripe subscription status (trialing|active|past_due|canceled|unpaid|incomplete|incomplete_expired|paused). App lifecycle state lives in organizations.status.';

-- One Stripe customer / subscription maps to exactly one org. Partial unique
-- indexes enforce that (and double as the fast lookup path for the webhook,
-- which resolves an org from the Stripe ids on each event).
CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_customer_id_key
  ON public.organizations (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_subscription_id_key
  ON public.organizations (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
