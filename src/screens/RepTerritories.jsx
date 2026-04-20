/**
 * RepTerritories — the rep's "Next Stops" inbox promoted to its own page.
 *
 * Route:  /territories  (rep role only)
 * Entry:  Inbox icon in the RepHome header.
 *
 * Layout is intentionally split: a ~50vh map on top so the rep can see the
 * spatial shape of every zone at a glance, and a scrollable list below.
 *
 * Sort order (top → bottom):
 *   1. Active (not completed) zones, assigned-to-me first, then unassigned —
 *      each tier sorted by "never canvassed" > stalest > freshest. This is
 *      the "what should I knock next" bucket.
 *   2. Completed zones, most-recently-completed first. A rep's own "I'm
 *      done with this one" marker sinks the zone to the bottom so the
 *      active pile on top stays actionable.
 *
 * Each row has three touch targets:
 *   • Tap body        → flies the map to frame that zone.
 *   • Directions icon → opens Maps with driving directions to the zone's
 *                       centroid (one-tap, no manual typing).
 *   • Check icon      → toggles completion (fire-and-forget server write
 *                       with optimistic local update).
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, Flag, Inbox, Map as MapIcon, MapPin,
  Navigation, Check, RotateCcw,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  getOrgTerritoriesForRep,
  markTerritoryCompleted,
  unmarkTerritoryCompleted,
} from '../lib/supabase.js'
import TerritoryMap from '../components/TerritoryMap.jsx'

const BRAND_BLUE = '#1B4FCC'

export default function RepTerritories() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [territories, setTerritories] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [focusedId,   setFocusedId]   = useState(null)
  const mapRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    getOrgTerritoriesForRep(user.id)
      .then((rows) => { if (!cancelled) setTerritories(rows || []) })
      .catch(() => { if (!cancelled) setTerritories([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user.id])

  // Composite sort — completed zones always sink; within each half we
  // put "never canvassed & assigned" on top and "recently canvassed &
  // unassigned" at the bottom of the active pile.
  const sorted = [...territories].sort((a, b) => {
    // Tier 1: completion state — completed rows always to the bottom.
    const aDone = !!a.completed_at
    const bDone = !!b.completed_at
    if (aDone !== bDone) return aDone ? 1 : -1

    // If both are completed, most-recently-completed first — so a just-
    // finished zone is visible at the top of the "done" pile.
    if (aDone && bDone) {
      return new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
    }

    // Tier 2: assignment — flagged-for-me zones float above the rest.
    if (a.assigned_to_me !== b.assigned_to_me) return a.assigned_to_me ? -1 : 1

    // Tier 3: staleness. No prior knock is treated as the stalest state
    // (epoch 0) so freshly assigned zones surface above zones someone
    // already worked recently.
    const aT = a.last_knock_at ? new Date(a.last_knock_at).getTime() : 0
    const bT = b.last_knock_at ? new Date(b.last_knock_at).getTime() : 0
    return aT - bT
  })

  const assignedCount = sorted.filter((t) => t.assigned_to_me && !t.completed_at).length

  function handleFocus(t) {
    setFocusedId(t.id)
    // Silently no-ops if the territory somehow has no polygon attached
    // (shouldn't happen in practice since managers can't save a zone
    // with fewer than 3 vertices).
    mapRef.current?.fitToPolygon?.(t.polygon)
  }

  /**
   * Open the device's default maps app with driving directions to the
   * zone's centroid. We compute a simple vertex-average centroid —
   * accurate enough for "give me directions to this neighborhood"
   * even on L-shaped or irregular polygons, because the user just
   * needs to land *inside* the zone, not at its geometric center.
   *
   * Google Maps' universal URL is the broadest-compatibility target:
   *   - On iOS it opens in Safari or Google Maps if installed; users
   *     can long-press to open in Apple Maps via the share sheet.
   *   - On Android it deep-links to the Google Maps app.
   *   - On desktop it opens maps.google.com with the route prefilled.
   */
  function handleDirections(t) {
    const center = polygonCentroid(t.polygon)
    if (!center) return
    const [lat, lng] = center
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  /**
   * Optimistic toggle of completion state. We update the in-memory
   * row immediately so the list re-sorts without waiting on the
   * network, then issue the write; on failure we snap the row back
   * and surface a console warn (the UI still re-loads on next mount,
   * so the source of truth always wins eventually).
   */
  async function handleToggleComplete(t) {
    const nextCompletedAt = t.completed_at ? null : new Date().toISOString()
    setTerritories((prev) =>
      prev.map((row) =>
        row.id === t.id ? { ...row, completed_at: nextCompletedAt } : row
      )
    )
    try {
      if (t.completed_at) {
        const { error } = await unmarkTerritoryCompleted(t.id, user.id)
        if (error) throw error
      } else {
        const { error } = await markTerritoryCompleted(t.id, user.id)
        if (error) throw error
      }
    } catch (err) {
      console.warn('[RepTerritories] toggle complete failed:', err)
      // Revert optimistic change so state reflects the server.
      setTerritories((prev) =>
        prev.map((row) =>
          row.id === t.id ? { ...row, completed_at: t.completed_at } : row
        )
      )
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Gradient header mirrors RepHome's so the two screens feel like
          pages of the same app, not siblings fighting over a style guide. */}
      <div
        className="px-5 pt-12 pb-5"
        style={{ background: 'linear-gradient(135deg, #1B4FCC 0%, #4338CA 55%, #6D28D9 100%)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-full bg-white/20 active:bg-white/30 shrink-0"
            aria-label="Back to home"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-blue-100 text-xs flex items-center gap-1">
              <Inbox className="w-3 h-3" /> Next Stops
            </p>
            <h1 className="text-white text-xl font-bold truncate leading-tight">
              Territories
            </h1>
          </div>
          {assignedCount > 0 && (
            <span className="text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-white/20 text-white shrink-0">
              {assignedCount} assigned
            </span>
          )}
        </div>
      </div>

      {/* Map — fixed 50vh so the list gets a predictable fold. autoFit lets
          TerritoryMap run its two-stage fit (polygons first, GPS fallback)
          just like the manager view. */}
      <div className="px-4 pt-4">
        <div className="rounded-2xl overflow-hidden shadow-sm border border-gray-100 bg-white">
          <TerritoryMap
            ref={mapRef}
            territories={territories}
            className="h-[50vh]"
            autoFit
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 px-4 pt-4 pb-8">
        {loading ? (
          <ListSkeleton />
        ) : sorted.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2">
            {sorted.map((t) => (
              <TerritoryRow
                key={t.id}
                territory={t}
                focused={focusedId === t.id}
                onFocus={() => handleFocus(t)}
                onDirections={() => handleDirections(t)}
                onToggleComplete={() => handleToggleComplete(t)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TerritoryRow({ territory, focused, onFocus, onDirections, onToggleComplete }) {
  const color     = territory.color || '#3B82F6'
  const recency   = describeRecency(territory.last_knock_at)
  const assigned  = territory.assigned_to_me
  const completed = !!territory.completed_at

  // Row background: completed is visually quieted so the active pile on
  // top reads as "where to go now" at a glance. Focused wins over all
  // because the ring is a transient selection state, not a permanent mark.
  const rowClass = focused
    ? 'bg-white border-blue-400 ring-2 ring-blue-200'
    : completed
      ? 'bg-gray-50 border-gray-200 opacity-70'
      : assigned
        ? 'bg-lime-50/60 border-lime-200'
        : 'bg-white border-gray-100'

  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-2.5 rounded-xl border transition-colors ${rowClass}`}
    >
      {/* Primary tap target — the body. Tapping here flies the map. */}
      <button
        onClick={onFocus}
        className="flex items-center gap-3 flex-1 min-w-0 text-left active:scale-[0.99] transition-transform"
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${color}1F`, color }}
        >
          {completed ? (
            <Check className="w-4 h-4" />
          ) : assigned ? (
            <Flag className="w-4 h-4" fill="currentColor" />
          ) : (
            <MapPin className="w-4 h-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p
              className={`text-sm font-semibold truncate ${
                completed ? 'text-gray-500 line-through' : 'text-gray-900'
              }`}
            >
              {territory.name}
            </p>
            {territory.category && (
              <span
                className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0"
                style={{ backgroundColor: `${color}18`, color }}
              >
                {territory.category}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5 truncate">
            {completed
              ? `Completed ${describeRelative(territory.completed_at)}`
              : (assigned ? 'Assigned to you · ' : '') + recency +
                (territory.interaction_count > 0
                  ? ` · ${territory.interaction_count} knock${territory.interaction_count === 1 ? '' : 's'} logged`
                  : '')}
          </p>
        </div>
      </button>

      {/* Actions — two icon buttons, tight 36×36 targets meeting the mobile
          touch-size floor without crowding the row's text. Each button
          stops propagation implicitly because it's a sibling, not a child,
          of the focus button above. */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onDirections}
          disabled={!territory.polygon || territory.polygon.length < 3}
          className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center active:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
          aria-label="Get directions"
          title="Get directions"
        >
          <Navigation className="w-4 h-4" style={{ color: BRAND_BLUE }} />
        </button>
        <button
          onClick={onToggleComplete}
          className={`w-9 h-9 rounded-lg border flex items-center justify-center active:scale-95 transition-transform ${
            completed
              ? 'bg-white border-gray-200'
              : 'bg-emerald-50 border-emerald-200'
          }`}
          aria-label={completed ? 'Mark as active again' : 'Mark as completed'}
          title={completed ? 'Undo complete' : 'Mark complete'}
        >
          {completed ? (
            <RotateCcw className="w-4 h-4 text-gray-500" />
          ) : (
            <Check className="w-4 h-4 text-emerald-600" />
          )}
        </button>
      </div>

      {focused && !completed && (
        <MapIcon className="w-4 h-4 shrink-0" style={{ color: BRAND_BLUE }} />
      )}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 bg-white rounded-xl border border-gray-100 animate-pulse" />
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex flex-col items-center gap-2 text-center">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
        <MapIcon className="w-6 h-6 text-gray-400" />
      </div>
      <p className="text-sm font-semibold text-gray-800">No territories yet</p>
      <p className="text-xs text-gray-500 max-w-xs">
        Once your manager draws a zone in the Territories tab, it'll show up
        here. Assigned zones will float to the top with a flag.
      </p>
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────

function describeRecency(iso) {
  if (!iso) return 'Never canvassed'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return 'Canvassed today'
  if (days === 1) return 'Canvassed yesterday'
  if (days < 7)   return `Canvassed ${days} days ago`
  if (days < 30)  return `Canvassed ${Math.floor(days / 7)} wk ago`
  if (days < 365) return `Canvassed ${Math.floor(days / 30)} mo ago`
  return `Canvassed ${Math.floor(days / 365)} yr ago`
}

/**
 * Freeform "how long ago" used for completed_at. Matches describeRecency's
 * buckets but phrases them as bare relative strings so we can prefix with
 * the verb the caller wants ("Completed …", "Assigned …" etc.).
 */
function describeRelative(iso) {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7)   return `${days} days ago`
  if (days < 30)  return `${Math.floor(days / 7)} wk ago`
  if (days < 365) return `${Math.floor(days / 30)} mo ago`
  return `${Math.floor(days / 365)} yr ago`
}

/**
 * Vertex-average centroid of a [[lat,lng], ...] polygon. Good enough for
 * "open Maps here" — the rep just needs to land inside the zone, not at
 * the geometrically exact centroid. Returns null if the polygon is too
 * degenerate to have any meaningful center.
 */
function polygonCentroid(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return null
  let lat = 0, lng = 0, n = 0
  for (const p of polygon) {
    if (!Array.isArray(p) || p.length < 2) continue
    const [la, ln] = p
    if (typeof la !== 'number' || typeof ln !== 'number') continue
    lat += la
    lng += ln
    n += 1
  }
  if (n === 0) return null
  return [lat / n, lng / n]
}
