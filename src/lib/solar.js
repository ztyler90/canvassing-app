/**
 * Roof insights (Google Solar · Building Insights) — client helper.
 *
 * Calls the server-side `solar` Edge Function, which holds the Google key and
 * the shared persistent cache (so re-canvassed roofs are free). Returns a
 * rep-friendly insight object or null. Never throws — on any failure the
 * caller simply hides the panel, so a Solar outage never blocks the door flow.
 *
 * Gating: this only fetches data. Whether the panel is SHOWN is decided by the
 * caller via the Pro tier check (see tier.js / RoofInsights.jsx).
 */
import { supabase } from './supabase.js'

// Session-level memo so reopening the same lead/door doesn't re-invoke the
// function (which would otherwise hit the DB cache again on every modal open).
const memo = new Map() // key -> { insights, found }

const keyOf = (lat, lng) => `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`

/**
 * Resolve roof insights for a coordinate.
 * @returns {Promise<{ insights: object|null, found: boolean } | null>}
 *   `null`  → lookup failed / not configured (hide the panel).
 *   `found:false` → looked up successfully but no Solar coverage at this point.
 */
export async function getRoofInsights(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null
  const k = keyOf(lat, lng)
  if (memo.has(k)) return memo.get(k)

  try {
    const { data, error } = await supabase.functions.invoke('solar', {
      body: { lat: Number(lat), lng: Number(lng) },
    })
    if (error) { console.warn('[Solar] proxy error:', error.message); return null }
    const result = { insights: data?.insights ?? null, found: !!data?.found }
    memo.set(k, result)
    return result
  } catch (e) {
    console.warn('[Solar] lookup failed:', e?.message || e)
    return null
  }
}
