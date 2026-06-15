# KnockIQ — Third-Party Tooling Setup

**Status as of 2026-06-14: deployed and live.** The app code is pushed, `npm install` is done, and
all the env vars/keys are set. What follows reflects the final state — what's live, and the short
list of optional items still open.

---

## Status at a glance

| Item | State |
|---|---|
| PostHog product analytics (US Cloud) | ✅ Live — key set, `presented_to_homeowner` firing |
| PostHog ↔ Stripe data-warehouse sync | ✅ Connected & syncing |
| ChartMogul (revenue analytics) | ✅ Stripe connected, backfilling MRR/churn/LTV |
| Cloudflare Turnstile captcha | ✅ Deployed — widget live, secret + provider set in Supabase |
| Supabase auth hardening (anon revoke) | ✅ Applied to prod + saved to repo |
| Dependabot | ✅ Active (opening weekly PRs) |
| Content-Security-Policy | 🟡 Live in **Report-Only** — promote to enforced later |
| HubSpot CRM | 🟡 Account created — used standalone, no sync yet (by design) |
| GitHub secret scanning + push protection | ⬜ Your action (GitHub dashboard) |
| WAF / rate limiting | ⬜ Optional (Cloudflare DNS or Vercel firewall) |
| Leaked-password protection | ⬜ Blocked — Supabase Pro-only, project is on Free |

**Still to do (all optional / your pace):** enable GitHub secret scanning, promote CSP to enforced
after watching the console, add a WAF, upgrade for leaked-password protection, and wire the thin
Supabase→HubSpot sync once you have sales volume. Details per section below.

---

## 1. Keys (all set)

In local `.env` **and** Vercel (Production + Preview). All public/publishable — safe in the client
bundle. The matching **secret** keys live only in the PostHog/Cloudflare/Supabase dashboards.

| Env var | Value / source | Status |
|---|---|---|
| `VITE_POSTHOG_KEY` | PostHog project `470756` API key | ✅ set |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` (US Cloud) | ✅ set |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile "KnockIQ App" site key | ✅ set |

---

## 2. PostHog (product analytics) — US Cloud ✅ LIVE

**Wired in code:**
- `src/lib/analytics.js` — init + `track` / `identify` / `resetAnalytics`. No-ops with no key.
- `src/main.jsx` — `initAnalytics()` on boot.
- `src/contexts/AuthContext.jsx` — `identify()` on sign-in, `resetAnalytics()` on sign-out.
  Identity is **non-PII**: distinct id = Supabase user id, plus `role`, `org_id`, `org_tier`, `plan`.
  No email or name is sent.
- `src/components/InteractionModal.jsx` — fires **`presented_to_homeowner`** when a rep opens the
  homeowner pricing card (props: `estimate_mode`, `item_count`, `value`, `outcome`, `is_editing`).
- `autocapture` is **off** — only explicit named events, to keep noise and accidental PII down.

**Stripe data-warehouse sync:** connected via restricted API key, syncing 15 Stripe tables (Customer,
Invoice, Subscription, Price, etc.) every 6h. `Coupon` is intentionally skipped (missing scope).

**Good next things to build in PostHog:**
- Funnel: door logged → estimate priced → `presented_to_homeowner` → booked.
- Session replay (toggle on in Project Settings) to see where reps drop off.
- A dashboard tile counting `presented_to_homeowner` per week / per org.

**Optional follow-up:** SPA route-change pageviews aren't tracked yet (only initial load). Ping me
for a small `usePageviews()` hook on the React Router setup if you want per-screen analytics.

---

## 3. Security hardening

### 3a. Dependabot — ✅ ACTIVE
`.github/dependabot.yml` is committed and live; it opens weekly PRs for npm + GitHub Actions
(minor/patch grouped, majors individual). Nothing to do.

### 3b. Secret scanning — ⬜ your action (GitHub dashboard)
Repo → Settings → Code security → enable **Secret scanning** + **Push protection** (free). Backs up
your git-history PII/secret scrub. (GitGuardian is a heavier multi-repo alternative.)

### 3c. Auth captcha (Cloudflare Turnstile) — ✅ DEPLOYED
**Wired in code:**
- `src/components/Turnstile.jsx` — renders only when `VITE_TURNSTILE_SITE_KEY` is set; otherwise null.
- `src/lib/supabase.js` — `signInWithEmail` / `signUpWithEmail` accept `{ captchaToken }`.
- Login + Signup render the widget and block submit until solved.
- **Signup single-use-token fix DONE:** when Turnstile is enabled, signup keeps the session from
  `signUp` and rebuilds the profile via `refreshUser()` instead of a second `signInWithEmail` the
  spent token would fail. When Turnstile is off, behavior is unchanged.

**Config (done):** Cloudflare widget "KnockIQ App" (Managed mode; hostnames `app.` / `getknockiq.com`
/ `www.getknockiq.com`). Site key in Vercel + `.env`. Secret key + **provider = Turnstile** set in
Supabase → Authentication → Attack Protection.

**Verify once:** with the app deployed, confirm the Turnstile widget shows on login, the Supabase
"Enable Captcha protection" toggle is on, and a login + a signup both succeed in a private window.

### 3d. WAF / rate limiting — ⬜ optional (dashboard)
Put Cloudflare in front of the app domain (proxied DNS) for bot/rate-limit protection, or enable
Vercel's WAF/Firewall. Supabase Auth already rate-limits; a WAF additionally protects your edge
functions and static origin. (Note: the DNS route is a bigger, careful change — plan it separately.)

### 3e. Content-Security-Policy — 🟡 live in Report-Only
`vercel.json` sends `Content-Security-Policy-Report-Only` scoped to your real dependencies (Supabase,
Stripe, PostHog, Google Maps, OSM/Leaflet tiles, Turnstile). Report-Only **cannot break anything** —
it only logs violations to the console.

**To promote to enforced:** browse the app (rep flow, manager dashboard, signup, maps, Stripe
checkout) with DevTools open, watch for CSP violation logs, add any missing origins, then rename the
header from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`. I can do this pass
with you after it's run a few days.

