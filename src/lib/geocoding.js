/**
 * Reverse Geocoding
 * Uses Google Maps API if VITE_GOOGLE_MAPS_API_KEY is set,
 * otherwise falls back to OpenStreetMap Nominatim (free, rate-limited).
 */

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const cache      = new Map()

export async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
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

async function _googleGeocode(lat, lng) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_KEY}&result_type=street_address`
    const res  = await fetch(url)
    const json = await res.json()
    if (json.status === 'OK' && json.results.length) {
      return json.results[0].formatted_address
    }
  } catch (e) {
    console.warn('[Geocode] Google failed:', e.message)
  }
  return null
}

async function _nominatimGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
    const res  = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'ShackShineCanvassingApp/1.0' }
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

    return parts.join(', ') || json.display_name
  } catch (e) {
    console.warn('[Geocode] Nominatim failed:', e.message)
    return null
  }
}

// Forward geocode a neighborhood name → bounding box (used to name sessions)
export async function geocodeNeighborhood(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`
    const res  = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'ShackShineCanvassingApp/1.0' }
    })
    const json = await res.json()
    return json[0]?.display_name || null
  } catch {
    return null
  }
}
