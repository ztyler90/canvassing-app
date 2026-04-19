/**
 * Do-Not-Knock Polygon Zones
 * ──────────────────────────
 * Point-based DNK (a single pin per house) is great for one-off requests,
 * but not all "no go" regions are individual doors. Common real-world cases:
 *
 *   • HOAs that have explicitly opted out (entire subdivision)
 *   • School zones where canvassing is disallowed by policy
 *   • Recent complaint clusters a manager wants to cool off for 90 days
 *   • Competitor exclusivity territories in partnership deals
 *
 * This module loads polygon zones from Supabase (`dnk_zones` table) and
 * exposes a synchronous point-in-polygon check the detector can call on
 * every GPS frame without blocking.
 *
 * Table schema (expected — harmless if missing, `loadDnkZones` just
 * returns empty):
 *   id          uuid primary key
 *   org_id      uuid (RLS scopes to rep's org)
 *   name        text               e.g. "Bayshore HOA (opted out)"
 *   reason      text               free-form rationale shown in the banner
 *   polygon     jsonb              [[lng, lat], [lng, lat], ...]  (GeoJSON order)
 *   active      boolean default true
 *   expires_at  timestamptz null   null = permanent
 *
 * Polygons use GeoJSON [longitude, latitude] order to match Leaflet's
 * GeoJSON integration, BUT the point-in-polygon helpers below accept
 * {lat, lng} because that's how the rest of the app passes coords.
 */

import { supabase } from './supabase.js'

// Mutable exported array — consumers import { dnkZones } and just read it
// after calling loadDnkZones(). This avoids threading the list through
// three levels of React context or prop-drilling into the detector.
export const dnkZones = []

/**
 * Ray-cast point-in-polygon test. `polygon` is an array of
 * [lng, lat] pairs (GeoJSON order). Returns true if the point is inside.
 *
 * The edge case "point exactly on an edge" is not handled (returns
 * implementation-defined) — acceptable because GPS floats are never
 * exactly on a hand-drawn polygon edge.
 */
export function pointInPolygon(lat, lng, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]   // [lng, lat]
    const [xj, yj] = polygon[j]
    // Standard ray-cast: does a horizontal ray from (lng, lat) cross this edge?
    const intersects =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi
    if (intersects) inside = !inside
  }
  return inside
}

/**
 * True if (lat, lng) is inside any polygon in `zones` (or in the
 * module-level `dnkZones` if no list is provided — convenience for
 * callers that don't want to thread state).
 *
 * We also skip the polygon math entirely when the point is outside
 * the zone's rough bounding box. With a few dozen zones this early-out
 * keeps the cost below 0.1 ms per GPS frame.
 */
export function pointInAnyZone(lat, lng, zones = dnkZones) {
  if (!Array.isArray(zones) || !zones.length) return false
  for (const z of zones) {
    const poly = z?.polygon
    if (!poly || poly.length < 3) continue
    const bbox = z._bbox || computeBbox(poly)
    if (lat < bbox.minLat || lat > bbox.maxLat) continue
    if (lng < bbox.minLng || lng > bbox.maxLng) continue
    if (pointInPolygon(lat, lng, poly)) return z
  }
  return false
}

/** Compute and cache the axis-aligned bounding box of a polygon. */
function computeBbox(polygon) {
  let minLat =  Infinity, maxLat = -Infinity
  let minLng =  Infinity, maxLng = -Infinity
  for (const [lng, lat] of polygon) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  return { minLat, maxLat, minLng, maxLng }
}

/**
 * Fetch active DNK polygon zones for the rep's org from Supabase.
 * Swallows errors (missing table, RLS denial, offline) and returns
 * whatever the current cache holds — this is a soft feature, we'd
 * rather keep canvassing than block the session on a 404.
 *
 * On success the module-level `dnkZones` array is replaced in place
 * (splice → push) so any consumer with a reference to it sees the
 * new zones without re-importing.
 */
export async function loadDnkZones() {
  try {
    const { data, error } = await supabase
      .from('dnk_zones')
      .select('id, name, reason, polygon, expires_at')
      .eq('active', true)
      // Optional: filter out expired rows client-side (RLS can do this too).
      .order('name', { ascending: true })
    if (error) throw error

    const now = Date.now()
    const fresh = (data || [])
      .filter((z) => !z.expires_at || new Date(z.expires_at).getTime() > now)
      .map((z) => ({ ...z, _bbox: computeBbox(z.polygon || []) }))

    dnkZones.splice(0, dnkZones.length, ...fresh)
    return dnkZones
  } catch (e) {
    // Missing table is normal for new installs — log quietly.
    console.debug('[DNK] loadDnkZones skipped:', e?.message || e)
    return dnkZones
  }
}
