/**
 * ManagerMap — the rebuilt manager-side Map tab.
 *
 * Replaces the original MapTab inside ManagerDashboard with a feature-rich
 * canvas: clustered pins, territory overlay, current-view summary,
 * multi-axis filter panel, right-click context menu, and one-click PNG
 * share.
 *
 * Lives in its own file because the surface grew large enough that nesting
 * it inside ManagerDashboard.jsx would dwarf the rest of the dashboard.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trophy, Crosshair, Share2, Layers, SlidersHorizontal, X, Eye, EyeOff } from 'lucide-react'
import MapView from './MapView.jsx'
import { getTerritories, addDoNotKnock, getOrgRegionFallback } from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'

// Outcome metadata — single source of truth for color, label, and chip order.
// Mirrors the constants the MapView pins use so the legend and pins stay in
// sync if either palette changes.
const MAP_OUTCOMES = [
  { id: 'no_answer',          color: '#9CA3AF', label: 'No Answer' },
  { id: 'not_interested',     color: '#EF4444', label: 'Not Interested' },
  { id: 'estimate_requested', color: '#F59E0B', label: 'Estimate Requested' },
  { id: 'booked',             color: '#10B981', label: 'Booked' },
]

// Day-of-week filter — 0 = Sunday … 6 = Saturday, matching JS Date#getDay().
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function ManagerMap({ interactions = [], allReps = [] }) {
  const mapRef = useRef(null)

  // ── Async-loaded org context ─────────────────────────────────────────────
  // Territories + region fallback both come from the org and refresh on
  // demand. Fetched once on mount; the user can refresh by switching tabs.
  const [territories,    setTerritories]    = useState([])
  const [regionFallback, setRegionFallback] = useState(null)
  useEffect(() => {
    let alive = true
    getTerritories().then((t) => { if (alive) setTerritories(t || []) })
    getOrgRegionFallback().then((r) => { if (alive) setRegionFallback(r) })
    return () => { alive = false }
  }, [])

  // ── Display-mode toggles ─────────────────────────────────────────────────
  const [showTerritories, setShowTerritories] = useState(false)
  const [showFilters,     setShowFilters]     = useState(false)
  const [showSummary,     setShowSummary]     = useState(true)
  // Outcome chip visibility — controls both pin filtering AND legend state.
  const [visible, setVisible] = useState({
    no_answer:          true,
    not_interested:     true,
    estimate_requested: true,
    booked:             true,
  })
  const toggleOutcome = (id) => setVisible((v) => ({ ...v, [id]: !v[id] }))

  // ── Inline filters (rep, service, value, day-of-week) ─────────────────────
  const [filterRep,     setFilterRep]     = useState('all')
  const [filterService, setFilterService] = useState('all')
  const [minValue,      setMinValue]      = useState(0)
  // 0 = Sun … 6 = Sat. Default: all days enabled.
  const [dayMask, setDayMask] = useState(() => new Set([0, 1, 2, 3, 4, 5, 6]))
  const toggleDay = (i) => setDayMask((s) => {
    const n = new Set(s)
    n.has(i) ? n.delete(i) : n.add(i)
    return n
  })

  // ── Compose the filtered interaction set ─────────────────────────────────
  // Order: outcome chip → rep → service → value → day-of-week. Single pass
  // so we don't allocate intermediate arrays for 11k+ points.
  const allServices = useMemo(() => {
    const set = new Set()
    for (const it of interactions) {
      for (const s of (it.service_types || [])) set.add(s)
    }
    return Array.from(set).sort()
  }, [interactions])

  const filtered = useMemo(() => {
    const out = []
    for (const it of interactions) {
      if (!visible[it.outcome]) continue
      if (filterRep !== 'all' && it.rep_id !== filterRep) continue
      if (filterService !== 'all' && !(it.service_types || []).includes(filterService)) continue
      if (minValue > 0 && (Number(it.estimated_value) || 0) < minValue) continue
      if (dayMask.size < 7) {
        const d = new Date(it.created_at || 0)
        if (!dayMask.has(d.getDay())) continue
      }
      out.push(it)
    }
    return out
  }, [interactions, visible, filterRep, filterService, minValue, dayMask])

  // Outcome counts for the legend chips. Reflects the *current* filtered set
  // (post rep/service/value/day) but ignores the outcome chip itself so the
  // user can see "how many would come back if I re-enabled Not Interested".
  const chipCounts = useMemo(() => {
    const c = { no_answer: 0, not_interested: 0, estimate_requested: 0, booked: 0 }
    for (const it of interactions) {
      if (filterRep !== 'all' && it.rep_id !== filterRep) continue
      if (filterService !== 'all' && !(it.service_types || []).includes(filterService)) continue
      if (minValue > 0 && (Number(it.estimated_value) || 0) < minValue) continue
      if (dayMask.size < 7) {
        const d = new Date(it.created_at || 0)
        if (!dayMask.has(d.getDay())) continue
      }
      if (c[it.outcome] != null) c[it.outcome]++
    }
    return c
  }, [interactions, filterRep, filterService, minValue, dayMask])

  // ── Selected-area summary — driven by the viewport-change callback ──────
  const [viewport, setViewport] = useState(null) // { bounds, zoom, center }
  const viewportSummary = useMemo(() => {
    if (!viewport) return null
    const [[s, w], [n, e]] = viewport.bounds
    let knocks = 0, booked = 0, revenue = 0
    const repCounts = {}
    for (const it of filtered) {
      if (it.lat == null || it.lng == null) continue
      if (it.lat < s || it.lat > n || it.lng < w || it.lng > e) continue
      knocks++
      if (it.outcome === 'booked') booked++
      revenue += Number(it.estimated_value) || 0
      if (it.users?.full_name) {
        repCounts[it.users.full_name] = (repCounts[it.users.full_name] || 0) + 1
      }
    }
    const closeRate = knocks > 0 ? ((booked / knocks) * 100).toFixed(1) : '0.0'
    // Top rep: highest knock count within the bounds. Ties broken by name
    // sort so the display is stable across re-renders.
    const topRep = Object.entries(repCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    return { knocks, booked, revenue, closeRate, topRep }
  }, [viewport, filtered])

  // ── Context menu (right-click) ───────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState(null) // { kind:'empty'|'pin', x, y, latlng?, interaction? }
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', close)
    }
  }, [ctxMenu])

  // ── Share PNG — grab the map tile pane via html2canvas-style approach ────
  // Leaflet renders OSM tiles into <img> elements that are tainted by CORS
  // when the canvas tries to read pixels back. To dodge that, we render an
  // SVG card composed of the current viewport bounds + a marker-density
  // sketch derived from `filtered`. Lower fidelity than a tile screenshot,
  // but works without an external screenshot dep or a CORS proxy.
  const [shareMsg, setShareMsg] = useState('')
  async function downloadPng() {
    if (!viewport) { setShareMsg('Pan the map first'); setTimeout(() => setShareMsg(''), 1500); return }
    const svg = buildMapShareSvg({ viewport, filtered, chipCounts, viewportSummary })
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const img  = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = img.width  * 2
      canvas.height = img.height * 2
      const ctx = canvas.getContext('2d')
      ctx.scale(2, 2)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((png) => {
        URL.revokeObjectURL(url)
        if (!png) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(png)
        a.download = `map-${new Date().toISOString().slice(0, 10)}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
        setShareMsg('Downloaded')
        setTimeout(() => setShareMsg(''), 1500)
      }, 'image/png')
    }
    img.src = url
  }

  // ── Right-click handlers wired into MapView ──────────────────────────────
  // Memoized so their identity is stable across renders. MapView uses these
  // as effect dependencies; if they changed every render, MapView would tear
  // down and rebuild every pin/cluster marker on each render — which swallows
  // cluster clicks (the marker's DOM node is replaced mid-click) and also
  // drives a fireViewport→setViewport re-render loop. Stable identity keeps
  // the markers mounted so a cluster click reliably zooms in.
  const handleEmptyContextMenu = useCallback((latlng, screenPos) =>
    setCtxMenu({ kind: 'empty', x: screenPos.x, y: screenPos.y, latlng }), [])
  const handlePinContextMenu = useCallback((interaction, screenPos) =>
    setCtxMenu({ kind: 'pin', x: screenPos.x, y: screenPos.y, interaction }), [])

  // ── Quick action handlers ────────────────────────────────────────────────
  async function addDnkHere(latlng) {
    try {
      await addDoNotKnock({ address: '', lat: latlng.lat, lng: latlng.lng, reason: 'Marked from Map', addedBy: null })
      setShareMsg('Added to Do-Not-Knock')
    } catch {
      setShareMsg('DNK failed')
    }
    setTimeout(() => setShareMsg(''), 1500)
  }

  const allDays  = dayMask.size === 7
  const noChips  = MAP_OUTCOMES.every((o) => !visible[o.id])

  return (
    <div className="flex flex-col gap-3 max-w-7xl mx-auto w-full">
      {/* ─── Toolbar ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 px-3 py-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => mapRef.current?.fitToInteractions(12, 19)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          title="Recenter on the current activity"
        >
          <Crosshair className="w-3.5 h-3.5" /> Recenter
        </button>

        <button
          type="button"
          onClick={() => setShowTerritories((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ring-1 ${showTerritories ? 'bg-blue-50 text-blue-700 ring-blue-200' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
          title="Toggle territory overlay"
        >
          <Layers className="w-3.5 h-3.5" /> Territories
        </button>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ring-1 ${showFilters ? 'bg-blue-50 text-blue-700 ring-blue-200' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
          title="Open filters"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
        </button>

        <button
          type="button"
          onClick={() => setShowSummary((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ring-1 ${showSummary ? 'bg-blue-50 text-blue-700 ring-blue-200' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
          title="Show selected-area summary"
        >
          {showSummary ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} Summary
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={downloadPng}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm hover:opacity-95"
          style={{ backgroundColor: BRAND_BLUE }}
        >
          <Share2 className="w-3.5 h-3.5" /> Share PNG
        </button>
        {shareMsg && (
          <span className="text-[11px] font-semibold text-emerald-600">{shareMsg}</span>
        )}
      </div>

      {/* ─── Legend chips ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            Door Status · tap to toggle
          </p>
          <button
            onClick={() => setVisible(Object.fromEntries(MAP_OUTCOMES.map((o) => [o.id, noChips])))}
            className="text-[11px] font-semibold text-gray-500 hover:text-gray-700"
          >
            {noChips ? 'Show all' : 'Hide all'}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {MAP_OUTCOMES.map(({ id, color, label }) => {
            const on    = visible[id]
            const count = chipCounts[id] || 0
            return (
              <button
                key={id}
                onClick={() => toggleOutcome(id)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${on ? 'bg-white border-gray-300 text-gray-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}
              >
                <div className="w-3 h-3 rounded-full transition-opacity" style={{ backgroundColor: color, opacity: on ? 1 : 0.3 }} />
                <span className={on ? '' : 'line-through'}>{label}</span>
                <span className={`text-[10px] font-bold px-1.5 rounded-full ${on ? 'bg-gray-100 text-gray-500' : 'bg-gray-200 text-gray-400'}`}>{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── Map + side panels row ─────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-3 relative">
        {/* Filter panel (slide-in from left on desktop, stacked on mobile) */}
        {showFilters && (
          <FilterPanel
            allReps={allReps}
            allServices={allServices}
            filterRep={filterRep} setFilterRep={setFilterRep}
            filterService={filterService} setFilterService={setFilterService}
            minValue={minValue} setMinValue={setMinValue}
            dayMask={dayMask} toggleDay={toggleDay} allDays={allDays} setDayMask={setDayMask}
            onClose={() => setShowFilters(false)}
          />
        )}

        {/* Map */}
        <div
          className="rounded-2xl overflow-hidden border border-gray-200 flex-1 relative"
          style={{ height: 'min(70vh, 640px)', minHeight: '420px' }}
        >
          <MapView
            ref={mapRef}
            interactions={filtered}
            territories={showTerritories ? territories : []}
            className="w-full h-full"
            followUser={false}
            autoFit
            regionFallback={regionFallback}
            cluster
            pinValueScale
            onContextMenu={handleEmptyContextMenu}
            onPinContextMenu={handlePinContextMenu}
            onViewportChange={setViewport}
          />
        </div>

        {/* Selected-area summary panel */}
        {showSummary && <SummaryPanel summary={viewportSummary} filteredCount={filtered.length} />}
      </div>

      {/* ─── Context menu ──────────────────────────────────────────────── */}
      {ctxMenu && (
        <ContextMenu
          ctx={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onAddDnk={() => { addDnkHere(ctxMenu.latlng); setCtxMenu(null) }}
          onRecenter={() => { mapRef.current?.flyTo(ctxMenu.latlng?.lat, ctxMenu.latlng?.lng, 18); setCtxMenu(null) }}
        />
      )}
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

// Collapsible filter sidebar. Fixed-width on desktop, full-width on mobile.
function FilterPanel({ allReps, allServices, filterRep, setFilterRep, filterService, setFilterService, minValue, setMinValue, dayMask, toggleDay, allDays, setDayMask, onClose }) {
  return (
    <aside className="md:w-60 shrink-0 bg-white rounded-2xl border border-gray-200 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filters</p>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1 block">Rep</label>
        <select value={filterRep} onChange={(e) => setFilterRep(e.target.value)}
          className="w-full text-xs font-medium bg-white text-slate-900 rounded-lg ring-1 ring-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All reps</option>
          {allReps.map((r) => (
            <option key={r.id} value={r.id}>{r.full_name || r.email}</option>
          ))}
        </select>
      </div>

      {allServices.length > 0 && (
        <div>
          <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1 block">Service</label>
          <select value={filterService} onChange={(e) => setFilterService(e.target.value)}
            className="w-full text-xs font-medium bg-white text-slate-900 rounded-lg ring-1 ring-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">All services</option>
            {allServices.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
        </div>
      )}

      <div>
        <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1 block">
          Min estimated value <span className="text-slate-700 font-bold">${minValue.toLocaleString()}</span>
        </label>
        <input
          type="range" min="0" max="10000" step="250"
          value={minValue}
          onChange={(e) => setMinValue(Number(e.target.value))}
          className="w-full accent-blue-600"
        />
        <div className="flex justify-between text-[10px] text-slate-400 mt-0.5"><span>$0</span><span>$10k+</span></div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Day of week</label>
          <button
            onClick={() => setDayMask(allDays ? new Set() : new Set([0, 1, 2, 3, 4, 5, 6]))}
            className="text-[10px] font-semibold text-slate-500 hover:text-slate-700"
          >{allDays ? 'Clear' : 'All'}</button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map((d, i) => {
            const on = dayMask.has(i)
            return (
              <button key={i} onClick={() => toggleDay(i)}
                className={`text-[10px] font-bold rounded py-1 transition-colors ${on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}
                title={d}>
                {d[0]}
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  )
}

// Right-side panel that summarizes what's currently in view.
function SummaryPanel({ summary, filteredCount }) {
  return (
    <aside className="md:w-60 shrink-0 bg-white rounded-2xl border border-gray-200 p-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">In current view</p>
      {!summary || summary.knocks === 0 ? (
        <p className="text-xs text-slate-400">
          {filteredCount === 0
            ? 'No interactions match the current filters.'
            : 'Pan/zoom the map to see stats for that area.'}
        </p>
      ) : (
        <>
          <Stat label="Knocks"    value={summary.knocks.toLocaleString()} />
          <Stat label="Booked"    value={summary.booked.toLocaleString()} />
          <Stat label="Close %"   value={`${summary.closeRate}%`} />
          <Stat label="Est. revenue" value={`$${Math.round(summary.revenue).toLocaleString()}`} />
          {summary.topRep && (
            <div className="pt-2 border-t border-slate-100">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Top rep here</p>
              <p className="text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                {summary.topRep[0]} <span className="text-xs text-slate-500 font-normal">· {summary.topRep[1]}</span>
              </p>
            </div>
          )}
        </>
      )}
    </aside>
  )
}
function Stat({ label, value }) {
  return (
    <div>
      <p className="text-lg font-extrabold text-slate-900 leading-tight tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{label}</p>
    </div>
  )
}

// Tiny context menu — anchored to the click coordinates. Auto-dismisses on
// any document click (registered at the parent level).
function ContextMenu({ ctx, onAddDnk, onRecenter }) {
  // Clamp so the menu doesn't render off the right/bottom edge of the page.
  const W = 220, H = 160
  const x = Math.min(ctx.x, (typeof window !== 'undefined' ? window.innerWidth  : 9999) - W - 8)
  const y = Math.min(ctx.y, (typeof window !== 'undefined' ? window.innerHeight : 9999) - H - 8)
  return (
    <div
      className="fixed z-50 bg-white rounded-lg shadow-xl border border-slate-200 py-1 text-sm"
      style={{ left: x, top: y, width: W }}
      onClick={(e) => e.stopPropagation()}
    >
      {ctx.kind === 'pin' ? (
        <>
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-500 truncate">
            {ctx.interaction.address || 'Pin'}
          </div>
          <MenuItem onClick={onRecenter}>Center map here</MenuItem>
        </>
      ) : (
        <>
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-500">
            Map area
          </div>
          <MenuItem onClick={onAddDnk}>Add to Do-Not-Knock</MenuItem>
          <MenuItem onClick={onRecenter}>Center map here</MenuItem>
        </>
      )}
    </div>
  )
}
function MenuItem({ children, onClick }) {
  return (
    <button onClick={onClick} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-slate-700">
      {children}
    </button>
  )
}

// SVG share-card builder. Renders the viewport bounds with the filtered
// markers projected into the card frame. Doesn't include the OSM tiles
// (CORS would taint the canvas), so the result reads as a "data view" of
// the current map rather than a literal screenshot. Good enough for a
// quick Slack share.
function buildMapShareSvg({ viewport, filtered, chipCounts, viewportSummary }) {
  const W = 1080, H = 720, HEAD = 200
  const [[s, w], [n, e]] = viewport.bounds
  const dLat = n - s, dLng = e - w
  const projX = (lng) => 40 + ((lng - w) / dLng) * (W - 80)
  const projY = (lat) => HEAD + ((n - lat) / dLat) * (H - HEAD - 60)
  const esc = (str) => String(str ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
  const colors = { no_answer: '#9CA3AF', not_interested: '#EF4444', estimate_requested: '#F59E0B', booked: '#10B981' }

  // Render at most 2000 points so very dense fills don't bloat the SVG.
  const sample = filtered.length > 2000
    ? filtered.filter((_, i) => i % Math.ceil(filtered.length / 2000) === 0)
    : filtered

  const pins = sample.map((it) => {
    if (!Number.isFinite(it.lat) || !Number.isFinite(it.lng)) return ''
    return `<circle cx="${projX(it.lng).toFixed(1)}" cy="${projY(it.lat).toFixed(1)}" r="3" fill="${colors[it.outcome] || '#9CA3AF'}" opacity="0.85" />`
  }).join('')

  const summaryLine = viewportSummary && viewportSummary.knocks > 0
    ? `${viewportSummary.knocks} knocks · ${viewportSummary.booked} booked · ${viewportSummary.closeRate}% close · $${Math.round(viewportSummary.revenue).toLocaleString()}`
    : `${filtered.length} interactions in view`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="hd" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0F2C75" />
        <stop offset="100%" stop-color="#1B4FCC" />
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#F8FAFC" />
    <rect width="${W}" height="${HEAD}" fill="url(#hd)" />
    <text x="40" y="62" font-family="system-ui,Inter,Arial" font-size="22" font-weight="700" fill="#FFFFFF" opacity="0.85">🗺️ Canvassing map</text>
    <text x="40" y="120" font-family="system-ui,Inter,Arial" font-size="38" font-weight="900" fill="#FFFFFF">${esc(summaryLine)}</text>
    <text x="40" y="160" font-family="system-ui,Inter,Arial" font-size="14" fill="#FFFFFF" opacity="0.85">${chipCounts.no_answer} no-answer · ${chipCounts.not_interested} no · ${chipCounts.estimate_requested} estimates · ${chipCounts.booked} booked</text>
    <rect x="40" y="${HEAD}" width="${W - 80}" height="${H - HEAD - 60}" fill="#FFFFFF" stroke="#E5E7EB" />
    ${pins}
    <text x="${W / 2}" y="${H - 24}" font-family="system-ui,Inter,Arial" font-size="14" fill="#94A3B8" text-anchor="middle">KnockIQ · ${new Date().toLocaleDateString()}</text>
  </svg>`
}
