-- ============================================================
-- KnockIQ — Shareable rep sign-up links + pending-approval gate
--
-- Motivation: the existing "Add Rep" flow makes the owner type
-- every rep's name, email, and a temp password by hand. Fine for
-- a 4-person crew; brutal for a company onboarding 100+ canvassers.
--
-- This migration introduces a per-organization invite code so the
-- owner can hand out one URL (https://app.knockiq.com/join/<code>)
-- that any number of reps can self-onboard through. New joiners
-- land in a `pending` status — they can authenticate but the
-- /pending gate keeps them out of canvassing until the owner taps
-- Approve in Settings.
--
-- Touched objects (all idempotent — safe to re-apply):
--   1. organizations + new columns:  invite_code, invite_code_enabled
--   2. users + new column:           status ('active' | 'pending' | 'rejected')
--   3. helper: gen_org_invite_code() — short, unambiguous code generator
--   4. RPC lookup_invite_code(code)  — public, returns org name/tier preview
--   5. RPC consume_invite_code(code, full_name, phone)
--                                    — called by a freshly-signed-up rep
--                                      to attach themselves to an org in
--                                      pending state
--   6. RPC get_my_invite_code()      — owner reads their own code
--   7. RPC regenerate_invite_code()  — owner rotates the code
--   8. RPC set_invite_code_enabled(boolean)
--   9. RPC list_pending_reps()       — owner sees who's waiting
--  10. RPC approve_rep(rep_id)       — owner promotes pending → active
--  11. RPC reject_rep(rep_id)        — owner removes a pending applicant
--  12. RLS policy so managers can read pending rows in their own org
-- ============================================================

-- ── 1. Invite code columns on organizations ─────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS invite_code         TEXT,
  ADD COLUMN IF NOT EXISTS invite_code_enabled BOOLEAN NOT NULL DEFAULT true;

-- Unique partial index — two NULLs are fine, but no two orgs can share a
-- code. Partial so legacy rows with NULL invite_code don't clash.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_invite_code_unique
  ON public.organizations (invite_code)
  WHERE invite_code IS NOT NULL;

-- ── 2. Pending-status column on users ───────────────────────────────────────
-- Default 'active' so existing reps and owners keep working without a
-- migration-time data fix. New rows created via consume_invite_code are
-- explicitly stamped 'pending'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.users
      ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'pending', 'rejected'));
  END IF;
END $$;

-- ── 3. Code generator: short, no-ambiguous-chars (no 0/O, 1/I/l) ────────────
-- 8 chars from a 32-char alphabet ≈ 40 bits — collision-resistant enough
-- when paired with the unique index, and short enough to read over the
-- phone if the owner needs to dictate it. Format is uppercase block-of-8
-- (e.g. K7P29W4Q) — easy to scan and to type on a mobile keyboard.
CREATE OR REPLACE FUNCTION public.gen_org_invite_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result   TEXT := '';
  i        INT;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- Backfill: every existing org gets a code so owners can start using the
-- feature immediately. Retry up to 5 times against the unique index
-- before bailing — vanishingly small odds even for thousands of orgs.
DO $$
DECLARE
  o RECORD;
  attempts INT;
  candidate TEXT;
BEGIN
  FOR o IN SELECT id FROM public.organizations WHERE invite_code IS NULL LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      candidate := public.gen_org_invite_code();
      BEGIN
        UPDATE public.organizations SET invite_code = candidate WHERE id = o.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF attempts >= 5 THEN RAISE; END IF;
      END;
    END LOOP;
  END LOOP;
END $$;

