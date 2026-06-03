/**
 * TerritoryMap — Manager-only Leaflet map for territory management.
 *
 * Features:
 *  - Polygon drawing mode (click to place vertices, double-click to close)
 *  - Territory overlay (colored semi-transparent polygons)
 *  - Door-history pins (color-coded by outcome, with popup showing date + rep)
 *  - Do-Not-Knock pins (red ✕ markers)
 *  - Click any territory → popup with last-canvassed date, assigned reps, interaction count
 *  - ESC cancels drawing
 */
import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const OUTCOME_COLORS = {
  no_answer:          '#9CA3AF',
  not_interested:     '#EF4444',
  estimate_requested: '#F59E0B',
  booked:             '#10B981',
}
const OUTCOME_LABELS = {
  no_answer:          'No Answer',
  not_interested:     'Not Interested',
  estimate_requested: 'Estimate',
  booked:             'Booked',
}

/** Ray-casting point-in-polygon. polygon = [[lat,lng], ...] */
function pip(lat, lng, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i]
    const [yj, xj] = polygon[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function makeInteractionPin(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:10px;height:10px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
    iconSize: [10, 10], iconAnchor: [5, 5],
  })
}

// Cluster bubble — same visual language MapView uses on the Map tab so a
// manager moving between Map and Territories sees consistent UI. Sized by
// sqrt(count) so a 100-knock cluster doesn't dwarf a 10-knock one; color is
// the cluster's "dominant" outcome (booked > estimate > not_interested >
// no_answer).
function makeHistoryClusterIcon(count, color) {
  const size = Math.min(56, Math.max(28, Math.round(18 + Math.sqrt(count) * 3)))
  const fontSize = count >= 1000 ? 11 : count >= 100 ? 12 : 13
  const label = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;line-height:${size - 6}px;
      background:${color};color:#fff;
      border:3px solid #fff;border-radius:50%;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
      text-align:center;font-weight:800;font-size:${fontSize}px;
      font-family:system-ui,-apple-system,Inter,Arial;
    ">${label}</div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// Grid-cluster door history at the current zoom level. Cheap, deterministic,
// zero deps — identical algorithm to MapView's clusterer so the two surfaces
// bucket points identically and behave the same way when a manager zooms in.
const HISTORY_CLUSTER_PX = 60
function gridClusterHistory(map, items) {
  if (!items.length) return []
  const z = map.getZoom()
  const buckets = new Map()
  for (const it of items) {
    if (!Number.isFinite(it.lat) || !Number.isFinite(it.lng)) continue
    const pt = map.project([it.lat, it.lng], z)
    const cx = Math.floor(pt.x / HISTORY_CLUSTER_PX)
    const cy = Math.floor(pt.y / HISTORY_CLUSTER_PX)
    const key = `${cx}:${cy}`
    let b = buckets.get(key)
    if (!b) {
      b = { sumLat: 0, sumLng: 0, count: 0, outcomes: {}, items: [] }
      buckets.set(key, b)
    }
    b.sumLat += it.lat
    b.sumLng += it.lng
    b.count++
    b.outcomes[it.outcome] = (b.outcomes[it.outcome] || 0) + 1
    b.items.push(it)
  }
  const out = []
  for (const b of buckets.values()) {
    const order = ['booked', 'estimate_requested', 'not_interested', 'no_answer']
    let dominant = 'no_answer', best = -1
    for (const o of order) {
      if ((b.outcomes[o] || 0) > best && b.outcomes[o] > 0) {
        dominant = o
        best = b.outcomes[o]
      }
    }
    out.push({
      lat: b.sumLat / b.count,
      lng: b.sumLng / b.count,
      count: b.count,
      dominantOutcome: dominant,
      items: b.items,
    })
  }
  return out
}

function makeDnkPin() {
  return L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;background:#DC2626;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.4);color:white;font-size:13px;font-weight:bold;line-height:1">✕</div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  })
}

function makeVertexPin() {
  return L.divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;background:#2563EB;border:3px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
    iconSize: [12, 12], iconAnchor: [6, 6],
  })
}

