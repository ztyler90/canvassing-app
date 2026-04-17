# KnockIQ — Stripe Billing Setup Guide

This guide walks you from zero Stripe account to live 7-day trial billing.
Estimated time: ~30 minutes.

---

## 1. Create a Stripe account

1. Go to [stripe.com](https://stripe.com) and sign up.
2. Complete identity verification (required before going live).
3. In the Stripe Dashboard, switch to **Test mode** first (toggle top-right).
   You'll use test keys locally; swap to live keys when ready to charge real cards.

---

## 2. Create a Product and Price

1. Dashboard → **Product catalog** → **+ Add product**
2. Fill in:
   - **Name**: KnockIQ Pro (or whatever you like)
   - **Pricing model**: Standard pricing
   - **Price**: $60 / month  (or your chosen amount)
   - **Billing period**: Monthly
3. Click **Save product**.
4. On the product page, copy the **Price ID** — it looks like `price_1AbCdEfGhIjKlMnO`.

---

## 3. Configure environment variables

### Frontend (Vite)

Copy `.env.example` → `.env` and fill in:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...   ← from Dashboard > Developers > API Keys
```

### Supabase Edge Function secrets

These are set via the Supabase CLI and are **never** in `.env` files:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_PRICE_ID=price_1AbCdEfGhIjKlMnO
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...  # set this after step 5
```

You can also set secrets in the Supabase Dashboard under
**Project Settings → Edge Functions → Secrets**.

---

## 4. Install the Supabase CLI and link your project

```bash
# Install (macOS)
brew install supabase/tap/supabase

# Install (npm, any platform)
npm install -g supabase

# Log in
supabase login

# Link to your project (find the project ref in Settings > General)
supabase link --project-ref your-project-ref
```

---

## 5. Deploy the Edge Functions

```bash
# From the canvassing-app root:
supabase functions deploy create-subscription
supabase functions deploy stripe-webhook
```

After deploying, the functions are live at:
```
https://your-project-id.supabase.co/functions/v1/create-subscription
https://your-project-id.supabase.co/functions/v1/stripe-webhook
```

---

## 6. Configure the Stripe webhook

1. Stripe Dashboard → **Developers** → **Webhooks** → **+ Add endpoint**
2. **Endpoint URL**: `https://your-project-id.supabase.co/functions/v1/stripe-webhook`
3. **Events to listen for** — select these:
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.payment_succeeded`
4. Click **Add endpoint**.
5. On the webhook detail page, click **Reveal** under *Signing secret*.
6. Copy the `whsec_...` value and set it as a secret:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```

---

## 7. Run the database migration

In your Supabase Dashboard → **SQL Editor**, paste and run the contents of:
```
supabase/migrations/20260412_billing.sql
```

This makes `phone` nullable and adds the `stripe_customer_id`,
`stripe_subscription_id`, `subscription_status`, and `trial_ends_at` columns.

Alternatively, if you're using the Supabase CLI with local dev:
```bash
supabase db push
```

---

## 8. Test the full flow

1. Start the dev server: `npm run dev`
2. Go to the Sign Up tab.
3. Use a [Stripe test card](https://stripe.com/docs/testing#cards):
   - **Success**: `4242 4242 4242 4242`
   - **Decline**: `4000 0000 0000 0002`
   - Any future expiry, any CVC, any ZIP
4. Complete signup → you should be logged in automatically.
5. In Stripe Dashboard → Customers, confirm the customer + subscription were created with `trialing` status.
6. In Supabase → Table Editor → `users`, confirm `stripe_customer_id` and `trial_ends_at` are populated.

---

## 9. Go live

1. In Stripe Dashboard, **Activate your account** (complete verification if not done).
2. Switch to **Live mode**.
3. Grab your live keys (`pk_live_...`, `sk_live_...`).
4. Create a new live Product + Price (same as step 2, in live mode).
5. Update:
   - `.env` → `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...`
   - Supabase secrets:
     ```bash
     supabase secrets set STRIPE_SECRET_KEY=sk_live_...
     supabase secrets set STRIPE_PRICE_ID=price_live_...
     ```
6. Create a new live webhook endpoint (same as step 6, live mode) and update `STRIPE_WEBHOOK_SECRET`.
7. Redeploy the Edge Functions: `supabase functions deploy --all`
8. Redeploy the frontend to Vercel: `vercel --prod`

---

## Architecture summary

```
Browser (signup form)
  │
  ├─ stripe.createPaymentMethod()  ← card tokenised client-side, never touches your server
  │
  └─ supabase.functions.invoke('create-subscription', { email, password, full_name, payment_method_id })
       │
       ├─ stripe.customers.create()
       ├─ stripe.subscriptions.create({ trial_period_days: 7 })
       ├─ supabase.auth.admin.createUser()   ← user created AFTER payment method is valid
       └─ users table updated with stripe_customer_id, trial_ends_at

Stripe (async)
  └─ stripe-webhook Edge Function
       ├─ customer.subscription.updated  → sync subscription_status
       ├─ customer.subscription.deleted  → mark canceled
       ├─ invoice.payment_failed         → mark past_due
       └─ invoice.payment_succeeded      → mark active
```

**Key design decisions:**
- Card is collected and validated before the Supabase user is created.
  If the card is invalid, no account is left in a broken state.
- `trial_period_days: 7` means the card is never charged during the trial.
- The Supabase user is created with `email_confirm: true` (skips confirmation email)
  so users can sign in immediately after signup.
- If Supabase user creation fails after Stripe setup, the Stripe subscription is
  rolled back automatically inside the Edge Function.
