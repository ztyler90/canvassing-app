# Rep Onboarding

When a manager adds a rep in Settings → Team, they now choose one of two
onboarding methods with the segmented control at the top of the Add Rep
form:

- **Email Invite** — KnockIQ emails the rep a one-time invite link; they
  set their own password on first load. No credential is ever handled by
  the manager. **Requires Resend to be configured** (see below).
- **Temp Password** — the manager sets a temporary password in the form
  (or clicks *Generate* for a readable two-word one), the edge function
  creates the auth user directly, and the manager is shown the
  credentials once with a pre-filled **Text Rep** SMS link. On first
  sign-in the rep is force-routed to `/set-password` to pick their own.
  Useful when email isn't wired up yet, or for reps who aren't
  reliable email users.

Both flows persist the new optional **Phone** field on `public.users`
so the temp-password confirmation panel can deep-link straight into the
manager's SMS app.

The rest of this doc covers the production secrets and DNS needed for
the **Email Invite** path — the Temp Password path needs no email
configuration.

## How the email-invite flow works

1. **Manager clicks "Add Rep"** in Settings → Team → fills in name + email.
2. The client calls the `manage-team` edge function with `action: 'create'`.
3. The edge function runs (with the service-role key):
   - `supabase.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: '${APP_BASE_URL}/set-password', data: { full_name, role: 'rep' } } })`
     — creates an **invited** auth user (unconfirmed, no password) and
     returns a one-time `action_link`.
   - Inserts a `public.users` row stamped with the manager's `organization_id`.
   - POSTs a branded HTML + text email to Resend
     (`POST https://api.resend.com/emails`) with the action link embedded
     in a single CTA button.
4. **Rep clicks the link in the email.** GoTrue verifies the token,
   establishes a session, and redirects to `/set-password#access_token=…`.
5. **SetPassword screen** (`src/screens/SetPassword.jsx`) waits for the
   Supabase client's `detectSessionInUrl` to land the session, then shows
   a password form. `supabase.auth.updateUser({ password })` saves it.
6. The rep lands on RepHome (role `rep`, session live).

The response from `create` includes `{ email_sent, email_error }` so the
Settings UI can show a partial-failure toast when the rep was created but
the email couldn't be delivered (key missing, domain unverified, etc.).

A sibling action, `resend_invite`, regenerates a **magic-link** style
action link (not an invite — that errors on already-registered users) and
re-sends the welcome email. The Settings team list exposes it as the
paper-airplane icon next to each rep.

## Required Supabase secrets

All three of these need to be set on the `manage-team` function in the
Supabase dashboard → Edge Functions → Secrets (or via `supabase secrets set`
locally):

| Secret          | Example                                  | Purpose                                                                                             |
| --------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY` | `re_xxxxxxxxxxxxxxxxxxxx`                | Your Resend API key. Create one at https://resend.com/api-keys.                                     |
| `RESEND_FROM`   | `KnockIQ <onboarding@knockiq.com>`       | The "From" address. Domain **must** be verified in Resend (DNS SPF + DKIM). Defaults to Resend's shared `onboarding@resend.dev` if unset — fine for testing, not acceptable in production. |
| `APP_BASE_URL`  | `https://app.knockiq.com`                | Where the invite link sends the rep. Must match the deployed front-end origin so GoTrue's `redirectTo` is accepted. Defaults to `https://app.knockiq.com`. |

The edge function also uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`,
which Supabase injects automatically — you don't set those yourself.

### Setting the secrets via dashboard

1. Open the project → **Edge Functions** → `manage-team` → **Secrets**.
2. Add each of the three above. Save.
3. The function picks them up on the next cold start; you don't need to
   redeploy.

### Setting the secrets via CLI

```bash
supabase secrets set \
  RESEND_API_KEY='re_xxxxxxxxxxxxxxxxxxxx' \
  RESEND_FROM='KnockIQ <onboarding@knockiq.com>' \
  APP_BASE_URL='https://app.knockiq.com'
```

## Supabase Auth config

In Supabase → **Authentication** → **URL Configuration**, add
`${APP_BASE_URL}/set-password` (e.g. `https://app.knockiq.com/set-password`)
to the **Redirect URLs** allowlist. Without this, GoTrue will refuse the
`redirectTo` passed by `generateLink` and the invite link will bounce the
rep to the default Site URL instead of `/set-password`.

