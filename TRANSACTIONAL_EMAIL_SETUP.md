# Transactional Email Setup

KnockIQ sends all transactional mail through **Resend** (the same provider the
rep-invite flow already used). This doc covers what was added, how each email
fires, and the one-time config/deploy steps to make them live in production.

Everything reuses the **existing** `RESEND_API_KEY`, `RESEND_FROM`, and
`APP_BASE_URL` secrets — there are **no new secrets** to set. See
`ONBOARDING_EMAIL_SETUP.md` for how to obtain and set those.

---

## What's in place now

| Email | Trigger | Sent by | Branding |
| --- | --- | --- | --- |
| **Confirm signup** | New self-serve signup | Supabase Auth (GoTrue) | `supabase/templates/confirmation.html` |
| **Password reset** | `resetPasswordForEmail` (Forgot password) | Supabase Auth (GoTrue) | `supabase/templates/recovery.html` |
| **Welcome** | Owner finishes signup + org provision | `send-welcome` edge fn | `_shared/email.ts` layout |
| **Closer onboarding** | A closer (contact or platform) is added | `send-closer-onboarding` edge fn | `_shared/email.ts` layout |
| Rep invite *(existing)* | Manager adds a rep | `manage-team` edge fn | refactored onto `_shared/email.ts` |
| Lead handoff *(existing)* | Hot lead assigned to a closer | `notify-closer` edge fn | refactored onto `_shared/email.ts` |

All six now share one sender path and one visual language. The shared layout,
the Resend POST, and the HTML escaping live in **one place**:
`supabase/functions/_shared/email.ts`.

---

## 1. Branded auth emails (confirm signup + password reset)

These are GoTrue (Supabase Auth) emails, so they're configured **two** ways and
both must be kept in sync:

### a) Local dev + `config push` — already wired
`supabase/config.toml` now points GoTrue at the branded HTML:

```toml
[auth.email.template.confirmation]
subject = "Confirm your KnockIQ account"
content_path = "./supabase/templates/confirmation.html"

[auth.email.template.recovery]
subject = "Reset your KnockIQ password"
content_path = "./supabase/templates/recovery.html"
```

### b) Hosted project — paste into the dashboard (required)
`config.toml` templates apply locally and on `supabase config push`. The hosted
project's auth emails live in the dashboard and **do not** auto-update from the
repo. To brand production:

1. Supabase dashboard → **Authentication → Email Templates**.
2. Open **Confirm signup**, set the subject to `Confirm your KnockIQ account`,
   and paste the full contents of `supabase/templates/confirmation.html`.
3. Open **Reset password**, set the subject to `Reset your KnockIQ password`,
   and paste the full contents of `supabase/templates/recovery.html`.
4. Save each.

> The templates use GoTrue variables `{{ .ConfirmationURL }}` and `{{ .Email }}`.
> Keep the dashboard copy and the repo files in sync — the repo files are the
> source of truth.

**Redirect URLs:** make sure your app origins are in Auth → URL Configuration →
Redirect URLs (the recovery link sends users to `${origin}/`, and signup
confirmation returns to the Site URL). These are already set for the rep-invite
flow.

---

## 2. App-triggered emails (welcome + closer onboarding)

Two new edge functions, both following the `manage-team` security pattern:
`verify_jwt = false` at the runtime layer (so the ES256 pre-verifier doesn't
401 valid tokens), then in-function auth via `adminClient.auth.getUser(token)`.

### Deploy
```bash
supabase functions deploy send-welcome
supabase functions deploy send-closer-onboarding
```
(or via the Supabase MCP `deploy_edge_function` tool, which is how this repo
normally ships functions.)

Both read `RESEND_API_KEY`, `RESEND_FROM`, and `APP_BASE_URL` from the same
secrets the other functions use. If `RESEND_API_KEY` is unset, they no-op
gracefully (`sent: false`) instead of erroring — the triggering action still
succeeds.

### How they fire

