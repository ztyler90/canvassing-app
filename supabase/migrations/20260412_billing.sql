-- ============================================================
-- KnockIQ — Billing migration
-- Adds Stripe subscription fields to public.users
-- Run in Supabase SQL Editor before deploying billing features
-- ============================================================

-- 1. Make phone nullable (was NOT NULL — conflicts with email-only signup)
ALTER TABLE public.users
  ALTER COLUMN phone DROP NOT NULL;

-- Remove the UNIQUE constraint on phone so NULL values don't clash.
-- (Two NULLs are not equal, but some Postgres versions still reject it
--  on a UNIQUE column.  Drop and recreate as a partial index instead.)
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
  ON public.users (phone)
  WHERE phone IS NOT NULL;

-- 2. Add Stripe / billing columns
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status    TEXT NOT NULL DEFAULT 'trialing'
    CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid')),
  ADD COLUMN IF NOT EXISTS trial_ends_at          TIMESTAMPTZ;

-- 3. Update the handle_new_user trigger so phone defaults to NULL
--    (not to the empty-string fallback) when none is supplied.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, phone, full_name)
  VALUES (
    NEW.id,
    NULLIF(COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone', ''), ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$;

-- 4. Grant the service-role (used by Edge Functions) insert/update on users
--    (already exists via RLS bypass for service role, but explicit for clarity)
-- No extra grants needed — service role bypasses RLS by default in Supabase.