While you're there, confirm **Site URL** is set to your production origin
(`https://app.knockiq.com`) — it's the fallback when a `redirectTo` isn't
provided.

## Resend domain verification

Resend won't deliver from a sender unless the sending domain is verified.
For production:

1. Resend dashboard → **Domains** → **Add Domain** → enter the domain on
   your `RESEND_FROM` (e.g. `knockiq.com`).
2. Add the SPF + DKIM DNS records Resend shows you. They auto-verify
   within 5–15 minutes once DNS propagates.
3. Until the domain is verified you can keep `RESEND_FROM` pointed at the
   shared `onboarding@resend.dev` sandbox sender — deliverability will be
   poor (most inboxes flag it) but the invite flow works end-to-end for
   internal testing.

## Deploying the edge function

```bash
# From the project root
supabase functions deploy manage-team --verify-jwt
```

or via Claude / the Supabase MCP's `deploy_edge_function` tool (the path
we use from this repo).

## Troubleshooting

| Symptom                                                   | Likely cause                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Toast says *"added, but we couldn't send the invite"*     | `RESEND_API_KEY` unset, or Resend 4xx'd. Check the function's logs in Supabase → Edge Functions → Logs.          |
| Rep clicks the link and lands on a blank/"invalid token"  | `redirectTo` URL not in Auth → URL Configuration → Redirect URLs. Add `${APP_BASE_URL}/set-password` and retry.  |
| Email lands in spam                                       | Sending from the shared `resend.dev` domain. Verify your real domain and update `RESEND_FROM`.                  |
| Link expired (rep opens it > 24 h after send)             | Manager clicks the paper-airplane icon next to the rep in Settings → Team to send a fresh magic-link.            |
| "Forbidden: owner role required"                          | Caller's `users.role` is not `manager`. Super-admins bypass this only on `delete`/`resend_invite` via same-org checks. |

## Temp Password flow (no email required)

Use this when Resend isn't set up yet, or you simply want to text the
credentials to a rep. Mechanics:

1. **Manager picks "Temp Password"** in Settings → Add Rep, types (or
   generates) a password, optionally fills in the rep's phone.
2. `manage-team` edge function calls
   `supabase.auth.admin.createUser({ email, password, email_confirm: true })`
   — the `email_confirm: true` skips the email-verification step so the
   rep can sign in immediately.
3. The function upserts `public.users` with
   `force_password_change = true` and the phone number.
4. The UI shows a one-time **credentials panel** with copy buttons and a
   pre-filled `sms:` deep-link (populated with the rep's phone if one
   was entered). Dismissing the panel is permanent — the password
   isn't stored in plaintext server-side.
5. The rep signs in on `/login` with the temp password. `AppRoutes`
   sees `force_password_change = true` on their profile and funnels
   every route to `/set-password`.
6. After `supabase.auth.updateUser({ password })` succeeds,
   `SetPassword.jsx` clears the `force_password_change` flag. Subsequent
   logins go straight to RepHome.

Security notes:
- The temp password is the rep's password until they sign in — treat
  it the way you'd treat any shared credential (prefer SMS over email
  or group chat).
- The force-change flag makes it single-use in practice, so even if
  the SMS is snooped after the rep logs in, the credential is dead.
- The edge function rejects temp passwords under 8 characters. The
  `Generate` button produces a 14-char word-word-digits password.

## Files involved

- `supabase/functions/manage-team/index.ts` — the edge function
  (invite + temp-password modes)
- `supabase/migrations/20260420_rep_invite_alternatives.sql` — adds
  `users.phone` (nullable) and `users.force_password_change`
- `src/screens/SetPassword.jsx` — password-set screen; clears the
  force-change flag after save
- `src/screens/Settings.jsx` — Add Rep form (mode toggle, phone,
  password generator) + credentials panel
- `src/lib/supabase.js` — `createRep` / `resendRepInvite` client wrappers
- `src/contexts/AuthContext.jsx` — profile now exposes
  `force_password_change` and `phone`
- `src/App.jsx` — `/set-password` route + the force-change gate that
  blocks every other route until the rep rotates the temp password