function timeAgo(dateStr) {
  const d = new Date(dateStr)
  const days = Math.floor((Date.now() - d) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7)  return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} wk ago`
  if (days < 365) return `${Math.floor(days / 30)} mo ago`
  return `${Math.floor(days / 365)} yr ago`
}

const TerritoryMap = forwardRef(function TerritoryMap(
  { territories = [], doorHistory = [], doNotKnock = [], onPolygonComplete, onDrawPointsChange, onEditTerritory, className = '', autoFit = false, regionFallback = null },
  ref
) {
  const containerRef       = useRef(null)
  const mapRef             = useRef(null)
  const territoryLayersRef = useRef([])
  // Keep latest callback in a ref so popup click handlers always see the
  // current closure even after re-renders.
  const onEditTerritoryRef = useRef(onEditTerritory)
  useEffect(() => { onEditTerritoryRef.current = onEditTerritory }, [onEditTerritory])
  const historyLayerRef    = useRef(null)   // L.layerGroup for history pins
  const dnkLayerRef        = useRef(null)   // L.layerGroup for DNK pins
  const autoFitDoneRef     = useRef(false)
  // One-shot guard for the geolocation request in the auto-fit effect.
  // Separate from autoFitDoneRef because we want to avoid firing the
  // prompt twice across re-renders, without *also* blocking the eventual
  // polygon-fit branch when territories finish loading. (See the auto-fit
  // effect below for the full race-handling story.)
  const geoRequestedRef    = useRef(false)
  // Flipped to true the first time anything else moves the map (address
  // search flyTo, user drag/zoom, manual recenter, etc.). The pending
  // geolocation callback in the auto-fit effect checks this so it won't
  // yank the viewport back to the rep's GPS after they've already gone
  // somewhere — which was causing the Territory-tab address search to
  // look broken when it actually did fire correctly.
  const userMovedRef       = useRef(false)

  // Drawing state — all in refs to avoid stale closure issues in Leaflet handlers
  const drawingRef     = useRef(false)
  const drawPtsRef     = useRef([])
  const drawMarkersRef = useRef([])
  const drawLineRef    = useRef(null)
  const drawPolyRef    = useRef(null)

  // Keep the draw-point callback in a ref so the Leaflet click handler
  // (registered once, in the init effect) always sees the latest prop.
  const onDrawPointsChangeRef = useRef(onDrawPointsChange)
  useEffect(() => { onDrawPointsChangeRef.current = onDrawPointsChange }, [onDrawPointsChange])

  // Expose imperative API
  useImperativeHandle(ref, () => ({
    startDrawing() {
      if (!mapRef.current || drawingRef.current) return
      drawingRef.current = true
      drawPtsRef.current = []
      mapRef.current.getContainer().style.cursor = 'crosshair'
      onDrawPointsChangeRef.current?.(0)
    },
    cancelDrawing() { clearDraw() },
    // Programmatic "Complete" — same behavior the old double-click shortcut
    // triggered, now invokable from a button in the parent UI.
    completeDrawing() { finishDraw() },
    isDrawing()     { return drawingRef.current },
    getDrawPointCount() { return drawPtsRef.current.length },
    // Default zoom bumped from 16 → 17.5 so typing an address lands the
    // manager at street-level, where individual driveways are legible,
    // instead of a city-block overview.
    flyTo(lat, lng, zoom = 17.5) {
      if (!mapRef.current || lat == null || lng == null) return
      // Mark the viewport as user-owned so a late-resolving geolocation
      // callback from the auto-fit effect doesn't snap the map back to the
      // rep's GPS after an address search has already flown somewhere else.
      userMovedRef.current = true
      mapRef.current.flyTo([lat, lng], zoom, { duration: 0.75 })
    },
    /**
     * Fit bounds to all activity: territory polygons + door history + DNK.
     * Zooms as tight as the data allows (capped at maxZoom). Defaults
     * were relaxed in the April 2026 update — maxZoom 18 + 20px padding
     * keeps tight clusters of activity tightly framed instead of adding
     * block-wide whitespace around them.
     */
    fitToAll(maxZoom = 18) {
      if (!mapRef.current) return
      const pts = []
      territories.forEach((t) => {
        if (Array.isArray(t.polygon)) {
          t.polygon.forEach((p) => { if (p && p.length === 2) pts.push(p) })
        }
      })
      doorHistory.forEach((i) => { if (i.lat && i.lng) pts.push([i.lat, i.lng]) })
      doNotKnock.forEach((d) => { if (d.lat && d.lng) pts.push([d.lat, d.lng]) })
      if (pts.length === 0) return
      if (pts.length === 1) {
        mapRef.current.setView(pts[0], maxZoom)
      } else {
        mapRef.current.fitBounds(pts, { padding: [20, 20], maxZoom })
      }
    },
    /**
     * Fit the viewport to a single polygon's bounds. Used by the rep's
     * Territories screen to make "tap a zone in the list → map flies
     * over and frames it" one line at the call site.
     *
     * We mark the viewport as user-owned (same flag flyTo uses) so a
     * still-pending auto-fit geolocation callback can't snap the map
     * back to GPS after the rep has just asked to look at a specific
     * zone. maxZoom defaults to 17 — tight enough that individual
     * streets are legible but wide enough that a whole neighborhood-
     * sized polygon still fits without Leaflet clipping it.
     */
    fitToPolygon(polygon, maxZoom = 17) {
      if (!mapRef.current) return
      if (!Array.isArray(polygon) || polygon.length === 0) return
      userMovedRef.current = true
      if (polygon.length === 1) {
        mapRef.current.setView(polygon[0], maxZoom)
      } else {
        mapRef.current.fitBounds(polygon, { padding: [40, 40], maxZoom })
      }
    },
  }))

  function clearDraw() {
    drawingRef.current = false
    drawPtsRef.current = []
    drawMarkersRef.current.forEach((m) => m.remove())
    drawMarkersRef.current = []
    drawLineRef.current?.remove(); drawLineRef.current = null
    drawPolyRef.current?.remove(); drawPolyRef.current = null
    if (mapRef.current) mapRef.current.getContainer().style.cursor = ''
    onDrawPointsChangeRef.current?.(0)
  }

  function finishDraw() {
    const pts = [...drawPtsRef.current]
    clearDraw()
    if (pts.length >= 3) onPolygonComplete?.(pts)
  }

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
      doubleClickZoom: false,   // we use dblclick to close polygons
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20 }).addTo(map)

    historyLayerRef.current = L.layerGroup().addTo(map)
    dnkLayerRef.current     = L.layerGroup().addTo(map)

    // Click → add vertex
    map.on('click', (e) => {
      if (!drawingRef.current) return
      const { lat, lng } = e.latlng
      drawPtsRef.current.push([lat, lng])

      const vm = L.marker([lat, lng], { icon: makeVertexPin(), interactive: false }).addTo(map)
      drawMarkersRef.current.push(vm)

      drawLineRef.current?.remove()
      drawLineRef.current = L.polyline(drawPtsRef.current, {
        color: '#2563EB', weight: 2, dashArray: '6 4', interactive: false,
      }).addTo(map)

      if (drawPtsRef.current.length >= 3) {
        drawPolyRef.current?.remove()
        drawPolyRef.current = L.polygon(drawPtsRef.current, {
          color: '#2563EB', weight: 2, dashArray: '6 4',
          fillColor: '#2563EB', fillOpacity: 0.10, interactive: false,
        }).addTo(map)
      }

      // Let the parent enable/disable the "Complete" button.
      onDrawPointsChangeRef.current?.(drawPtsRef.current.length)
    })

    // Double-click → finish
    map.on('dblclick', (e) => {
      if (!drawingRef.current) return
      L.DomEvent.stop(e)
      finishDraw()
    })

    // Any direct user gesture on the map counts as "the user is in charge now"
    // — block the pending geolocation auto-center from hijacking the view.
    const markUserMoved = () => { userMovedRef.current = true }
    map.on('dragstart', markUserMoved)
    map.on('zoomstart', markUserMoved)

    // ESC → cancel
    const onKey = (e) => { if (e.key === 'Escape') clearDraw() }
    document.addEventListener('keydown', onKey)

    // Initial viewport priority (matches MapView):
    //   1. If the parent gave us a regionFallback (org's known service
    //      area, derived from historical interactions or territories),
    //      use it. This is the fix for the "Apex Pest Defense / Phoenix
    //      manager opens Territories and sees Tampa" bug — Tampa is no
    //      longer the universal default.
    //   2. Else fall back to a continental-US view so no org sees a
    //      wrong-coast bias. The auto-fit effect below will tighten this
    //      as soon as territories or geolocation resolve.
    if (regionFallback?.bounds && regionFallback.bounds.length >= 2) {
      map.fitBounds(regionFallback.bounds, { padding: [40, 40], maxZoom: 14 })
    } else if (regionFallback?.center) {
      map.setView(regionFallback.center, regionFallback.zoom ?? 11)
    } else {
      map.setView([39.5, -98.35], 4)
    }
    mapRef.current = map

    return () => {
      document.removeEventListener('keydown', onKey)
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ── Render territory polygons ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return
    territoryLayersRef.current.forEach((l) => l.remove())
    territoryLayersRef.current = []

    territories.forEach((territory) => {
      if (!territory.polygon || territory.polygon.length < 3) return
      const color = territory.color || '#3B82F6'

      // Filter door history to this territory
      const inside = doorHistory.filter(
        (i) => i.lat && i.lng && pip(i.lat, i.lng, territory.polygon)
      )
      const last = inside.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]

      const assignedReps = territory.territory_assignments?.length
        ? territory.territory_assignments.map((a) => a.users?.full_name || 'Unknown').join(', ')
        : 'Unassigned'

      const lastDateText = last
        ? new Date(last.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
          })
        : null
      const lastText = last
        ? `${lastDateText} (${timeAgo(last.created_at)}) by ${last.users?.full_name || 'rep'}`
        : 'Never canvassed'

      // Recency badge color
      const daysSinceLast = last
        ? Math.floor((Date.now() - new Date(last.created_at)) / 86400000)
        : 999
      const recencyColor = daysSinceLast <= 7 ? '#16A34A' : daysSinceLast <= 30 ? '#D97706' : '#EF4444'
      const recencyLabel = daysSinceLast <= 7 ? '● Recent' : daysSinceLast <= 30 ? '● Moderate' : '● Stale'

      const popupHtml = `
        <div style="min-width:220px;font-family:system-ui;padding:4px 2px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
            <div style="width:12px;height:12px;background:${color};border-radius:3px;flex-shrink:0"></div>
            <span style="font-weight:700;font-size:14px;color:#0F172A;flex:1">${territory.name}</span>
            <button data-edit-territory="${territory.id}" title="Edit territory"
              style="background:transparent;border:none;cursor:pointer;padding:4px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;color:#64748B;line-height:0">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
            </button>
          </div>
          <div style="font-size:12px;color:#475569;margin-bottom:4px">
            <span style="color:#94A3B8">Assigned:</span> ${assignedReps}
          </div>
          <div style="font-size:12px;color:#475569;margin-bottom:4px">
            <span style="color:#94A3B8">Last knocked:</span> ${lastText}
          </div>
          <div style="font-size:12px;color:#475569;margin-bottom:8px">
            <span style="color:#94A3B8">Total interactions:</span> ${inside.length}
          </div>
          <div style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:${recencyColor};background:${recencyColor}18;padding:2px 8px;border-radius:100px">
            ${recencyLabel}
          </div>
        </div>
      `

      const poly = L.polygon(territory.polygon, {
        color, weight: 2.5, fillColor: color, fillOpacity: 0.13,
      })
      poly.bindPopup(popupHtml)
      poly.bindTooltip(territory.name, { sticky: true, direction: 'center' })
      poly.on('mouseover', function () { this.setStyle({ fillOpacity: 0.25 }) })
      poly.on('mouseout',  function () { this.setStyle({ fillOpacity: 0.13 }) })
      poly.on('popupopen', function (e) {
        const btn = e.popup.getElement()?.querySelector(`[data-edit-territory="${territory.id}"]`)
        if (!btn) return
        const handler = (ev) => {
          ev.stopPropagation()
          poly.closePopup()
          onEditTerritoryRef.current?.(territory)
        }
        btn.addEventListener('click', handler)
        btn.addEventListener('mouseenter', () => { btn.style.background = '#F1F5F9'; btn.style.color = '#0F172A' })
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = '#64748B' })
      })
      poly.addTo(mapRef.current)
      territoryLayersRef.current.push(poly)
    })
  }, [territories, doorHistory])

  // ── Door history pins (clustered when zoomed out) ──────────────────────────
  // Below CLUSTER_BREAKPOINT_ZOOM we bucket pins into pixel-grid cells and
  // render one bubble per bucket — same UX as the Map tab. Above that zoom
  // every door renders individually. The rebuild runs on doorHistory change
  // AND on zoom change so cluster boundaries stay correct as the manager
  // zooms.
  useEffect(() => {
    if (!historyLayerRef.current || !mapRef.current) return
    const map = mapRef.current
    const layer = historyLayerRef.current
    const CLUSTER_BREAKPOINT_ZOOM = 16

    const renderPin = (i) => {
      const color  = OUTCOME_COLORS[i.outcome] || '#9CA3AF'
      const marker = L.marker([i.lat, i.lng], { icon: makeInteractionPin(color) })
      marker.bindPopup(`
        <div style="font-family:system-ui;font-size:12px;min-width:150px">
          <div style="font-weight:700;color:${color};margin-bottom:4px">${OUTCOME_LABELS[i.outcome] || i.outcome}</div>
          <div style="color:#374151">${i.address || 'Unknown address'}</div>
          <div style="color:#6B7280;margin-top:3px">${timeAgo(i.created_at)}</div>
          ${i.users?.full_name ? `<div style="color:#6B7280">${i.users.full_name}</div>` : ''}
        </div>
      `)
      return marker
    }

    const renderCluster = (c) => {
      const color  = OUTCOME_COLORS[c.dominantOutcome] || '#9CA3AF'
      const icon   = makeHistoryClusterIcon(c.count, color)
      const marker = L.marker([c.lat, c.lng], { icon })
      // Tap a bubble → zoom in two levels on its center. Two steps splits
      // most clusters into smaller ones without over-zooming on single-cell
      // bubbles (which fitBounds would do).
      marker.on('click', () => {
        const z = Math.min(map.getMaxZoom(), map.getZoom() + 2)
        map.setView([c.lat, c.lng], z)
      })
      const booked = c.items.filter((i) => i.outcome === 'booked').length
      marker.bindTooltip(
        `<div style="font-family:system-ui;font-size:12px;font-weight:600">${c.count} knocks</div>` +
        `<div style="font-family:system-ui;font-size:11px;color:#6B7280">${booked} booked</div>`,
        { sticky: true, direction: 'top' }
      )
      return marker
    }

    const rebuild = () => {
      layer.clearLayers()
      const valid = (doorHistory || []).filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lng))
      if (map.getZoom() < CLUSTER_BREAKPOINT_ZOOM) {
        for (const c of gridClusterHistory(map, valid)) {
          if (c.count === 1) layer.addLayer(renderPin(c.items[0]))
          else               layer.addLayer(renderCluster(c))
        }
      } else {
        for (const i of valid) layer.addLayer(renderPin(i))
      }
    }
    rebuild()

    const onZoom = () => rebuild()
    map.on('zoomend', onZoom)
    return () => { map.off('zoomend', onZoom) }
  }, [doorHistory])

  // ── Auto-fit to drawn territories on first paint ───────────────────────────
  // Two-stage decision, runs once per mount:
  //   1. If any territory polygons exist, fit the viewport tightly to the
  //      union of all their vertices. Ignores door-history and DNK points
  //      on purpose — the manager explicitly wants "as zoomed in as
  //      possible while seeing every drawn zone", not a bounds that gets
  //      pulled wide by a stray interaction far from any territory.
  //   2. If no territories exist yet, ask the browser for the manager's
  //      current GPS position and center on that at street-level zoom.
  //      Falls back to the continental default only if geolocation is
  //      blocked or errors out — we never want to strand the manager on
  //      a "whole continent" view when they've got an empty territory list.
  useEffect(() => {
    if (!autoFit || !mapRef.current) return

    // Stage 1: fit to drawn polygons whenever territories are present and
    // the manager hasn't taken control of the viewport yet. We intentionally
    // do NOT gate this on autoFitDoneRef — that one-shot guard previously
    // caused the tab to strand the manager on a stale view (default Tampa
    // or a cached geolocation) when territories loaded *after* the first
    // effect run, so they had to manually zoom into their market every
    // visit. userMovedRef still keeps us from yanking the viewport after
    // a drag/zoom/address-search.
    const polyPts = []
    territories.forEach((t) => {
      if (Array.isArray(t.polygon)) {
        t.polygon.forEach((p) => { if (p && p.length === 2) polyPts.push(p) })
      }
    })
    if (polyPts.length > 0 && !userMovedRef.current) {
      // The Territories tab mounts the map inside a freshly-shown container,
      // so Leaflet's cached container size can be 0×0 on the first effect
      // run — which makes fitBounds resolve to a tiny zoom (whole-country
      // view). invalidateSize() forces a re-measure before we fit.
      mapRef.current.invalidateSize()
      if (polyPts.length === 1) {
        mapRef.current.setView(polyPts[0], 18)
      } else {
        // Tighter padding (20px vs the old 40) + one extra maxZoom step
        // so a small drawn polygon lands at street-level instead of
        // block-level. Leaflet will still back off to whatever wider
        // zoom is needed if the polygon spans more than the viewport.
        mapRef.current.fitBounds(polyPts, { padding: [20, 20], maxZoom: 18 })
      }
      autoFitDoneRef.current = true
      return
    }
    if (autoFitDoneRef.current) return

    // Stage 2: no territories → ask for the manager's current location
    // ONCE (geoRequestedRef is the one-shot gate). Crucially, we do NOT
    // set autoFitDoneRef=true here — we set it only inside the success
    // callback. That way two race cases work correctly:
    //   (a) Territories finish loading before geolocation resolves → the
    //       next render of this effect runs stage 1 and fits to polygons.
    //       The late geolocation callback sees autoFitDoneRef already
    //       true and bails out.
    //   (b) Geolocation is denied or times out → autoFitDoneRef stays
    //       false, so when territories eventually load, stage 1 still
    //       runs and fits to them instead of stranding the manager on
    //       the default view (which used to be Smith Center, KS).
    if (
      typeof navigator !== 'undefined' &&
      navigator.geolocation &&
      !geoRequestedRef.current
    ) {
      geoRequestedRef.current = true
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!mapRef.current) return
          // User already moved the map (address search, pan, zoom) — don't
          // yank them back to GPS.
          if (userMovedRef.current) return
          // Territories arrived and were fitted while this was pending —
          // don't override that with a GPS snap.
          if (autoFitDoneRef.current) return
          const { latitude, longitude } = pos.coords
          // Zoom 18 ≈ street-level where individual houses are clearly
          // distinguishable.
          mapRef.current.setView([latitude, longitude], 18)
          autoFitDoneRef.current = true
        },
        () => { /* permission denied or timeout — leave the door open
                   for a later polygon fit to land here instead */ },
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 5 * 60 * 1000 }
      )
    }
  }, [autoFit, territories])

  // ── Late-arriving regionFallback ──────────────────────────────────────────
  // The org-region fetch is network-bound, so the prop typically lands a
  // tick after init. Apply it only if no territories have framed the map
  // yet AND the manager hasn't taken over the viewport — same guards as
  // the auto-fit effect above. Without this, the map stays on the wide
  // continental view until the manager pans.
  useEffect(() => {
    if (!mapRef.current || !regionFallback) return
    if (autoFitDoneRef.current) return
    if (userMovedRef.current) return
    if (territories.some((t) => Array.isArray(t.polygon) && t.polygon.length > 0)) return
    if (regionFallback.bounds && regionFallback.bounds.length >= 2) {
      mapRef.current.fitBounds(regionFallback.bounds, { padding: [40, 40], maxZoom: 14 })
    } else if (regionFallback.center) {
      mapRef.current.setView(regionFallback.center, regionFallback.zoom ?? 11)
    }
  }, [regionFallback, territories])

  // ── DNK pins ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dnkLayerRef.current) return
    dnkLayerRef.current.clearLayers()

    doNotKnock.forEach((dnk) => {
      if (!dnk.lat || !dnk.lng) return
      const marker = L.marker([dnk.lat, dnk.lng], { icon: makeDnkPin() })
      marker.bindPopup(`
        <div style="font-family:system-ui;font-size:12px;min-width:150px">
          <div style="font-weight:700;color:#DC2626;margin-bottom:4px">🚫 Do Not Knock</div>
          <div style="color:#374151">${dnk.address || 'No address'}</div>
          ${dnk.reason ? `<div style="color:#6B7280;margin-top:3px">${dnk.reason}</div>` : ''}
        </div>
      `)
      dnkLayerRef.current.addLayer(marker)
    })
  }, [doNotKnock])

  return (
    <>
      <style>{`
        .leaflet-tooltip { background: white; border: 1px solid #E2E8F0; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); font-size: 12px; font-weight: 600; color: #0F172A; padding: 4px 8px; }
        .leaflet-tooltip::before { display: none; }
      `}</style>
      <div ref={containerRef} className={`w-full ${className}`} style={{ minHeight: '300px' }} />
    </>
  )
})

export default TerritoryMap