-- ── 4. Public lookup — used by /join/:code to preview the org name ──────────
-- SECURITY DEFINER so an unauthenticated visitor can resolve the code to
-- an org name BEFORE creating an account. We return ONLY the minimum
-- needed for the join page (name + tier) — no member list, no settings,
-- no IDs that aren't useful client-side.
CREATE OR REPLACE FUNCTION public.lookup_invite_code(p_code TEXT)
RETURNS TABLE (
  organization_id   UUID,
  organization_name TEXT,
  tier              TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT o.id, o.name, o.tier
  FROM public.organizations o
  WHERE o.invite_code = upper(trim(p_code))
    AND COALESCE(o.invite_code_enabled, true) = true
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_invite_code(TEXT) TO anon, authenticated;

-- ── 5. Consume — called by a freshly-signed-up rep to attach to an org ──────
-- The auth user already exists (rep just called supabase.auth.signUp); this
-- RPC takes their JWT, validates the code, and stamps their public.users
-- row with the right org + a 'pending' status. SECURITY DEFINER so the
-- caller doesn't need any pre-existing org membership to insert/update.
CREATE OR REPLACE FUNCTION public.consume_invite_code(
  p_code      TEXT,
  p_full_name TEXT DEFAULT NULL,
  p_phone     TEXT DEFAULT NULL
)
RETURNS TABLE (
  organization_id   UUID,
  organization_name TEXT,
  status            TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_org_id  UUID;
  v_org_nm  TEXT;
  v_email   TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to redeem an invite code';
  END IF;
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RAISE EXCEPTION 'Invite code is required';
  END IF;

  SELECT o.id, o.name INTO v_org_id, v_org_nm
  FROM public.organizations o
  WHERE o.invite_code = upper(trim(p_code))
    AND COALESCE(o.invite_code_enabled, true) = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'That invite code is invalid or has been disabled';
  END IF;

  -- Pull the rep's email out of auth.users so the owner's Pending
  -- Approvals list has something to display. handle_new_user only
  -- copies id + full_name into public.users, so without this lookup
  -- the row's `email` would stay NULL.
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_uid;

  -- Upsert public.users — the handle_new_user trigger may have already
  -- inserted a stub row at signup time, so we update-or-insert idempotently.
  -- Force role='rep' (an invite code can never grant manager access) and
  -- status='pending' so the /pending gate intercepts them on first login.
  INSERT INTO public.users (id, full_name, email, role, status, organization_id, phone)
  VALUES (
    v_uid,
    COALESCE(NULLIF(trim(p_full_name), ''), ''),
    v_email,
    'rep',
    'pending',
    v_org_id,
    NULLIF(trim(p_phone), '')
  )
  ON CONFLICT (id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        role            = 'rep',
        status          = 'pending',
        full_name       = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.users.full_name),
        email           = COALESCE(EXCLUDED.email, public.users.email),
        phone           = COALESCE(EXCLUDED.phone, public.users.phone);

  organization_id   := v_org_id;
  organization_name := v_org_nm;
  status            := 'pending';
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_invite_code(TEXT, TEXT, TEXT) TO authenticated;

-- ── 6. Owner reads their own code ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_invite_code()
RETURNS TABLE (
  invite_code         TEXT,
  invite_code_enabled BOOLEAN,
  organization_id     UUID,
  organization_name   TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_role   TEXT;
  v_orgid  UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  SELECT u.role, u.organization_id INTO v_role, v_orgid
  FROM public.users u WHERE u.id = v_uid;
  IF v_role IS DISTINCT FROM 'manager' OR v_orgid IS NULL THEN
    RAISE EXCEPTION 'Only the organization owner can manage the invite code';
  END IF;
  RETURN QUERY
  SELECT o.invite_code, o.invite_code_enabled, o.id, o.name
  FROM public.organizations o WHERE o.id = v_orgid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_invite_code() TO authenticated;

-- ── 7. Regenerate — owners rotate the code (kills the old URL) ──────────────
CREATE OR REPLACE FUNCTION public.regenerate_invite_code()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_role      TEXT;
  v_orgid     UUID;
  v_attempts  INT  := 0;
  v_candidate TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT u.role, u.organization_id INTO v_role, v_orgid
  FROM public.users u WHERE u.id = v_uid;
  IF v_role IS DISTINCT FROM 'manager' OR v_orgid IS NULL THEN
    RAISE EXCEPTION 'Only the organization owner can regenerate the invite code';
  END IF;
  LOOP
    v_attempts  := v_attempts + 1;
    v_candidate := public.gen_org_invite_code();
    BEGIN
      UPDATE public.organizations SET invite_code = v_candidate WHERE id = v_orgid;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
  RETURN v_candidate;
END;
$$;

GRANT EXECUTE ON FUNCTION public.regenerate_invite_code() TO authenticated;

-- ── 8. Enable/disable toggle ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_invite_code_enabled(p_enabled BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_role  TEXT;
  v_orgid UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT u.role, u.organization_id INTO v_role, v_orgid
  FROM public.users u WHERE u.id = v_uid;
  IF v_role IS DISTINCT FROM 'manager' OR v_orgid IS NULL THEN
    RAISE EXCEPTION 'Only the organization owner can change the invite code';
  END IF;
  UPDATE public.organizations SET invite_code_enabled = p_enabled WHERE id = v_orgid;
  RETURN p_enabled;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_invite_code_enabled(BOOLEAN) TO authenticated;

-- ── 9. RLS for pending reps ────────────────────────────────────────────────
-- INTENTIONALLY NO NEW POLICY HERE.
--
-- An earlier draft of this migration added a "Managers can read pending
-- reps in their org" policy with a self-referential EXISTS subquery on
-- public.users. Postgres rejects that with "infinite recursion detected
-- in policy for relation users" the moment it stacks alongside the
-- pre-existing "Managers can read all users" policy (see
-- 20260418_super_admin_insights.sql for the same trap, with the same
-- failure mode — Shield icon vanishes, every users.select errors out).
--
-- The existing "Managers can read all users" policy already gives the
-- owner read access to every row in public.users, including pending
-- reps. getPendingReps() narrows to the owner's own org client-side
-- via .eq('organization_id', orgId), so no new server-side policy is
-- needed. If you ever want a defensive same-org filter at the policy
-- layer, do it via a SECURITY DEFINER helper (mirroring
-- is_current_user_super_admin) — never via inline EXISTS on the same
-- table the policy is attached to.

-- ── 10. Approve / reject helpers (owner-only) ───────────────────────────────
-- We expose these as RPCs (rather than letting the client write directly)
-- so the role + org-membership checks live in one place and so a future
-- audit log can be added without touching the client.
CREATE OR REPLACE FUNCTION public.approve_rep(p_rep_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_role    TEXT;
  v_orgid   UUID;
  v_target  RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT u.role, u.organization_id INTO v_role, v_orgid
  FROM public.users u WHERE u.id = v_uid;
  IF v_role IS DISTINCT FROM 'manager' OR v_orgid IS NULL THEN
    RAISE EXCEPTION 'Only the organization owner can approve reps';
  END IF;
  SELECT u.organization_id, u.status INTO v_target
  FROM public.users u WHERE u.id = p_rep_id;
  IF v_target.organization_id IS DISTINCT FROM v_orgid THEN
    RAISE EXCEPTION 'Rep is not in your organization';
  END IF;
  UPDATE public.users SET status = 'active' WHERE id = p_rep_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_rep(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_rep(p_rep_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_role   TEXT;
  v_orgid  UUID;
  v_target RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT u.role, u.organization_id INTO v_role, v_orgid
  FROM public.users u WHERE u.id = v_uid;
  IF v_role IS DISTINCT FROM 'manager' OR v_orgid IS NULL THEN
    RAISE EXCEPTION 'Only the organization owner can reject pending reps';
  END IF;
  SELECT u.organization_id, u.status INTO v_target
  FROM public.users u WHERE u.id = p_rep_id;
  IF v_target.organization_id IS DISTINCT FROM v_orgid THEN
    RAISE EXCEPTION 'Rep is not in your organization';
  END IF;
  -- Reject = mark as rejected and clear the org link so a future re-join
  -- via a fresh code starts clean. The auth.users row is intentionally
  -- left in place so the rep can re-attempt (or so the owner can reverse
  -- a misclick by re-approving). A separate "remove permanently" action
  -- can hard-delete via the existing manage-team edge function.
  UPDATE public.users
     SET status = 'rejected',
         organization_id = NULL
   WHERE id = p_rep_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_rep(UUID) TO authenticated;
