# KnockIQ — Stripe Billing Setup Guide

This guide takes you from zero Stripe account to a live **14-day reverse trial** with
**per-seat** billing across the **Standard** and **Pro** plans, using **Stripe Checkout**
(hosted) + the **Customer Portal**. Estimated dashboard time: ~30 minutes.

> Billing model recap
> - **Reverse trial:** every signup gets full **Pro** for 14 days, then converts to the
>   plan they selected at signup (`organizations.selected_plan`).
> - **Card up front:** the card is collected at signup and auto-charged on day 15.
> - **Per seat:** the subscription quantity = number of reps in the org.
> - **Enterprise is sales-led** — no self-serve price needed.

---

## 1. Create your Stripe account (start in Test mode)

1. Go to [stripe.com](https://stripe.com) → **Sign up**. Use a business email.
2. You do **not** need to finish identity/bank verification to begin — Stripe gives you
   **test** API keys immediately. Build and test everything in **Test mode** first
   (toggle is top-right of the dashboard). Only activate + switch to **Live** when you're
   ready to charge real cards.
3. While you're in there, set the basics under **Settings → Business**:
   - **Public business name** and **support email** (shown on receipts).
   - **Statement descriptor** (what appears on customers' card statements, e.g. `KNOCKIQ`).
   - **Branding** (logo + brand color) — this themes Checkout and the Customer Portal.

---

## 2. Create the Products and Prices (2 products → 4 prices)

Dashboard → **Product catalog → + Add product**. Create **two** products, each with a
**monthly** and an **annual** recurring price. The 20% annual discount is baked into the
annual price (cleaner than a coupon).

**Product: KnockIQ Standard**
- Price 1 — **$25.00 / month**, recurring, "per seat" (see note below) → label it `Standard Monthly`
- Price 2 — **$240.00 / year**, recurring, per seat → label it `Standard Annual` (= $20/mo equiv)

**Product: KnockIQ Pro**
- Price 3 — **$50.00 / month**, recurring, per seat → label it `Pro Monthly`
- Price 4 — **$480.00 / year**, recurring, per seat → label it `Pro Annual` (= $40/mo equiv)

**"Per seat" note:** choose pricing model **Standard pricing → Per unit**, and the
subscription will multiply the price by the **quantity** (number of seats) we pass at
checkout. Leave "Usage is metered" **off** (this is licensed/seat-based, not usage-based).

After saving, copy each **Price ID** (`price_…`). You'll need all four.

**✅ Created (LIVE mode) on 2026-06-05 — account `acct_1TenZrPhaKH0vmLV` "KnockIQ":**

```
# Products
KnockIQ Standard = prod_Ue5zf7pOsLP6iV
KnockIQ Pro      = prod_Ue63f2kJPQs6vI

# Prices (LIVE)
STRIPE_PRICE_STANDARD_MONTHLY = price_1TenrDPhaKH0vmLVmlSW8QNa   # $25/seat/mo
STRIPE_PRICE_STANDARD_ANNUAL  = price_1TenrEPhaKH0vmLVCS4IBzn9   # $240/seat/yr ($20/mo)
STRIPE_PRICE_PRO_MONTHLY      = price_1TenrKPhaKH0vmLVtQ7YskFd   # $50/seat/mo
STRIPE_PRICE_PRO_ANNUAL       = price_1TenrLPhaKH0vmLV06gvscbE   # $480/seat/yr ($40/mo)
```

> ⚠️ These are **LIVE** price IDs. They work only with live (`sk_live_…`) keys. To test the
> checkout/trial flow with test cards you'll need to recreate the same 4 prices in **Test
> mode** and use those `price_…` IDs with `sk_test_…` keys during development.

> Do **not** set the free trial on the price. We set the 14-day trial at the Checkout
> Session level so it stays flexible.

---

## 3. Enable the Customer Portal

Dashboard → **Settings → Billing → Customer portal**:
- Allow customers to **update payment method**, **cancel**, and **view invoices**.
- Allow **plan switching** between your four prices (Standard ↔ Pro, monthly ↔ annual).
- Allow **quantity changes** if you want managers to self-serve seat counts (optional —
  we can also manage seats from the app).
- Save. This gives you self-serve billing management with zero extra code.

---

## 4. Get your API keys

Dashboard → **Developers → API keys** (make sure you're in **Test mode**):
- **Publishable key** `pk_test_…` → frontend only.
- **Secret key** `sk_test_…` → server/Edge Functions only. Never ship this to the browser.

---

## 5. Configure environment variables

### Frontend (Vite) — `.env`
```
VITE_SUPABASE_URL=https://mcwspvhihekhkytfxggv.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### Supabase Edge Function secrets (never in .env)
Set via the dashboard (**Project Settings → Edge Functions → Secrets**) or CLI:
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_PRICE_STANDARD_MONTHLY=price_...
supabase secrets set STRIPE_PRICE_STANDARD_ANNUAL=price_...
supabase secrets set STRIPE_PRICE_PRO_MONTHLY=price_...
supabase secrets set STRIPE_PRICE_PRO_ANNUAL=price_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...   # from step 7

# Keep-warm price for the off-season "Pause account" flow. Already created in
# the KnockIQ Stripe account ($5.00/mo, "KnockIQ Keep-Warm (Paused)"):
supabase secrets set STRIPE_PRICE_KEEPWARM=price_1Teo3NPhaKH0vmLVLRszoN6O
```

> **Pause / keep-warm billing (manage-team Edge Function).** When an owner
> pauses their account (Settings → Manage subscription → Pause), `manage-team`
> swaps their subscription onto `STRIPE_PRICE_KEEPWARM` at quantity 1 and
> snapshots the previous per-seat price + seat count onto
> `organizations.pause_prev_price_id` / `pause_prev_quantity`. Reactivating
> restores that exact plan; cancelling sets `cancel_at_period_end`; permanent
> delete cancels the subscription outright. Every one of these degrades to a
> status-only change if `STRIPE_SECRET_KEY` / `STRIPE_PRICE_KEEPWARM` are unset
> or the org has no subscription yet — so the access controls work even before
> the checkout flow above goes live. The dollar figure shown in the pause UI
> comes from `organizations.pause_fee_cents` (default **500** = $5); keep it in
> sync if you ever change the keep-warm price. Reading the owner's
> `stripe_subscription_id` from `public.users` is a temporary bridge — move it
> to `organizations.*` when the org-level billing migration (step 8) lands.

---

## 6. Deploy the Edge Functions

> ⚠️ The current `create-subscription` and `stripe-webhook` functions are written for the
> **old** model (Stripe Elements, single price, 7-day trial, syncing to `users`). They are
> being rewritten for Checkout + 14-day trial + org-level sync — see
> `STRIPE_IMPLEMENTATION_PLAN.md`. Deploy after that rewrite lands.

```bash
brew install supabase/tap/supabase      # or: npm install -g supabase
supabase login
supabase link --project-ref mcwspvhihekhkytfxggv
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

---

## 7. Configure the Stripe webhook

1. Dashboard → **Developers → Webhooks → + Add endpoint**.
2. **Endpoint URL:**
   ```
   https://mcwspvhihekhkytfxggv.supabase.co/functions/v1/stripe-webhook
   ```
3. **Events to send:**
   - `checkout.session.completed`   ← links the new customer/subscription to the org
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid` (or `invoice.payment_succeeded`)
   - `invoice.payment_failed`
4. **Add endpoint**, then **Reveal** the signing secret (`whsec_…`) and set it:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```

---

## 8. Run the billing migrations

The earlier billing columns already exist (`20260412_billing.sql`). The Stripe build adds
org-level billing identifiers — see `STRIPE_IMPLEMENTATION_PLAN.md` (a `*_stripe_org.sql`
migration moving/duplicating `stripe_customer_id`, `stripe_subscription_id`,
`subscription_status`, `trial_ends_at` onto `organizations`, since tier gating reads the
org, not the user).

---

## 9. Test the full flow (Test mode)

1. `npm run dev`, go to the pricing page, click **Start free trial** on Standard or Pro.
2. On Stripe Checkout, use a [test card](https://stripe.com/docs/testing#cards):
   `4242 4242 4242 4242`, any future expiry, any CVC/ZIP.
3. Complete checkout → you're returned to the app, logged in, org on a **14-day Pro trial**.
4. In Stripe → **Customers**, confirm a customer + subscription in **`trialing`** status
   with quantity = seats.
5. In Supabase → `organizations`, confirm `stripe_customer_id`, `trial_ends_at`, and
   `selected_plan` are populated and `tier = 'pro'`.
6. To test conversion without waiting 14 days, in Stripe open the subscription → **Actions
   → End trial now**; the webhook should flip the org to `active` and set `tier` to its
   `selected_plan`.

---

## 10. Go live

1. **Activate** your Stripe account (finish identity + bank verification).
2. Switch to **Live mode**, recreate the 4 products/prices (live IDs differ).
3. Swap all keys/price IDs/webhook secret to their `*_live` / live values (frontend `.env`
   + Supabase secrets), recreate the live webhook endpoint.
4. Redeploy: `supabase functions deploy --all` and `vercel --prod`.
5. Flip the homepage trial copy from "no credit card required" to
   "14-day free trial · cancel anytime before you're billed."

---

## Architecture (target)

```
Pricing page  ──/signup?plan=standard|pro──▶  Signup (creates user + org via reverse-trial RPC)
      │
      └─▶  create-checkout-session Edge Function
              ├─ stripe.checkout.sessions.create({
              │     mode: 'subscription',
              │     line_items: [{ price: <plan+interval price>, quantity: seats }],
              │     subscription_data: { trial_period_days: 14 },
              │     payment_method_collection: 'always',
              │     client_reference_id: <organization_id>,
              │   })
              └─ returns Checkout URL → browser redirects to Stripe

Stripe (async)  ──▶  stripe-webhook Edge Function (writes to ORGANIZATIONS)
   checkout.session.completed   → store stripe_customer_id + subscription_id on the org
   customer.subscription.updated→ sync status + trial_ends_at; on active, set tier = selected_plan
   customer.subscription.deleted→ status = canceled
   invoice.payment_failed       → status = past_due
   invoice.paid                 → status = active
```

Key decisions:
- **Checkout (hosted)** over custom Elements — Stripe handles PCI, and the Customer Portal
  covers plan/seat/card management for free.
- Trial is 14 days, set on the Checkout session, card collected up front.
- The webhook writes to **`organizations`** because that's where tier gating reads.
- At conversion, tier is set from **`selected_plan`** so Standard-intent orgs downgrade
  out of the Pro trial automatically.
