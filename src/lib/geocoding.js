/**
 * Reverse Geocoding  (v4 — OSM Overpass primary, interpolation fallback)
 *
 * Candidate order of operations:
 *   1. Overpass API  — direct OSM buildings with addr:housenumber+addr:street
 *                       within 40 m. Free, no API key, returns actual parcels.
 *   2. Google        — used only if VITE_GOOGLE_MAPS_API_KEY is set AND
 *                       Overpass came back empty (unmapped area or timeout).
 *   3. Nominatim     — free-tier fallback when no Google key. Rate-limited,
 *                       unreliable on mobile Safari, kept only as last resort.
 *
 * v4 — why Overpass became primary
 * ────────────────────────────────
 * Nominatim reverse requests frequently hung or returned empty from mobile
 * Safari during canvassing sessions (strict rate limiting + User-Agent
 * stripping in cross-origin requests). Users saw "Detecting address…"
 * forever with no candidates. Overpass is purpose-built for bulk OSM
 * queries, has no per-client rate limit at our volume, and lets us pull
 * multiple buildings around the GPS point in a single request instead of
 * the 7 sampled reverse calls Nominatim needed.
 *
 * Legacy v3 ranking still applies — precise (rooftop / house-numbered)
 * candidates ahead of approximate, then by distance. The legacy
 * `reverseGeocode(lat, lng)` export still returns a single best string.
 */

import { distanceMeters } from './gps.js'

const GOOGLE_KEY     = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const cache          = new Map()   // key -> single best formatted address
const candidateCache = new Map()   // key -> ranked candidate array

// ── Public API ──────────────────────────────────────────────────

/**
 * Return the single best-guess address string for the given coord.
 * Kept for backward compatibility with callers that only need dedup.
 */
export async function reverseGeocode(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`
  if (cache.has(key)) return cache.get(key)

  const candidates = await reverseGeocodeCandidates(lat, lng)
  const best = candidates[0]?.formatted || null
  if (best) cache.set(key, best)
  return best
}

/**
 * Return an ordered list of candidate addresses near (lat, lng).
 * Each entry: { formatted, lat, lng, distanceM, locationType, precise, source }
 *
 * Ordering: rooftop-precise first, then by distance. Deduplicated by
 * formatted address. Capped at 5 entries so the picker stays usable.
 */
export async function reverseGeocodeCandidates(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`
  if (candidateCache.has(key)) return candidateCache.get(key)

  // Primary source: OSM buildings via Overpass. Fast, free, and returns
  // actual parcel centroids rather than interpolated segment addresses.
  let raw = await _overpassCandidates(lat, lng)

  // Fallback only if Overpass returned nothing — unmapped area, transient
  // server outage, or offline. Skipping the interpolation geocoders when
  // Overpass succeeds keeps the chip list tight and rooftop-accurate.
  if (!raw.length) {
    raw = GOOGLE_KEY
      ? await _googleCandidates(lat, lng)
      : await _nominatimCandidates(lat, lng)
  }

  // Deduplicate on formatted address — Google/Nominatim often return
  // several results that collapse to the same street-level string.
  const seen = new Set()
  const deduped = []
  for (const c of raw) {
    if (!c?.formatted) continue
    const k = c.formatted.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    deduped.push(c)
  }

  // Sort: precise (rooftop / has house number) ahead of approximate,
  // then by distance from the query point.
  deduped.sort((a, b) => {
    if (a.precise !== b.precise) return a.precise ? -1 : 1
    return (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity)
  })

  const out = deduped.slice(0, 5)
  if (out.length) candidateCache.set(key, out)
  return out
}

// ── Overpass API (OpenStreetMap) ────────────────────────────────

