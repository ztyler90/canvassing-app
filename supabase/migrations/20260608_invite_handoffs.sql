-- Two-step invite landing ("welcome handoff") — prevents email scanners
-- from consuming Supabase one-time magic-link tokens by moving the
-- Supabase token out of the email entirely.
-- ──────────────────────────────────────────────────────────────────────
-- Background: Gmail iOS / Apple Mail Privacy Protection / corporate
-- spam filters pre-fetch links inside emails to scan for malware. When
-- the target is a Supabase /auth/v1/verify?token=... URL, that
-- pre-fetch CONSUMES the one-time token. By the time the actual rep
-- taps it, the token is gone — they see "Email link is invalid or has
-- expired" on /set-password.
--
-- The fix is to put a redirect through our own domain in the email
-- instead of the Supabase URL. The email's link points at
-- /welcome?h=<handoff_token>, which is a static page. Pre-fetchers
-- can hit it all day; nothing in our auth state changes. Only when a
-- human clicks the "Activate my account" button on that page do we
-- POST to the invite-handoff edge function, which mints a FRESH
-- Supabase magic link right then and 302s the rep to it. The Supabase
-- token lives for only the few seconds between click and redirect.
--
-- This table backs that handoff:
--   • handoff_token — random UUID embedded in the email link.
--   • user_id       — the auth user this handoff resolves to.
--   • email         — denormalized for the rare case where we resend
--                     before the user row is reachable.
--   • full_name     — surfaced on the /welcome page so the rep sees
--                     a personalized "Welcome, Chad" instead of a
--                     generic message. Also rendered into the email.
--   • inviter_name  — "Sent by your manager Zach" copy.
--   • org_name      — same; for the welcome page header.
--   • purpose       — 'invite' or 'resend' (for analytics/auditing
--                     only; redeem always mints a magiclink because by
--                     then the auth user exists).
--   • redeem_count  — how many times the button has been tapped. We
--                     allow up to 5 within the validity window so a
--                     rep who closes the page can re-click without
--                     bothering the manager. Past 5, refuse and force
--                     a real resend.
--   • last_redeemed_at — audit timestamp.
--   • expires_at    — handoff window. Default 7 days from create.
--                     The Supabase token MINTED at redeem time is
--                     still its own 24h token.
--   • completed_at  — set when /set-password successfully sets the
--                     rep's password. Locks further redemptions.
--   • organization_id — for tenant_isolation. RLS uses the same
--                     pattern as the rest of the schema.
--
-- All writes happen via service_role (the edge functions). The anon
-- role gets a SELECT-by-token policy ONLY for the welcome page to
-- render the rep's name without authenticating; the redeem endpoint
-- itself is service_role.

create table if not exists public.invite_handoffs (
  id              uuid        primary key default gen_random_uuid(),
  handoff_token   uuid        not null unique default gen_random_uuid(),
  user_id         uuid        not null references public.users(id) on delete cascade,
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  email           text        not null,
  full_name       text,
  inviter_name    text,
  org_name        text,
  purpose         text        not null default 'invite'
                              check (purpose in ('invite', 'resend')),
  redeem_count    integer     not null default 0,
  last_redeemed_at timestamptz,
  completed_at    timestamptz,
  expires_at      timestamptz not null default (now() + interval '7 days'),
  created_at      timestamptz not null default now()
);

create index if not exists idx_invite_handoffs_user
  on public.invite_handoffs(user_id, created_at desc);

create index if not exists idx_invite_handoffs_org
  on public.invite_handoffs(organization_id);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.invite_handoffs enable row level security;
alter table public.invite_handoffs force row level security;

-- service_role bypasses RLS implicitly (its role; not "authenticated"),
-- so the edge functions can read/write freely without policies. We
-- only need policies for the anon role's narrow peek use.

-- Anonymous (un-authenticated) SELECT BY EXACT TOKEN — the welcome page
-- hits this with the handoff_token from the URL to display the rep's
-- name. The unique constraint on handoff_token + the predicate below
-- means a caller can read at most one row, and only if they already
-- hold the random UUID. No enumeration is possible.
drop policy if exists "Anon peek by handoff_token" on public.invite_handoffs;
create policy "Anon peek by handoff_token"
  on public.invite_handoffs
  for select
  to anon
  using (
    handoff_token = (current_setting('request.jwt.claims', true)::jsonb ->> 'handoff_token')::uuid
  );

-- Reality check on the policy above: PostgREST clients don't set
-- request.jwt.claims for anon, so the policy effectively NEVER passes.
-- That's intentional — we DON'T want the welcome page reading rows
-- with just the anon key. The peek happens via the edge function
-- (service_role), which is the same path as the redeem call. The
-- policy above stays as a future hook in case we move peek to a
-- direct PostgREST call later.
