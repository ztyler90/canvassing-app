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
  { territories = [], doorHistory = [], doNotKnock = [], onPolygonComplete, onDrawPointsChange, className = '', autoFit = false },
  ref
) {
  const containerRef       = useRef(null)
  const mapRef             = useRef(null)
  const territoryLayersRef = useRef([])
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

    // Initial default matches MapView exactly — Tampa, FL at zoom 17.75
    // (street-level). Picked over the old continental-centroid-at-zoom-12
    // because when geolocation gets denied AND the org has no territories
    // yet, this default is the view the manager actually lives with.
    // Zoom 12 over Smith Center, KS is useless tiles; 17.75 over Tampa
    // at least looks like "a map of houses" while the auto-fit effect
    // tries to put them somewhere more relevant.
    map.setView([27.9506, -82.4572], 17.75)
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

      const lastText = last
        ? `${timeAgo(last.created_at)} by ${last.users?.full_name || 'rep'}`
        : 'Never canvassed'

      // Recency badge color
      const daysSinceLast = last
        ? Math.floor((Date.now() - new Date(last.created_at)) / 86400000)
        : 999
      const recencyColor = daysSinceLast <= 7 ? '#16A34A' : daysSinceLast <= 30 ? '#D97706' : '#EF4444'
      const recencyLabel = daysSinceLast <= 7 ? '● Recent' : daysSinceLast <= 30 ? '● Moderate' : '● Stale'

      const popupHtml = `
        <div style="min-width:200px;font-family:system-ui;padding:4px 2px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
            <div style="width:12px;height:12px;background:${color};border-radius:3px;flex-shrink:0"></div>
            <span style="font-weight:700;font-size:14px;color:#0F172A">${territory.name}</span>
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
      poly.addTo(mapRef.current)
      territoryLayersRef.current.push(poly)
    })
  }, [territories, doorHistory])

  // ── Door history pins ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!historyLayerRef.current) return
    historyLayerRef.current.clearLayers()

    doorHistory.forEach((i) => {
      if (!i.lat || !i.lng) return
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
      historyLayerRef.current.addLayer(marker)
    })
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
    if (autoFitDoneRef.current) return

    // Stage 1: fit to drawn polygons if we have any.
    const polyPts = []
    territories.forEach((t) => {
      if (Array.isArray(t.polygon)) {
        t.polygon.forEach((p) => { if (p && p.length === 2) polyPts.push(p) })
      }
    })
    if (polyPts.length > 0) {
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
