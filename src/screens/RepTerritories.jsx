/**
 * RepTerritories — the rep's "Next Stops" inbox promoted to its own page.
 *
 * Route:  /territories  (rep role only)
 * Entry:  Inbox icon in the RepHome header.
 *
 * Layout is intentionally split: a ~50vh map on top so the rep can see the
 * spatial shape of every zone at a glance, and a scrollable list below with
 * the same assigned-first / least-recently-canvassed ordering Next Stops
 * used on the home page.
 *
 * Clicking a row calls `mapRef.current.fitToPolygon(...)` — the imperative
 * method we added to TerritoryMap — which flies the viewport over and
 * frames that zone at street-level zoom. The row's selection state is
 * echoed in local state so the card gets a ring until the rep taps
 * somewhere else (including just dragging the map).
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Flag, Inbox, Map as MapIcon, MapPin } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { getOrgTerritoriesForRep } from '../lib/supabase.js'
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

  // Assigned zones first, then "stale" zones (least-recently-canvassed) —
  // same ordering the home-page card used, preserved here so there's zero
  // cognitive cost to the rep switching between screens.
  const sorted = [...territories].sort((a, b) => {
    if (a.assigned_to_me !== b.assigned_to_me) return a.assigned_to_me ? -1 : 1
    const aT = a.last_knock_at ? new Date(a.last_knock_at).getTime() : 0
    const bT = b.last_knock_at ? new Date(b.last_knock_at).getTime() : 0
    return aT - bT
  })

  const assignedCount = sorted.filter((t) => t.assigned_to_me).length

  function handleFocus(t) {
    setFocusedId(t.id)
    // flyTo the polygon — fitToPolygon was added to TerritoryMap's
    // imperative API specifically for this flow. Silently no-ops if the
    // territory somehow has no polygon attached (shouldn't happen in
    // practice since managers can't save a zone with < 3 vertices).
    mapRef.current?.fitToPolygon?.(t.polygon)
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
                onClick={() => handleFocus(t)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TerritoryRow({ territory, focused, onClick }) {
  const color = territory.color || '#3B82F6'
  const recency = describeRecency(territory.last_knock_at)
  const assigned = territory.assigned_to_me
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-left active:scale-[0.99] transition-transform ${
        focused
          ? 'bg-white border-blue-400 ring-2 ring-blue-200'
          : assigned
            ? 'bg-lime-50/60 border-lime-200'
            : 'bg-white border-gray-100'
      }`}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}1F`, color }}
      >
        {assigned ? <Flag className="w-4 h-4" fill="currentColor" /> : <MapPin className="w-4 h-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-gray-900 truncate">{territory.name}</p>
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
          {assigned ? 'Assigned to you · ' : ''}
          {recency}
          {territory.interaction_count > 0
            ? ` · ${territory.interaction_count} knock${territory.interaction_count === 1 ? '' : 's'} logged`
            : ''}
        </p>
      </div>
      <MapIcon
        className="w-4 h-4 shrink-0"
        style={{ color: focused ? BRAND_BLUE : '#CBD5E1' }}
      />
    </button>
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
