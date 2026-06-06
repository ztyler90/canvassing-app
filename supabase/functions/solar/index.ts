/**
 * solar · Google Solar (Building Insights) proxy + shared cache
 *
 * Why this function exists
 * ────────────────────────
 * Pro-tier reps and managers get a "roof insights" panel on a door/lead —
 * roof size (job-size proxy), number of facets (complexity), average pitch
 * (difficulty + safety), and sun exposure. That data comes from Google's
 * Solar API `buildingInsights:findClosest` endpoint.
 *
 * Server-side, for the same two reasons as `geocode`:
 *   1. Security — the Google key lives in a Supabase secret, never shipped in
 *      the web bundle or the Capacitor app (whose requests originate from
 *      capacitor://localhost and would break a referrer-locked key).
 *   2. Cost — a shared `solar_cache` table means a roof resolved once (by any
 *      rep, ever) is reused for free forever. Roof geometry is static, so a
 *      hit never expires. We also negative-cache misses (Solar coverage is
 *      partial) so we never re-bill Google for an address with no data.
 *
 * Pricing context (why caching matters): Solar API Building Insights is
 * 10,000 free calls/month, then $10 per 1,000 (~$0.01 each). Caching collapses
 * re-canvassed streets to a single billable call per building, ever.
 *
 * Auth model
 *   verify_jwt = true (Supabase gateway default). Caller must be a signed-in
 *   user. The app only renders the panel for Pro-tier orgs, so the function is
 *   effectively Pro-gated at the UI layer; this proxy stays generic.
 *
 * Request  : POST { lat: number, lng: number }
 * Response : { insights: Insights | null, found: boolean, source: 'cache'|'google'|'none' }
 *   Insights = {
 *     roofAreaSqFt, sizeBucket,            // job-size proxy
 *     segmentCount, complexityBucket,      // roofline complexity
 *     avgPitchDeg,  pitchBucket,           // steepness / safety
 *     sunHoursPerYear, sunBucket,          // solar / sun exposure
 *     maxPanels,                           // raw solar potential (panels)
 *     imageryDate, quality,
 *   }
 *
 * Secrets: GOOGLE_SOLAR_KEY  (falls back to GOOGLE_GEOCODING_KEY if unset, so
 *          you can reuse the same Google key — just enable the Solar API on it).
 *          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are auto-injected.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Dedicated secret, but reuse the geocoding key if a separate one isn't set.
const SOLAR_KEY = Deno.env.get('GOOGLE_SOLAR_KEY') || Deno.env.get('GOOGLE_GEOCODING_KEY') || ''

// Roofs are per-building. Reuse a cached fix within ~12 m of the query point —
// tight enough not to bleed onto the neighbour's parcel.
const REUSE_RADIUS_M = 12
const BBOX_DELTA     = 0.00012   // ~12 m of latitude

const SQFT_PER_M2 = 10.7639

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

interface Insights {
  roofAreaSqFt: number | null;   sizeBucket: string | null;
  segmentCount: number | null;   complexityBucket: string | null;
  avgPitchDeg: number | null;    pitchBucket: string | null;
  sunHoursPerYear: number | null; sunBucket: string | null;
  maxPanels: number | null;
  imageryDate: string | null;    quality: string | null;
}

function sizeBucket(sqft: number | null): string | null {
  if (sqft == null) return null
  if (sqft < 1800) return 'Small'
  if (sqft <= 3500) return 'Medium'
  return 'Large'
}
function complexityBucket(n: number | null): string | null {
  if (n == null) return null
  if (n <= 2) return 'Simple'
  if (n <= 5) return 'Moderate'
  return 'Complex'
}
function pitchBucket(deg: number | null): string | null {
  if (deg == null) return null
  if (deg < 15) return 'Low'
  if (deg <= 30) return 'Moderate'
  return 'Steep'
}
function sunBucket(hrs: number | null): string | null {
  if (hrs == null) return null
  if (hrs < 1200) return 'Low'
  if (hrs <= 1600) return 'Good'
  return 'Excellent'
}

/** Parse Google buildingInsights into our rep-friendly insight object. */
function parseBuildingInsights(d: any): Insights {
  const sp        = d?.solarPotential ?? {}
  const whole     = sp?.wholeRoofStats ?? {}
  const segments  = Array.isArray(sp?.roofSegmentStats) ? sp.roofSegmentStats : []

  const roofAreaM2 = Number(whole?.areaMeters2)
  const roofAreaSqFt = Number.isFinite(roofAreaM2) ? Math.round(roofAreaM2 * SQFT_PER_M2) : null

  const segmentCount = segments.length || null

  // Area-weighted average pitch across roof segments (a few large facets
  // shouldn't be outvoted by many tiny ones).
  let pitchNum = 0, pitchDen = 0
  for (const s of segments) {
    const a = Number(s?.stats?.areaMeters2)
    const p = Number(s?.pitchDegrees)
    if (Number.isFinite(a) && Number.isFinite(p) && a > 0) { pitchNum += a * p; pitchDen += a }
  }
  const avgPitchDeg = pitchDen > 0 ? Math.round(pitchNum / pitchDen) : null

  const sunRaw = Number(sp?.maxSunshineHoursPerYear)
  const sunHoursPerYear = Number.isFinite(sunRaw) ? Math.round(sunRaw) : null

  const panelsRaw = Number(sp?.maxArrayPanelsCount)
  const maxPanels = Number.isFinite(panelsRaw) ? panelsRaw : null

  // imageryDate comes as { year, month, day }
  const im = d?.imageryDate
  const imageryDate = im?.year
    ? `${im.year}-${String(im.month ?? 1).padStart(2, '0')}`
    : null

  return {
    roofAreaSqFt, sizeBucket: sizeBucket(roofAreaSqFt),
    segmentCount, complexityBucket: complexityBucket(segmentCount),
    avgPitchDeg,  pitchBucket: pitchBucket(avgPitchDeg),
    sunHoursPerYear, sunBucket: sunBucket(sunHoursPerYear),
    maxPanels,
    imageryDate,
    quality: d?.imageryQuality ?? null,
  }
}

