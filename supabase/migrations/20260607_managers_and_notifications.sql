-- ============================================================
-- Managers & pipeline-phase email notifications — Phase 6
--
-- Two things ship together here:
--
--   1. A second "manager" tier that mirrors the closer two-tier model:
--        • public.users role='manager'  — full dashboard login, takes a
--          billable seat (countBillableSeats already bills managers).
--          These already exist (the owner is one); this migration just
--          gives them a notification-subscription column.
--        • manager_contacts             — email-only. No auth user, no
--          seat. Receives pipeline-phase emails only. Mirrors
--          closer_contacts exactly.
--
--   2. A per-manager subscription to pipeline-phase emails. The owner
--      (and any manager, per product decision) can opt each manager into
--      emails for the phases they care about:
--        • 'hot_lead'    — a lead becomes a Hot Lead
--        • 'appointment' — a lead hits Appt Scheduled OR Estimate Sent
--                          (the two are combined into one toggle)
--        • 'booked'      — a job is booked
--
--      Stored as a text[] so a manager can pick any/all phases. Empty
--      array (the default) = no emails.
--
-- Owner-only by design: only the org owner manages the manager roster and
-- their notification routing. RLS below enforces that for manager_contacts;
-- the platform-manager column rides on the existing users-update policy
-- (owner is a manager, managers may update users in their org).
--
-- All additive + idempotent.
-- ============================================================

-- ── Allowed phase values (single source of truth for both CHECKs) ─────────
-- 'hot_lead' | 'appointment' | 'booked'. 'appointment' deliberately spans
-- both appt_scheduled and estimate_sent stages — the product surfaces them
-- as one combined "Appointments & estimates" toggle.

-- ── 1. Platform managers: notification-phase subscription column ───────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS manager_notify_phases text[] NOT NULL DEFAULT '{}'::text[];

-- Every element must be one of the allowed phases. <@ is "array contained
-- by". An empty array trivially satisfies this.
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_manager_notify_phases_valid;
ALTER TABLE public.users
  ADD CONSTRAINT users_manager_notify_phases_valid
    CHECK (manager_notify_phases <@ ARRAY['hot_lead','appointment','booked']::text[]);

-- Backfill any pre-existing NULLs (older rows added before the DEFAULT) to
-- an empty array so the app never has to coalesce.
UPDATE public.users
   SET manager_notify_phases = '{}'::text[]
 WHERE manager_notify_phases IS NULL;

-- ── 2. Email-only managers table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.manager_contacts (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name         text          NOT NULL,
  email             text          NOT NULL,
  phone             text,
  -- Which pipeline phases this manager wants emailed to them. Any subset of
  -- the three allowed phases; empty = subscribed to nothing (still useful as
  -- a placeholder row the owner can toggle on later).
  notify_phases     text[]        NOT NULL DEFAULT '{}'::text[]
                                  CHECK (notify_phases <@ ARRAY['hot_lead','appointment','booked']::text[]),
  -- Parity with closer_contacts: if we ever promote an email-only manager to
  -- a platform user we stamp the new users.id here and keep the row for audit
  -- without it showing in the active roster.
  promoted_to_user_id uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  promoted_at         timestamptz,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_manager_contacts_org
  ON public.manager_contacts(organization_id)
  WHERE promoted_to_user_id IS NULL;

ALTER TABLE public.manager_contacts ENABLE ROW LEVEL SECURITY;

-- ── 3. RLS: owner-only management ─────────────────────────────────────────
-- Unlike closer_contacts (which reps can read for the at-the-door routing
-- dropdown), manager_contacts are owner-only end to end — no rep or closer
-- ever needs to see them. "Owner" = the org's owner_user_id, plus
-- super-admins for support. We express this as: the caller is a manager in
-- the same org AND is that org's owner.
--
-- Helper predicate inlined into each policy (no SECURITY DEFINER function so
-- the policy is easy to audit):
--   EXISTS (a users row for auth.uid() that is a manager in this org)
--   AND that org's owner_user_id = auth.uid()

DROP POLICY IF EXISTS "Owners can read manager contacts" ON public.manager_contacts;
CREATE POLICY "Owners can read manager contacts"
  ON public.manager_contacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.users u
        JOIN public.organizations o ON o.id = u.organization_id
       WHERE u.id = auth.uid()
         AND u.role = 'manager'
         AND u.organization_id = manager_contacts.organization_id
         AND (o.owner_user_id = auth.uid() OR u.is_super_admin = true)
    )
  );

DROP POLICY IF EXISTS "Owners can insert manager contacts" ON public.manager_contacts;
CREATE POLICY "Owners can insert manager contacts"
  ON public.manager_contacts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.users u
        JOIN public.organizations o ON o.id = u.organization_id
       WHERE u.id = auth.uid()
         AND u.role = 'manager'
         AND u.organization_id = manager_contacts.organization_id
         AND (o.owner_user_id = auth.uid() OR u.is_super_admin = true)
    )
  );

DROP POLICY IF EXISTS "Owners can update manager contacts" ON public.manager_contacts;
CREATE POLICY "Owners can update manager contacts"
  ON public.manager_contacts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
        FROM public.users u
        JOIN public.organizations o ON o.id = u.organization_id
       WHERE u.id = auth.uid()
         AND u.role = 'manager'
         AND u.organization_id = manager_contacts.organization_id
         AND (o.owner_user_id = auth.uid() OR u.is_super_admin = true)
    )
  );

DROP POLICY IF EXISTS "Owners can delete manager contacts" ON public.manager_contacts;
CREATE POLICY "Owners can delete manager contacts"
  ON public.manager_contacts FOR DELETE
  USING (
    EXISTS (
      SELECT 1
        FROM public.users u
        JOIN public.organizations o ON o.id = u.organization_id
       WHERE u.id = auth.uid()
         AND u.role = 'manager'
         AND u.organization_id = manager_contacts.organization_id
         AND (o.owner_user_id = auth.uid() OR u.is_super_admin = true)
    )
  );

-- updated_at touch trigger (reuse-friendly name, manager-scoped).
CREATE OR REPLACE FUNCTION public.touch_manager_contacts_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manager_contacts_touch_updated_at ON public.manager_contacts;
CREATE TRIGGER manager_contacts_touch_updated_at
  BEFORE UPDATE ON public.manager_contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_manager_contacts_updated_at();
