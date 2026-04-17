/**
 * Reverse Geocoding  (v2 — improved address accuracy)
 *
 * Uses Google Maps API if VITE_GOOGLE_MAPS_API_KEY is set,
 * otherwise falls back to OpenStreetMap Nominatim (free, rate-limited).
 *
 * v2 changes
 * ──────────
 * • Nominatim requests now use zoom=18 (building-level) for more
 *   precise house-number interpolation.
 * • If the first Nominatim hit lacks a house_number, a second lookup
 *   is tried at a small offset toward the road to get a better match.
 * • Cache key uses 6 decimal places (~11 cm) instead of 5 (~1.1 m).
 */

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const cache      = new Map()

export async function reverseGeocode(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`
  if (cache.has(key)) return cache.get(key)

  let address = null

  if (GOOGLE_KEY) {
    address = await _googleGeocode(lat, lng)
  } else {
    address = await _nominatimGeocode(lat, lng)
  }

  if (address) cache.set(key, address)
  return address
}

// ── Google Maps Geocoding ───────────────────────────────────────

async function _googleGeocode(lat, lng) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_KEY}&result_type=street_address`
    const res  = await fetch(url)
    const json = await res.json()
    if (json.status === 'OK' && json.results.length) {
      return json.results[0].formatted_address
    }
    // If street_address type returned nothing, try without the filter
    if (json.status === 'ZERO_RESULTS') {
      const url2 = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_KEY}`
      const res2  = await fetch(url2)
      const json2 = await res2.json()
      if (json2.status === 'OK' && json2.results.length) {
        return json2.results[0].formatted_address
      }
    }
  } catch (e) {
    console.warn('[Geocode] Google failed:', e.message)
  }
  return null
}

// ── Nominatim (OpenStreetMap) ───────────────────────────────────

async function _nominatimGeocode(lat, lng) {
  // First attempt at full precision, building-level zoom
  const result = await _nominatimRequest(lat, lng)
  if (result?.house_number) return result.formatted

  // If we didn't get a house number, try small offsets (~3 m in each
  // cardinal direction). GPS inaccuracy means the coordinate may be
  // in the street rather than on the parcel, causing Nominatim to
  // miss the house number. Shifting slightly can land on a building.
  const OFFSET = 0.00003 // ~3 m
  const offsets = [
    [lat + OFFSET, lng],
    [lat - OFFSET, lng],
    [lat, lng + OFFSET],
    [lat, lng - OFFSET],
  ]
  for (const [oLat, oLng] of offsets) {
    const retry = await _nominatimRequest(oLat, oLng)
    if (retry?.house_number) return retry.formatted
  }

  // Fall back to best result we got (road-level)
  return result?.formatted || null
}

/** Single Nominatim reverse-geocode request.
 *  Returns { formatted, house_number } or null. */
async function _nominatimRequest(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'KnockIQ-CanvassingApp/2.0' }
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
    }
  } catch (e) {
    console.warn('[Geocode] Nominatim failed:', e.message)
    return null
  }
}

// ── Forward geocoding ───────────────────────────────────────────

export async function geocodeNeighborhood(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`
    const res  = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'KnockIQ-CanvassingApp/2.0' }
    })
    const json = await res.json()
    return json[0]?.display_name || null
  } catch {
    return null
  }
}
