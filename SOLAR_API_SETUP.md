# Roof Insights (Google Solar API) — Setup

Pro-tier feature. Adds a **Roof insights** panel to the rep door-logging modal
and the manager lead-detail view, showing four signals pulled from Google's
Solar *Building Insights* data:

| Signal | What it tells the rep | Source field |
|---|---|---|
| **Roof size** (ft² + Small/Medium/Large) | Job-size proxy for washing/gutters | `wholeRoofStats.areaMeters2` |
| **Facets** (# + Simple/Moderate/Complex) | Roofline complexity → time + price | `roofSegmentStats.length` |
| **Pitch** (° + Low/Moderate/Steep) | Difficulty + ladder/harness safety flag | area-weighted `pitchDegrees` |
| **Sun** (hrs/yr + Low/Good/Excellent) | Sun exposure / solar potential | `maxSunshineHoursPerYear` |

Standard-tier orgs see a **locked teaser** that opens the existing Pro upgrade
modal — no Google call is ever made for them.

### Per-org toggle (cost control)

Roof Insights is **off by default for every org** (`organizations.roof_insights_enabled = false`).
A manager turns it on under **Settings → Roof Insights** (Pro only — Standard
managers see an "Upgrade" button instead). Until a Pro org switches it on, the
panel renders nothing and **no Solar API call is ever made** — so teams that
don't care about roof data cost you $0. The gate is `isProTier(org) && org.roof_insights_enabled`
(see `src/lib/tier.js` → `isRoofInsightsEnabled`).

---

## How it works (same pattern as `geocode`)

1. The app (Pro only) calls the **`solar` Edge Function** with the door's
   `lat`/`lng`.
2. The function checks the **`solar_cache`** table first. Roof geometry is
   static, so a cached hit is good forever — re-canvassed streets cost nothing.
   Misses are negative-cached too (rural / new-build addresses with no Solar
   coverage), so we never re-bill Google for a known-empty address.
3. On a miss it calls Google `buildingInsights:findClosest`, parses the result
   into the four rep-friendly signals, stores it, and returns it.

The Google key lives in a Supabase secret — never in the web bundle or the
native app.

---

## Deploy steps

### 1. Apply the migration (creates `solar_cache`)

```bash
supabase db push
# or run supabase/migrations/20260606_solar_cache.sql in the SQL editor
```

### 2. Enable the Solar API on your Google key

In Google Cloud Console → **APIs & Services → Library → Solar API → Enable**,
on the same project as your existing geocoding key.

> **Pricing:** Building Insights = **10,000 free calls/month**, then **$10 per
> 1,000 (~$0.01 each)**. With caching, a small org typically stays inside the
> free tier. (We deliberately use **only** Building Insights — the imagery
> "Data Layers" SKU is $75/1,000 and not needed here.)

### 3. Set the secret

You can reuse your existing geocoding key (if the Solar API is enabled on it) —
the function falls back to `GOOGLE_GEOCODING_KEY` automatically. To use a
dedicated, separately-quota-capped key (recommended so a Solar spike can't
exhaust geocoding budget):

```bash
supabase secrets set GOOGLE_SOLAR_KEY=your_key_here
```

### 4. Deploy the function

```bash
supabase functions deploy solar
```

`verify_jwt` defaults to `true`, so only signed-in users can call it — no
`config.toml` change needed (matches `geocode`).

---

## Cost control knobs

- **Caching is automatic** and permanent per building (`solar_cache`).
- The panel only fetches for **Pro orgs**, and only when a door/lead with
  coordinates is opened.
- Cap spend in Google Cloud → **Maps Platform → Quotas → Solar API Building
  Insights** (set a daily request ceiling).
- Track reuse: `select count(*), sum(hits), sum(google_requests) from solar_cache;`
  — `hits` are free reuses, `google_requests` are the billed calls.

---

## Files added / changed

**Added**
- `supabase/migrations/20260606_solar_cache.sql` — cache table (RLS-locked)
- `supabase/migrations/20260606_roof_insights_toggle.sql` — `organizations.roof_insights_enabled` (default false)
- `supabase/functions/solar/index.ts` — proxy + cache + parser
- `src/lib/solar.js` — client fetch helper
- `src/components/RoofInsights.jsx` — Pro-gated, toggle-gated panel

**Changed**
- `src/lib/tier.js` — `isRoofInsightsEnabled(org, user)` helper
- `src/lib/supabase.js` — `getPipelineLeads` selects `lat, lng`; `setOrgRoofInsightsEnabled()` toggle writer
- `src/components/PipelineTab.jsx` — passes `isPro` + `roofEnabled` to `LeadDetailModal`
- `src/components/LeadDetailModal.jsx` — renders the panel under the address
- `src/components/InteractionModal.jsx` — renders the panel in the details step
- `src/screens/Settings.jsx` — manager on/off toggle (Pro add-on, default off)