/** Call Google Solar. Returns the parsed insights + whether a building was
 *  found (404 = no coverage). `requiredQuality=LOW` maximizes coverage while
 *  still returning roof-segment geometry. */
async function googleSolar(lat: number, lng: number): Promise<{ insights: Insights | null; found: boolean }> {
  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest`
    + `?location.latitude=${lat}&location.longitude=${lng}`
    + `&requiredQuality=LOW&key=${SOLAR_KEY}`
  const res = await fetch(url)
  if (res.status === 404) return { insights: null, found: false }   // no coverage at this point
  if (!res.ok) throw new Error(`solar_http_${res.status}`)
  const data = await res.json()
  return { insights: parseBuildingInsights(data), found: true }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405)

  let lat: number, lng: number
  try {
    const body = await req.json()
    lat = Number(body.lat); lng = Number(body.lng)
  } catch { return json({ error: 'bad_request' }, 400) }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: 'invalid_coords' }, 400)

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  // 1) Cache: nearest stored roof within the reuse radius. Includes negative
  //    hits (found=false) so a known-no-coverage address is answered for free.
  try {
    const { data: near } = await db
      .from('solar_cache')
      .select('lat,lng,insights,found,gkey,hits')
      .gte('lat', lat - BBOX_DELTA).lte('lat', lat + BBOX_DELTA)
      .gte('lng', lng - BBOX_DELTA).lte('lng', lng + BBOX_DELTA)
      .limit(25)
    if (near?.length) {
      const usable = near
        .map((r: any) => ({ r, d: haversine(lat, lng, r.lat, r.lng) }))
        .filter((x: any) => x.d <= REUSE_RADIUS_M)
        .sort((a: any, b: any) => a.d - b.d)
      if (usable.length) {
        const hit = usable[0].r
        db.from('solar_cache').update({ hits: (hit.hits ?? 0) + 1 }).eq('gkey', hit.gkey).then(() => {})
        return json({ insights: hit.insights ?? null, found: !!hit.found, source: 'cache' })
      }
    }
  } catch (_e) { /* cache miss path continues */ }

  // 2) No usable cache entry. Without a key, return empty (no regression —
  //    client just hides the panel).
  if (!SOLAR_KEY) return json({ insights: null, found: false, source: 'none' })

  let insights: Insights | null = null
  let found = false
  try { ({ insights, found } = await googleSolar(lat, lng)) }
  catch (_e) { return json({ insights: null, found: false, source: 'none' }) }

  // 3) Store the result (positive OR negative) so it's free next time.
  db.from('solar_cache').upsert({
    gkey:            snapKey(lat, lng),
    lat, lng,
    found,
    insights:        insights ?? null,
    imagery_date:    insights?.imageryDate ?? null,
    quality:         insights?.quality ?? null,
    google_requests: 1,
    updated_at:      new Date().toISOString(),
  }, { onConflict: 'gkey' }).then(() => {})

  return json({ insights, found, source: 'google' })
})
