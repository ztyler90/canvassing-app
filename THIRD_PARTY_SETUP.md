# KnockIQ — Third-Party Tooling Setup

Status of the five tools you asked to stand up: PostHog, security hardening, ChartMogul, HubSpot.
Everything code-side is already wired and **inert until you add keys** — the app builds and runs
exactly as before with all the env vars blank.

---

## 0. One-time: install the new dependency

PostHog needs its SDK installed (already added to `package.json`):

```bash
npm install
```

This pulls in `posthog-js`. Commit the updated `package-lock.json`.

---

## 1. Keys checklist

Add these to your local `.env` **and** to Vercel (Project → Settings → Environment Variables).
All are safe to expose in the client bundle (they're public/publishable keys) — the matching
**secret** keys live only in PostHog/Cloudflare/Supabase dashboards, never in the repo.

| Env var | Where to get it | Blank = |
|---|---|---|
| `VITE_POSTHOG_KEY` | PostHog → Project Settings → Project API Key | analytics fully off |
| `VITE_POSTHOG_HOST` | leave as `https://us.i.posthog.com` (US Cloud) | defaults to US Cloud |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile dashboard → site key | captcha widget hidden |

`.env.example` already documents these.

---

## 2. PostHog (product analytics) — US Cloud

**What's wired:**
- `src/lib/analytics.js` — init + `track` / `identify` / `resetAnalytics`. No-ops with no key.
- `src/main.jsx` — calls `initAnalytics()` on boot.
- `src/contexts/AuthContext.jsx` — `identify()` on sign-in, `resetAnalytics()` on sign-out.
  Identity is **non-PII**: distinct id = Supabase user id, plus `role`, `org_id`, `org_tier`, `plan`.
  No email or name is ever sent.
- `src/components/InteractionModal.jsx` — fires **`presented_to_homeowner`** when a rep opens the
  homeowner pricing card, with props: `estimate_mode`, `item_count`, `value`, `outcome`, `is_editing`.
- `autocapture` is **off** — only explicit named events are sent, which keeps noise and accidental
  PII capture down.

**Setup steps:**
1. Create a PostHog account, choose **US Cloud**.
2. Copy the Project API Key → `VITE_POSTHOG_KEY` (local `.env` + Vercel).
3. Redeploy. Sign in once, open an estimate, tap **Present to Homeowner**.
4. In PostHog → Activity, confirm the `presented_to_homeowner` event arrives.

**Good first things to build in PostHog:**
- A funnel: door logged → estimate priced → `presented_to_homeowner` → booked.
- Session replay (toggle on in Project Settings) to watch where reps drop off.
- A dashboard tile counting `presented_to_homeowner` per week / per org.

**Follow-up (optional):** SPA route-change pageviews aren't tracked yet (only the initial load).
If you want per-screen analytics, I can add a tiny `usePageviews()` hook to your React Router setup.

---

## 3. Security hardening

### 3a. Dependabot — DONE (auto-activates on push)
`.github/dependabot.yml` is committed. Once pushed to GitHub it opens weekly PRs for npm + GitHub
Actions updates (minor/patch grouped, majors individual). Nothing else to do.

### 3b. Secret scanning — your action (GitHub dashboard)
Repo → Settings → Code security → enable **Secret scanning** + **Push protection**. Free for the
repo. This directly backs up your pending git-history PII/secret scrub. (GitGuardian is a heavier
alternative if you want scanning across multiple repos + Slack alerts.)

### 3c. Auth captcha (Cloudflare Turnstile) — wired, needs keys
**What's wired:**
- `src/components/Turnstile.jsx` — renders only when `VITE_TURNSTILE_SITE_KEY` is set; otherwise null.
- `src/lib/supabase.js` — `signInWithEmail` / `signUpWithEmail` now accept `{ captchaToken }`.
- Login + Signup forms render the widget and block submit until it's solved.

**Setup steps:**
1. Cloudflare → Turnstile → create a widget. Copy the **site key** → `VITE_TURNSTILE_SITE_KEY`.
2. Copy the **secret key** → Supabase → Authentication → Attack Protection → enable CAPTCHA,
   provider **Turnstile**, paste the secret.
3. Redeploy.

> ⚠️ **Signup caveat:** when Supabase CAPTCHA enforcement is on, the signup flow's *secondary*
> `signInWithEmail` call (right after account creation) would need its own token, but a Turnstile
> token is single-use. The clean fix is to reuse the session from signup instead of re-signing-in.
> Ping me and I'll make that one-line change when you're ready to enforce captcha.

### 3d. WAF / rate limiting — your action (dashboard)
Put Cloudflare in front of the app domain (proxied DNS) for bot/rate-limit protection, or enable
Vercel's WAF/Firewall on the project. Supabase Auth already rate-limits, but a WAF protects your
edge functions and static origin too.

### 3e. Content-Security-Policy — wired in **Report-Only** mode
`vercel.json` now sends `Content-Security-Policy-Report-Only` scoped to your real dependencies
(Supabase, Stripe, PostHog, Google Maps, OSM/Leaflet tiles, Turnstile). Report-Only **cannot break
anything** — it only logs violations to the browser console.

**To promote to enforced:** browse the app (rep flow, manager dashboard, signup, maps, Stripe
checkout) with DevTools open, watch for CSP violation logs, add any missing origins, then rename the
header from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`. I can do this pass
with you once it's been running a few days.

### 3f. Supabase auth hardening — INSPECTED, proposal below (your approval needed)
See section 6.

---

## 4. ChartMogul (subscription analytics) — your action, no code

ChartMogul reads your **Stripe** data — no app code needed.
1. Create a ChartMogul account.
2. Connect your **Stripe** account as a data source (ChartMogul → Data Sources → Stripe → OAuth).
3. It backfills history and gives you MRR, churn, LTV, cohorts automatically.

That's it — because billing already lives in Stripe, ChartMogul needs nothing from Supabase.
(Baremetrics is a near-identical alternative if you prefer its UI.)

---

## 5. HubSpot (CRM) — your action + light sync

HubSpot is your **sales pipeline**, not a mirror of Supabase. Keep the sync thin: push a few
signals in, don't replicate your schema.

**Setup:**
1. Create a HubSpot account (free CRM tier is fine to start).
2. Decide the few fields worth syncing per company: `lifecycle stage`, `plan/tier`, `MRR`,
   `signup date`, `last active`. (MRR can come from Stripe via HubSpot's Stripe integration.)

**Sync options (Supabase → HubSpot, one direction):**
- **Easiest:** Zapier (you already have it). Trigger on a Supabase event (e.g. new org row, or your
  existing `fireWebhookEvent` payloads) → "Create/Update HubSpot Company".
- **More robust later:** a Supabase Edge Function that calls the HubSpot API on key lifecycle events
  (org created, upgraded to Pro, churned). I can build this when you want it.

**Avoid double-tooling:** HubSpot (sales pipeline) and Customer.io (lifecycle email) overlap. Let
HubSpot own *deals/pipeline* and Customer.io own *automated messaging*; only sync the fields each
genuinely needs so they don't drift.

---

## 6. Supabase security advisors — findings + proposed fixes (await your OK)

I ran the security advisors against the **Canvassing** prod project (read-only). Nothing was changed.

### Findings

**A. Leaked-password protection is OFF (WARN).** Supabase can reject passwords found in
HaveIBeenPwned breaches. One toggle, no migration, zero breakage risk.
→ **Action (you):** Auth → Policies → enable "Leaked password protection".

**B. `anon` can call privileged SECURITY DEFINER functions (WARN).** Several internal helper /
admin functions are callable by the logged-out `anon` role via REST RPC. Most internally reject
unauthenticated callers, but they shouldn't be reachable at all. Proposed targeted revoke (keeps the
genuinely pre-auth ones — `lookup_invite_code`, and `growth_apply_referral` pending your confirmation
— callable):

```sql
-- PROPOSED — review before applying. Revokes anon EXECUTE on internal/admin
-- functions while leaving them callable by `authenticated` (RLS policies that
-- reference the auth_* helpers run as authenticated and must keep EXECUTE).
revoke execute on function public.auth_is_manager()            from anon;
revoke execute on function public.auth_is_owner()              from anon;
revoke execute on function public.auth_is_super_admin()        from anon;
revoke execute on function public.auth_organization_id()       from anon;
revoke execute on function public.is_current_user_super_admin() from anon;
revoke execute on function public.change_user_role(uuid, text) from anon;
revoke execute on function public.growth_create_offer(text, text, integer) from anon;
```

> Do **not** blanket-revoke from `authenticated` on the `auth_*` helpers — they're used inside RLS
> policies and revoking would break row access for signed-in users.

**C. Many functions callable by `authenticated` (WARN).** This is mostly **by design** — these are
the RPCs your signed-in users legitimately call (chat, approve/reject rep, provisioning, etc.). The
real safeguard is that each privileged one verifies the caller's role internally. Recommend a quick
spot-audit of: `approve_rep`, `reject_rep`, `change_user_role`, `provision_new_organization`, and the
`growth_*` admin functions — confirm each checks the caller is an owner/manager. No migration unless
the audit finds a gap.

**D. RLS enabled, no policy on `geocode_cache`, `solar_cache`, `growth_attributions`,
`growth_commission_ledger`, `growth_managers` (INFO).** This is the **safe** state — RLS-on with no
policy denies all `anon`/`authenticated` access; these are written by edge functions (service role)
and read via SECURITY DEFINER RPCs. Just confirm nothing in the client reads them directly. No action
needed.

**If you approve A + B**, I'll enable the toggle note and apply the revoke migration via the Supabase
tools (it's small and reversible).

---

## Suggested order

1. `npm install`, add `VITE_POSTHOG_KEY`, ship → analytics live (fastest win).
2. Enable GitHub secret scanning + push protection (5 min, backs your PII scrub).
3. Approve the Supabase revoke migration + flip on leaked-password protection.
4. Connect ChartMogul to Stripe (no code).
5. Set up Turnstile keys; when ready to enforce, I do the signup one-liner.
6. HubSpot account + thin Zapier sync.
7. Watch CSP Report-Only for a few days, then I promote it to enforced.