/**
 * Ask Overpass for every OSM building (way) or address node within
 * RADIUS metres of (lat, lng) that carries both addr:housenumber and
 * addr:street tags. Returns them as candidate records.
 *
 * We use both a primary endpoint and a community mirror — the main
 * Overpass instance occasionally rate-limits or returns 504s during
 * peak hours, and the Kumi Systems mirror has different load. If the
 * primary times out or errors, we try the mirror once before giving up
 * so the caller can fall back to the interpolation-based geocoders.
 *
 * Radius notes: 40 m is wide enough to cover the far side of a typical
 * US suburban street from a sidewalk GPS fix (~12 m centerline + drift),
 * but narrow enough that we don't pull in the entire block. Too large
 * and the chip row becomes noise; too small and we miss the actual
 * parcel when the GPS fix is off.
 */
async function _overpassCandidates(lat, lng) {
  const RADIUS = 40
  const query = `[out:json][timeout:8];(way(around:${RADIUS},${lat},${lng})["addr:housenumber"]["addr:street"];node(around:${RADIUS},${lat},${lng})["addr:housenumber"]["addr:street"];);out center tags;`

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ]

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController()
      // 10s hard cap — Overpass's own `timeout:8` is a server-side hint;
      // the HTTP fetch still needs its own bound so a wedged connection
      // doesn't block the modal indefinitely.
      const timer = setTimeout(() => controller.abort(), 10000)

      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    `data=${encodeURIComponent(query)}`,
        signal:  controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) continue

      const json     = await res.json()
      const elements = Array.isArray(json?.elements) ? json.elements : []
      if (!elements.length) return []  // successfully returned 0 buildings

      const out = []
      for (const el of elements) {
        // Ways expose their centroid under .center (because we asked
        // for `out center`); nodes have lat/lon directly on the element.
        const coord = el.type === 'way'
          ? el.center
          : { lat: el.lat, lon: el.lon }
        if (!coord || !Number.isFinite(coord.lat) || !Number.isFinite(coord.lon)) continue

        const tags     = el.tags || {}
        const house    = tags['addr:housenumber']
        const street   = tags['addr:street']
        if (!house || !street) continue

        const unit     = tags['addr:unit']
        const city     = tags['addr:city']
        const state    = tags['addr:state']
        const postcode = tags['addr:postcode']

        const line1    = unit ? `${house} ${street}, Unit ${unit}` : `${house} ${street}`
        const parts    = [line1]
        if (city)     parts.push(city)
        if (state)    parts.push(state)
        if (postcode) parts.push(postcode)

        out.push({
          formatted:    parts.join(', '),
          lat:          coord.lat,
          lng:          coord.lon,
          distanceM:    distanceMeters({ lat, lng }, { lat: coord.lat, lng: coord.lon }),
          locationType: 'ROOFTOP',
          precise:      true,
          source:       'overpass',
        })
      }
      return out
    } catch (e) {
      // AbortError (timeout) or network failure — try next endpoint.
      console.warn(`[Geocode] Overpass (${endpoint}) failed:`, e?.message || e)
    }
  }
  return []
}

// ── Google Maps Geocoding ───────────────────────────────────────

/**
 * Build candidates from Google reverse-geocode results. We call the
 * API once at the query point — the response already contains several
 * candidates (premise / street_address / route / …), each with its
 * own `location_type`. If none of them is ROOFTOP, we try four 5 m
 * offsets so a road-centered GPS fix has a chance to snap onto a
 * nearby parcel.
 */
async function _googleCandidates(lat, lng) {
  const collected = await _googleFetch(lat, lng)

  const hasRooftop = collected.some(c => c.locationType === 'ROOFTOP')
  if (!hasRooftop) {
    // ~5 m in each cardinal direction. 0.000045° ≈ 5 m latitude;
    // longitude step scales by cos(lat), but at typical US latitudes
    // the same delta is ~3.5–4 m — close enough for this purpose.
    const D = 0.000045
    const probes = [
      [lat + D, lng], [lat - D, lng],
      [lat, lng + D], [lat, lng - D],
    ]
    for (const [pLat, pLng] of probes) {
      const more = await _googleFetch(pLat, pLng)
      collected.push(...more)
      if (collected.some(c => c.locationType === 'ROOFTOP')) break
    }
  }

  // Re-compute distance from the ORIGINAL query point so ranking
  // isn't biased toward whichever probe found each candidate.
  for (const c of collected) {
    c.distanceM = distanceMeters({ lat, lng }, { lat: c.lat, lng: c.lng })
  }

  return collected
}

