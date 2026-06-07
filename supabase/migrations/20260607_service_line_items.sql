-- ─────────────────────────────────────────────────────────────────────────────
-- Itemized estimate line items
-- ─────────────────────────────────────────────────────────────────────────────
-- Reps can now build an itemized estimate at the door: pick a service, type a
-- price, repeat. The per-service breakdown is stored here as structured JSON so
-- a manager can hand it straight to their CRM when building the formal proposal.
--
-- Shape: a JSON array of { "service": <label>, "price": <number> } objects, in
-- the order the rep entered them, e.g.
--   [{"service":"Window Cleaning","price":250},{"service":"Gutter Guards","price":900}]
--
-- The single `estimated_value` column is still the source of truth for the deal
-- total (goals / commission / reporting). When a rep uses itemized mode the app
-- writes the SUM of the line items into estimated_value, so existing consumers
-- need no changes — service_line_items is purely the optional breakdown.
--
-- Nullable + no default: a NULL value means "no itemization" (the rep used the
-- single estimated-value field, or it's a pre-existing row). Additive and
-- non-destructive — safe to apply on a live database.

alter table public.interactions
  add column if not exists service_line_items jsonb;

alter table public.bookings
  add column if not exists service_line_items jsonb;

comment on column public.interactions.service_line_items is
  'Optional itemized estimate: JSON array of {service, price}. estimated_value holds the sum.';
comment on column public.bookings.service_line_items is
  'Optional itemized estimate: JSON array of {service, price}. estimated_value holds the sum.';