- **Welcome** — `src/screens/Signup.jsx` calls `sendWelcomeEmail()` (best-effort,
  not awaited) right after `provisionNewOrganization` + sign-in. The function
  emails the **caller's own** address — no caller-supplied recipient, so it
  can't be used to mail arbitrary people.

- **Closer onboarding** — `createCloserContact()` in `src/lib/supabase.js` calls
  `sendCloserOnboarding({ tier: 'contact', id })` after inserting a new
  email-only closer. The function verifies the caller is a manager (or
  super-admin) in the **same org** as the closer before sending.
  - The wrapper also supports `tier: 'platform'` for `role='closer'` platform
    users. Platform closers currently already receive the **rep-invite** email
    (which handles their password setup), so we don't double-send by default —
    but you can call `sendCloserOnboarding({ tier: 'platform', id })` anywhere a
    closer-specific orientation email is wanted.

---

## 3. The shared module (`_shared/email.ts`)

One toolkit for every email:

- `sendEmail({ to, subject, html, text, replyTo? })` — Resend POST. Never throws;
  returns `{ ok, error?, id? }`.
- `brandedEmail(opts)` / `brandedText(opts)` — the KnockIQ shell (blue header,
  white card, CTA button, footer). Handles all HTML escaping internally.
- `escapeHtml` / `escapeAttr` — for functions (like `manage-team`) that keep a
  bespoke body but still need escaping.
- `firstNameGreeting(fullName)` — `"Hey Mike,"` / `"Hey there,"`.

`manage-team` and `notify-closer` were refactored onto this module. The
rep-invite body intentionally keeps its richer custom layout (the "What is
KnockIQ?" explainer); only its transport + escaping moved to the shared module,
so that email looks exactly as before.

---

## Logo in the header

Every email header shows the white KnockIQ wordmark (`public/logo-white.png`)
on the blue bar, with `alt="KnockIQ"` text as a fallback if a client blocks
images.

The image is referenced by **absolute https URL** (email clients can't resolve
relative paths):

- **Edge-function emails** (welcome, closer onboarding, lead handoff, rep
  invite) build it from `APP_BASE_URL` → `${APP_BASE_URL}/logo-white.png`, so it
  automatically tracks whatever origin is deployed.
- **Static auth templates** (confirm signup, password reset) hardcode
  `https://app.knockiq.com/logo-white.png` since GoTrue templates have no env.

> **Make sure that URL is publicly reachable.** `logo-white.png` lives in the
> app's `public/` folder, so it ships to the app origin on deploy. After
> deploying, open `https://app.knockiq.com/logo-white.png` in a browser to
> confirm it 200s. If your app is served from a different origin, update
> `APP_BASE_URL` (edge functions) and the two static templates' `<img src>`
> accordingly. The `alt="KnockIQ"` text means a wrong/blocked URL degrades to
> the brand name rather than a broken-image icon.

## Previewing the templates

Rendered samples (open in a browser) live in
`supabase/templates/_previews/`:

- `preview-confirmation.html`, `preview-recovery.html` — auth emails
- `preview-welcome.html` — owner welcome
- `preview-closer-platform.html`, `preview-closer-contact.html` — closer onboarding
- `preview-lead.html` — the refactored lead-handoff email

These are throwaway renders for review (not used at runtime) and safe to delete.

---

## Files touched

**New**
- `supabase/functions/_shared/email.ts`
- `supabase/functions/send-welcome/index.ts`
- `supabase/functions/send-closer-onboarding/index.ts`
- `supabase/templates/confirmation.html`
- `supabase/templates/recovery.html`

**Edited**
- `supabase/config.toml` — auth email templates + verify_jwt for the new fns
- `supabase/functions/manage-team/index.ts` — refactored onto `_shared/email.ts`
- `supabase/functions/notify-closer/index.ts` — refactored onto `_shared/email.ts`
- `src/lib/supabase.js` — `sendWelcomeEmail()`, `sendCloserOnboarding()`, and the
  `createCloserContact` onboarding hook
- `src/screens/Signup.jsx` — fires the welcome email after provisioning