async function _googleFetch(lat, lng) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_KEY}`
    const res = await fetch(url)
    const json = await res.json()
    if (json.status !== 'OK' || !Array.isArray(json.results)) return []

    const out = []
    for (const r of json.results) {
      const loc = r.geometry?.location
      const locationType = r.geometry?.location_type || 'APPROXIMATE'
      if (!loc) continue
      // Only keep result types that plausibly represent a specific
      // address. Skips 'locality', 'postal_code', 'political', etc.
      const types = r.types || []
      const isAddressish = types.some(t => (
        t === 'street_address' ||
        t === 'premise' ||
        t === 'subpremise' ||
        t === 'point_of_interest'
      ))
      if (!isAddressish) continue

      out.push({
        formatted:    r.formatted_address,
        lat:          loc.lat,
        lng:          loc.lng,
        distanceM:    0, // recomputed by caller against query point
        locationType,
        precise:      locationType === 'ROOFTOP',
        source:       'google',
      })
    }
    return out
  } catch (e) {
    console.warn('[Geocode] Google failed:', e.message)
    return []
  }
}

// ── Nominatim (OpenStreetMap) ───────────────────────────────────

/**
 * Build candidates from Nominatim. Nominatim only returns one result
 * per reverse call, so we sample a small grid around the query point
 * to get multiple candidates. Each sampled coord yields at most one
 * address; dedupe then happens in the caller.
 */
async function _nominatimCandidates(lat, lng) {
  const D = 0.00003  // ~3 m
  const samples = [
    [lat, lng],
    [lat + D, lng], [lat - D, lng],
    [lat, lng + D], [lat, lng - D],
    [lat + D, lng + D], [lat - D, lng - D],
  ]

  const out = []
  for (const [sLat, sLng] of samples) {
    const hit = await _nominatimRequest(sLat, sLng)
    if (!hit) continue
    out.push({
      formatted:    hit.formatted,
      lat:          hit.lat ?? sLat,
      lng:          hit.lng ?? sLng,
      distanceM:    distanceMeters({ lat, lng }, { lat: hit.lat ?? sLat, lng: hit.lng ?? sLng }),
      locationType: hit.house_number ? 'ROOFTOP' : 'APPROXIMATE',
      precise:      Boolean(hit.house_number),
      source:       'nominatim',
    })
    // Nominatim politeness: usage policy asks ≤ 1 req/sec. We stagger
    // modestly so we don't get a 429. In practice the picker is fine
    // to take ~500 ms to populate.
    await _sleep(120)
  }
  return out
}

/** Single Nominatim reverse-geocode request.
 *  Returns { formatted, house_number, lat, lng } or null. */
async function _nominatimRequest(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'KnockIQ-CanvassingApp/3.0' }
    })
    const json = await res.json()
    const a    = json.address
    if (!a) return null

    // Build a clean US-style address
    const parts = []
    if (a.house_number && a.road) parts.push(`${a.house_number} ${a.road}`)
    else if (a.road)              parts.push(a.road)
    if (a.city || a.town || a.village) parts.push(a.city || a.town || a.village)
    if (a.state)     parts.push(a.state)
    if (a.postcode)  parts.push(a.postcode)

    return {
      formatted:    parts.join(', ') || json.display_name,
      house_number: a.house_number || null,
      lat:          Number(json.lat),
      lng:          Number(json.lon),
    }
  } catch (e) {
    console.warn('[Geocode] Nominatim failed:', e.message)
    return null
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Forward geocoding ───────────────────────────────────────────

export async function geocodeNeighborhood(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`
    const res  = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'KnockIQ-CanvassingApp/3.0' }
    })
    const json = await res.json()
    return json[0]?.display_name || null
  } catch {
    return null
  }
}
