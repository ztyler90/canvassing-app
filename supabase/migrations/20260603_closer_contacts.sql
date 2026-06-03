-- ============================================================
-- Closer Contacts — Phase 5 (post-Pipeline rebuild)
--
-- Splits the closer concept into two tiers:
--   • closer_contacts   — name + email + phone only, no auth user.
--                         Receives lead-assigned emails. Doesn't take a
--                         platform seat. The default for most orgs.
--   • public.users      — role='closer' as before. Full login, Closer
--                         Inbox access. Manager opts in per-person when
--                         the closer would benefit from platform access.
--
-- A lead can be assigned to exactly one of the two. The CHECK constraint
-- below prevents both columns from being set on the same row.
--
-- Touched objects (all additive + idempotent):
--   1. closer_contacts table
--   2. interactions.closer_contact_id column + FK
--   3. interactions XOR check (at most one closer reference)
--   4. RLS policies on closer_contacts (org-scoped read/write for
--      managers; reps may read so the routing dropdown works)
-- ============================================================

-- ── 1. Closer contacts table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.closer_contacts (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name         text          NOT NULL,
  email             text          NOT NULL,
  phone             text,
  -- Mirrors users.closer_notification_pref. 'app' is intentionally NOT
  -- valid here — an email-only contact has no app to log into. If they
  -- want app delivery, they should be promoted to a platform user.
  notification_pref text          NOT NULL DEFAULT 'email'
                                  CHECK (notification_pref IN ('email', 'sms', 'both')),
  -- When a manager promotes an email-only contact to a platform user, we
  -- stamp this with the new public.users id and timestamp so we can keep
  -- the row around for audit purposes without it appearing in the active
  -- closer list. Promoted rows are excluded from getAllClosersUnified().
  promoted_to_user_id uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  promoted_at         timestamptz,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_closer_contacts_org
  ON public.closer_contacts(organization_id)
  WHERE promoted_to_user_id IS NULL;

ALTER TABLE public.closer_contacts ENABLE ROW LEVEL SECURITY;

-- Managers + owners can read all contacts in their org.
DROP POLICY IF EXISTS "Managers can read closer contacts in their org"
  ON public.closer_contacts;
CREATE POLICY "Managers can read closer contacts in their org"
  ON public.closer_contacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
       WHERE id = auth.uid()
         AND role = 'manager'
         AND organization_id = closer_contacts.organization_id
    )
  );

-- Reps need to read them too — the at-the-door routing dropdown lists
-- both tiers, and the rep is the one inserting interactions.closer_contact_id.
DROP POLICY IF EXISTS "Reps can read closer contacts in their org"
  ON public.closer_contacts;
CREATE POLICY "Reps can read closer contacts in their org"
  ON public.closer_contacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
       WHERE id = auth.uid()
         AND role = 'rep'
         AND organization_id = closer_contacts.organization_id
    )
  );

-- Managers can fully manage contacts in their own org.
DROP POLICY IF EXISTS "Managers can insert closer contacts"
  ON public.closer_contacts;
CREATE POLICY "Managers can insert closer contacts"
  ON public.closer_contacts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
       WHERE id = auth.uid()
         AND role = 'manager'
         AND organization_id = closer_contacts.organization_id
    )
  );

DROP POLICY IF EXISTS "Managers can update closer contacts"
  ON public.closer_contacts;
CREATE POLICY "Managers can update closer contacts"
  ON public.closer_contacts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
       WHERE id = auth.uid()
         AND role = 'manager'
         AND organization_id = closer_contacts.organization_id
    )
  );

DROP POLICY IF EXISTS "Managers can delete closer contacts"
  ON public.closer_contacts;
CREATE POLICY "Managers can delete closer contacts"
  ON public.closer_contacts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
       WHERE id = auth.uid()
         AND role = 'manager'
         AND organization_id = closer_contacts.organization_id
    )
  );

-- updated_at trigger so the unified list can sort by recency.
CREATE OR REPLACE FUNCTION public.touch_closer_contacts_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS closer_contacts_touch_updated_at ON public.closer_contacts;
CREATE TRIGGER closer_contacts_touch_updated_at
  BEFORE UPDATE ON public.closer_contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_closer_contacts_updated_at();

-- ── 2. interactions.closer_contact_id ─────────────────────────────────────
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS closer_contact_id uuid
    REFERENCES public.closer_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_interactions_closer_contact
  ON public.interactions(closer_contact_id)
  WHERE closer_contact_id IS NOT NULL;

-- ── 3. XOR check: at most one closer reference per row ────────────────────
-- A lead can have a closer (platform user) OR a closer contact (email-
-- only) OR neither (unassigned), but never both. NOT VALID would let
-- legacy rows through without a recheck — interactions has no rows with
-- both columns set today, so we can validate cleanly.
ALTER TABLE public.interactions
  DROP CONSTRAINT IF EXISTS interactions_single_closer_reference;
ALTER TABLE public.interactions
  ADD CONSTRAINT interactions_single_closer_reference
    CHECK (closer_id IS NULL OR closer_contact_id IS NULL);
