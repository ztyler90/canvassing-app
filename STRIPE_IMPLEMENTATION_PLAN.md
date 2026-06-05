# KnockIQ — Stripe Billing Implementation Plan

This is the code plan for wiring the **14-day reverse trial + per-seat Checkout** billing.
It complements `STRIPE_SETUP.md` (the Stripe dashboard setup). Nothing here is built yet —
it's the blueprint for the dedicated Stripe build.

## The core mismatch to fix first

The existing edge functions sync billing state to **`public.users`**, but the app's tier
gating reads **`organizations.tier`** (and `status`, `trial_ends_at`). So billing identity
and status must live on (or be synced to) the **org**. This is the central change.

---

## 1. Migration — org-level billing columns

New migration `2026XXXX_stripe_org.sql`:

```sql
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status    TEXT,   -- trialing|active|past_due|canceled|unpaid
  ADD COLUMN IF NOT EXISTS billing_interval        TEXT;   -- 'month' | 'year' (optional)
```

`organizations.selected_plan`, `tier`, `status`, and `trial_ends_at` already exist. Keep
the `users` billing columns for now (harmless) but treat the **org** as source of truth.

---

## 2. New Edge Function — `create-checkout-session`

Replaces the Elements-based `create-subscription`. Called from the app **after** the org
exists (the reverse-trial RPC already created it on signup).

Inputs: `{ organization_id, plan: 'standard'|'pro', interval: 'month'|'year', seats }`.

```ts
const PRICE = {
  standard: { month: Deno.env.get('STRIPE_PRICE_STANDARD_MONTHLY'),
              year:  Deno.env.get('STRIPE_PRICE_STANDARD_ANNUAL') },
  pro:      { month: Deno.env.get('STRIPE_PRICE_PRO_MONTHLY'),
              year:  Deno.env.get('STRIPE_PRICE_PRO_ANNUAL') },
};

const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  line_items: [{ price: PRICE[plan][interval], quantity: seats }],
  subscription_data: { trial_period_days: 14 },
  payment_method_collection: 'always',          // card up front
  client_reference_id: organization_id,         // link back to the org
  success_url: `${APP_URL}/manager?billing=success`,
  cancel_url:  `${APP_URL}/manager?billing=cancel`,
});
return { url: session.url };
```

Note: during the **reverse trial** every org runs Pro features regardless of `plan`. The
`plan`/`interval` here just determine what they're billed for at conversion — so pass the
org's `selected_plan`. (Optional: bill everyone the Pro price during trial and downgrade at
conversion — simpler to bill `selected_plan` from the start since the card isn't charged
until day 15 anyway.)

---

## 3. Rewrite `stripe-webhook` to write to the ORG

Switch every `users` update to `organizations`, keyed by `stripe_customer_id`, and add the
checkout handler:

```ts
case 'checkout.session.completed': {
  const s = event.data.object;                  // has client_reference_id + customer + subscription
  await supabase.from('organizations').update({
    stripe_customer_id:     s.customer,
    stripe_subscription_id: s.subscription,
    subscription_status:    'trialing',
  }).eq('id', s.client_reference_id);
  break;
}

case 'customer.subscription.updated': {
  const sub = event.data.object;
  const patch = {
    subscription_status: sub.status,            // trialing | active | past_due | ...
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end*1000).toISOString() : null,
  };
  // On first real activation, drop from the Pro trial down to the chosen plan:
  if (sub.status === 'active') {
    const { data: org } = await supabase.from('organizations')
      .select('selected_plan').eq('stripe_customer_id', sub.customer).single();
    patch.tier   = org?.selected_plan ?? 'standard';
    patch.status = 'active';
  }
  await supabase.from('organizations').update(patch).eq('stripe_customer_id', sub.customer);
  break;
}

case 'customer.subscription.deleted':  // status = 'canceled'
case 'invoice.payment_failed':         // status = 'past_due'
case 'invoice.paid':                   // status = 'active'
```

Key rule: **set `organizations.tier = selected_plan` only when the subscription goes
`active`** (trial converted). During `trialing`, `tier` stays `'pro'` so the trial keeps
full features.

---

## 4. Frontend wiring

- **Signup (`Signup.jsx`):** after `provisionNewOrganization`, call
  `create-checkout-session` with the org id + `selectedPlan` + `interval` (default `month`)
  + seat count (1 owner to start), then `window.location = session.url`.
- **Settings → Billing:** add a **"Manage billing"** button that opens the Stripe
  **Customer Portal** (`stripe.billingPortal.sessions.create`) for plan/seat/card/cancel.
- **Seats:** when a manager adds/removes a rep (`createRep`/`deleteRep`), update the Stripe
  subscription quantity (`stripe.subscriptions.update(subId, { items:[{ id, quantity }] })`),
  or reconcile nightly. v1 can set quantity at checkout and sync on team changes.

---

## 5. Copy + trial-state surfacing

- Flip homepage "no credit card required" → "14-day free trial · cancel anytime before
  you're billed" **at go-live** (not before Checkout exists).
- Show a small trial banner in the app: "Pro trial — N days left" using
  `organizations.trial_ends_at`, with a link to add billing / manage plan.

---

## 6. Test checklist (Test mode)

- [ ] Checkout completes with `4242…`; org gets `stripe_customer_id` + `trialing`.
- [ ] Org `tier='pro'`, `selected_plan` correct, `trial_ends_at` ~14 days out.
- [ ] "End trial now" in Stripe → webhook sets `status='active'` and `tier=selected_plan`.
- [ ] Standard-intent org drops to Standard features after conversion (gating kicks in).
- [ ] Failed payment (`4000 0000 0000 0341`) → `past_due`.
- [ ] Customer Portal cancel → `canceled`.
- [ ] Adding/removing a rep updates the subscription quantity.

---

## Out of scope (later)

- Enterprise self-serve (stays sales-led / contact form).
- Proration UX, dunning emails, tax (Stripe Tax), annual→monthly switch edge cases.
