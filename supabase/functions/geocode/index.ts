/**
 * geocode · precise reverse-geocoding proxy (Google) + shared cache
 *
 * Why this function exists
 * ────────────────────────
 * Door-to-door accuracy only matters where a rep LOGS an interaction — that
 * address becomes a real record. Pass-by / no-answer pins stay on free
 * OpenStreetMap (resolved client-side in geocoding.js). When the rep opens the
 * "Log Interaction" slide-up, the client calls THIS function for a precise
 * Google reverse-geocode.
 *
 * Two reasons it's a server-side function rather than a direct client call:
 *   1. Security — the Google key lives in a Supabase secret, never shipped in
 *      the web bundle or the Capacitor app, and can be IP/referrer-locked to
 *      this server. (A web-referrer-restricted key would otherwise BLOCK the
 *      native app, whose requests originate from capacitor://localhost.)
 *   2. Cost — a shared `geocode_cache` table means a door resolved once (by any
 *      rep, ever) is reused for free on every later visit. Door teams
 *      re-canvass the same streets constantly, so this collapses paid lookups.
 *
 * Auth model
 *   verify_jwt = true (Supabase gateway). The caller must be a signed-in rep.
 *   Cache reads/writes use the service-role key so the table can stay locked
 *   down (RLS on, no policies) — clients never touch it directly.
 *
 * Request  : POST { lat: number, lng: number, precise?: boolean }
 * Response : { candidates: Candidate[], source: 'cache'|'google'|'none' }
 *   Candidate = { formatted, lat, lng, distanceM, locationType, precise, source }
 *   (identical shape to geocoding.js so the UI needs no changes)
 *
 * Secrets: GOOGLE_GEOCODING_KEY  (set via: supabase secrets set GOOGLE_GEOCODING_KEY=...)
 *          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are auto-injected.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const GOOGLE_KEY = Deno.env.get('GOOGLE_GEOCODING_KEY') || ''

// Reuse a cached fix within ~14 m of the query point (covers GPS drift at a
// single door without bleeding into the neighbour's parcel).
const REUSE_RADIUS_M = 14
const BBOX_DELTA     = 0.00013   // ~14 m of latitude; a slightly wider E-W box is fine

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

const snapKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`

interface Candidate {
  formatted: string; lat: number; lng: number;
  distanceM: number; locationType: string; precise: boolean; source: string;
}

/** Parse a Google reverse-geocode response into our candidate shape. */
function parseGoogle(results: any[], qLat: number, qLng: number): Candidate[] {
  const out: Candidate[] = []
  for (const r of results || []) {
    const loc = r.geometry?.location
    if (!loc) continue
    const types = r.types || []
    const isAddressish = types.some((t: string) =>
      t === 'street_address' || t === 'premise' || t === 'subpremise' || t === 'point_of_interest')
    if (!isAddressish) continue
    const locationType = r.geometry?.location_type || 'APPROXIMATE'
    out.push({
      formatted:    r.formatted_address,
      lat:          loc.lat,
      lng:          loc.lng,
      distanceM:    haversine(qLat, qLng, loc.lat, loc.lng),
      locationType,
      precise:      locationType === 'ROOFTOP',
      source:       'google',
    })
  }
  return out
}

async function googleFetch(lat: number, lng: number, qLat: number, qLng: number): Promise<Candidate[]> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_KEY}`
  const res = await fetch(url)
  const data = await res.json()
  if (data.status !== 'OK') return []
  return parseGoogle(data.results, qLat, qLng)
}

/** One call at the point; if nothing rooftop, probe four ~5 m offsets.
 *  Returns the deduped candidates plus the number of billable Google
 *  requests made (1–5) so spend can be tracked. */
async function googleCandidates(lat: number, lng: number): Promise<{ candidates: Candidate[]; requests: number }> {
  let requests = 1
  let collected = await googleFetch(lat, lng, lat, lng)
  if (!collected.some(c => c.precise)) {
    const D = 0.000045
    for (const [pLat, pLng] of [[lat + D, lng], [lat - D, lng], [lat, lng + D], [lat, lng - D]]) {
      requests++
      collected = collected.concat(await googleFetch(pLat, pLng, lat, lng))
      if (collected.some(c => c.precise)) break
    }
  }
  // Dedupe by formatted address, then sort precise-first, nearest-first.
  const seen = new Set<string>(), deduped: Candidate[] = []
  for (const c of collected) {
    if (!c.formatted) continue
    const k = c.formatted.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k); deduped.push(c)
  }
  deduped.sort((a, b) => (a.precise !== b.precise) ? (a.precise ? -1 : 1) : a.distanceM - b.distanceM)
  return { candidates: deduped.slice(0, 5), requests }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405)

  let lat: number, lng: number, precise = true
  try {
    const body = await req.json()
    lat = Number(body.lat); lng = Number(body.lng)
    if (body.precise === false) precise = false
  } catch { return json({ error: 'bad_request' }, 400) }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: 'invalid_coords' }, 400)

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  // 1) Cache: nearest stored fix within the reuse radius. For a precise
  //    request, only accept a hit that is itself a precise/Google entry —
  //    otherwise we fall through and upgrade it via Google.
  try {
    const { data: near } = await db
      .from('geocode_cache')
      .select('lat,lng,candidates,source,precise,gkey,hits')
      .gte('lat', lat - BBOX_DELTA).lte('lat', lat + BBOX_DELTA)
      .gte('lng', lng - BBOX_DELTA).lte('lng', lng + BBOX_DELTA)
      .limit(25)
    if (near?.length) {
      const usable = near
        .filter((r: any) => !precise || r.precise || r.source === 'google')
        .map((r: any) => ({ r, d: haversine(lat, lng, r.lat, r.lng) }))
        .filter((x: any) => x.d <= REUSE_RADIUS_M)
        .sort((a: any, b: any) => a.d - b.d)
      if (usable.length) {
        const hit = usable[0].r
        db.from('geocode_cache').update({ hits: (hit.hits ?? 0) + 1 }).eq('gkey', hit.gkey).then(() => {})
        return json({ candidates: hit.candidates, source: 'cache' })
      }
    }
  } catch (_e) { /* cache miss path continues */ }

  // 2) No usable cache entry. If we have a Google key, resolve precisely and
  //    store the result. Without a key, return empty so the client falls back
  //    to its own free OSM path (no regression).
  if (!GOOGLE_KEY) return json({ candidates: [], source: 'none' })

  let candidates: Candidate[] = []
  let requests = 0
  try { ({ candidates, requests } = await googleCandidates(lat, lng)) }
  catch (_e) { return json({ candidates: [], source: 'none' }) }

  if (candidates.length) {
    const best = candidates[0]
    db.from('geocode_cache').upsert({
      gkey:              snapKey(lat, lng),
      lat, lng,
      formatted_address: best.formatted,
      candidates,
      source:            'google',
      precise:           candidates.some(c => c.precise),
      google_requests:   requests,
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'gkey' }).then(() => {})
  }

  return json({ candidates, source: 'google' })
})