### 3f. Supabase auth hardening — ✅ APPLIED
See section 6.

---

## 4. ChartMogul (subscription analytics) — ✅ CONNECTED
Stripe connected as a data source via OAuth; ChartMogul is backfilling history and computing MRR,
churn, LTV, and cohorts. No app code needed — billing lives in Stripe. ChartMogul is your **revenue
source of truth**; PostHog's Stripe copy is for correlating revenue with product behavior.

---

## 5. HubSpot (CRM) — 🟡 standalone for now (intentional)

Account created. **Deliberately not connected to PostHog or other services yet** — at this stage
HubSpot earns its keep as a standalone place to track the companies you're actively selling to
(contacts, deals, pipeline). Connecting it everywhere just duplicates data before it adds value.

**When you have real sales volume,** the one connection worth making is a *thin*, one-directional
**Supabase → HubSpot** sync that pushes a few signals onto each company record — new org, upgraded to
Pro, went inactive:
- **Easiest:** Zapier (you have it) → "Create/Update HubSpot Company" on a Supabase event or your
  existing `fireWebhookEvent` payloads.
- **More robust:** a Supabase Edge Function calling the HubSpot API on key lifecycle events. Ping me.

**Avoid double-tooling:** HubSpot (pipeline) and Customer.io (lifecycle email) overlap. Let HubSpot
own *deals/pipeline* and Customer.io own *automated messaging*; sync only the fields each needs.

---

## 6. Supabase security advisors — ✅ APPLIED + remaining notes

Ran against the **Canvassing** prod project (`mcwspvhihekhkytfxggv`).

**A. Leaked-password protection — ⬜ blocked (Pro-only).** Supabase can reject breached passwords
(HaveIBeenPwned), but it's a **Pro-plan** feature and the org ("Heyday Labs") is on **Free**. Enable
it only if/when you upgrade — Auth → Providers → Email → "Prevent use of leaked passwords."

**B. `anon` could call privileged SECURITY DEFINER functions — ✅ FIXED.** Applied migration
`20260614_harden_revoke_anon_privileged_rpcs` (in `supabase/migrations/`, applied to prod): revoked
`anon` EXECUTE on `change_user_role`, `growth_create_offer`, `growth_apply_referral` (+ redundant
PUBLIC on `auth_is_manager`). All keep `authenticated` + `service_role`, so nothing broke (verified
via `pg_proc.proacl`).

> Deliberately NOT touched: the `auth_*` RLS helpers (`auth_is_owner`, `auth_is_super_admin`,
> `auth_organization_id`, `is_current_user_super_admin`) keep their `anon` grant — they're evaluated
> inside RLS policies in anon context during signup/invite, and were intentionally granted to `anon`
> in the earlier `20260606_harden_revoke_public_execute` migration. The advisor warnings for those
> are accepted.

**C. Many functions callable by `authenticated` (WARN) — by design.** These are RPCs signed-in users
legitimately call. Optional spot-audit: confirm `approve_rep`, `reject_rep`, `change_user_role`,
`provision_new_organization`, and the `growth_*` admin functions each verify the caller's role
internally. No migration unless a gap is found.

**D. RLS enabled, no policy on caches/growth tables (INFO) — safe.** RLS-on with no policy denies all
`anon`/`authenticated`; these are written by edge functions (service role) and read via SECURITY
DEFINER RPCs. No action needed.

---

## Remaining checklist (all optional)

1. Verify the captcha end-to-end (widget shows, Supabase toggle on, login + signup succeed).
2. Enable GitHub secret scanning + push protection.
3. Promote CSP from Report-Only to enforced after watching the console a few days.
4. Add a WAF (Cloudflare proxied DNS or Vercel firewall) when you want it.
5. Upgrade Supabase → enable leaked-password protection (only if you go Pro).
6. Wire the thin Supabase→HubSpot sync once you're actively working deals.
