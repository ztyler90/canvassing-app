/**
 * MapView — Leaflet map with GPS trail and color-coded interaction pins.
 * Works for both the Active Canvassing screen and the Manager Dashboard.
 */
import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix Leaflet default icon path issue with Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const OUTCOME_COLORS = {
  no_answer:          '#9CA3AF',  // gray
  not_interested:     '#EF4444',  // red
  estimate_requested: '#F59E0B',  // amber
  booked:             '#10B981',  // green
}

const OUTCOME_LABELS = {
  no_answer:          'No Answer',
  not_interested:     'Not Interested',
  estimate_requested: 'Estimate Requested',
  booked:             'Booked!',
}

function makePin(color, sizePx = 22) {
  const s = sizePx
  return L.divIcon({
    className: '',
    html: `<div style="
      width: ${s}px; height: ${s}px;
      background: ${color};
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    "></div>`,
    iconSize:   [s, s],
    iconAnchor: [s / 2, s / 2],
  })
}

// Cluster bubble — a single circle that stands in for N interactions when
// zoomed out. Sized by sqrt(count) so a 100-knock cluster doesn't dwarf a
// 10-knock one. Color is the cluster's "dominant" outcome (passed in).
function makeClusterIcon(count, color) {
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

// Grid-cluster a list of points at the current zoom level. We compute a
// pixel-space grid (~CLUSTER_PX wide cells) and bucket each point by its
// projected pixel coords at zoom Z. Cheap, deterministic, and zero deps.
//
// Returned shape per cluster:
//   { lat, lng, count, dominantOutcome, items: [...interactions] }
//
// Single-point "clusters" (count === 1) are returned too so the caller can
// render them as ordinary pins on the same pass.
const CLUSTER_PX = 60
function gridClusterPoints(map, items) {
  if (!items.length) return []
  const z = map.getZoom()
  const buckets = new Map() // key -> { sumLat, sumLng, count, outcomes:{}, items:[] }
  for (const it of items) {
    if (!Number.isFinite(it.lat) || !Number.isFinite(it.lng)) continue
    const pt = map.project([it.lat, it.lng], z)
    const cx = Math.floor(pt.x / CLUSTER_PX)
    const cy = Math.floor(pt.y / CLUSTER_PX)
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
    // Dominant outcome priority order: booked > estimate > not_interested > no_answer.
    // Ties broken by priority instead of count so a cluster with 1 booking and
    // 1 no_answer reads as "booked" (high-value signal beats low-value noise).
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

function makeCurrentLocationPin() {
  return L.divIcon({
    className: '',
    html: `<div style="
      width: 20px; height: 20px;
      background: #3B82F6;
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 0 0 6px rgba(59,130,246,0.25);
    "></div>`,
    iconSize:   [20, 20],
    iconAnchor: [10, 10],
  })
}

const REP_COLORS = [
  '#3B82F6','#8B5CF6','#F59E0B','#EC4899',
  '#10B981','#EF4444','#0EA5E9','#14B8A6',
  '#F97316','#6366F1',
]

// Stalled pins get a pulsing red halo. The halo is a second div behind the
// normal avatar chip so we don't fight Leaflet's positioning math — iconSize
// stays 36×36 and the halo just overflows via negative positioning.
function makeRepPin(initials, color, stalled = false) {
  const halo = stalled
    ? `<span style="
        position:absolute;inset:-8px;border-radius:50%;
        background:rgba(220,38,38,0.35);
        box-shadow:0 0 0 2px #DC2626, 0 0 14px 2px rgba(220,38,38,0.55);
        animation:knockiq-stalled-pulse 1.6s ease-out infinite;
      "></span>`
    : ''
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:36px;height:36px">${halo}<div style="
      position:relative;
      width:36px;height:36px;
      background:${color};
      border:3px solid ${stalled ? '#DC2626' : 'white'};
      border-radius:50%;
      box-shadow:0 2px 8px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
      color:white;font-weight:700;font-size:12px;font-family:system-ui;
      letter-spacing:0.5px;
    ">${initials}</div></div>`,
    iconSize:   [36, 36],
    iconAnchor: [18, 18],
  })
}

// Inject the stalled-pin pulse keyframes once per app. Safe to call from
// module scope: it runs in the browser where the component is used, and
// the id-guard prevents duplicate style tags on hot-reload.
function ensureStalledPulseStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('knockiq-stalled-pulse-styles')) return
  const style = document.createElement('style')
  style.id = 'knockiq-stalled-pulse-styles'
  style.textContent = `
    @keyframes knockiq-stalled-pulse {
      0%   { transform: scale(1);   opacity: 0.9 }
      70%  { transform: scale(1.25); opacity: 0   }
      100% { transform: scale(1.25); opacity: 0   }
    }
  `
  document.head.appendChild(style)
}

function repInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(' ')
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

function elapsedLabel(startedAt) {
  if (!startedAt) return '—'
  const secs = Math.floor((Date.now() - new Date(startedAt)) / 1000)
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/**
 * @param {object} props
 * @param {Array}   props.trail         - [{ lat, lng }]
 * @param {Array}   props.interactions  - [{ lat, lng, outcome, address, contact_name, ... }]
 * @param {object}  props.currentPos    - { lat, lng } | null
 * @param {string}  props.className
 * @param {boolean} props.followUser    - auto-pan to current position
 * @param {Array}   props.territories   - [{ polygon: [[lat,lng]], color, name }] rep's assigned zones
 * @param {Array}   props.doNotKnock    - [{ lat, lng, address, reason }] DNK list
 * @param {Array}   props.dnkZones      - [{ polygon: [[lng,lat]...], name, reason }] DNK polygons
 * @param {Array}   props.heatmapCells  - [{ bbox, bucket, count }] block coverage heatmap cells
 * @param {Array}   props.repLocations  - [{ rep_id, lat, lng, user, session }] live rep positions
 * @param {Function} props.onInteractionClick - (interaction) => void   Tap an existing pin to edit
 * @param {object}  props.regionFallback - { bounds?: [[lat,lng],[lat,lng]], center?: [lat,lng], zoom?: number }
 *                                         Used as the initial viewport when
 *                                         `interactions` is empty so the map
 *                                         lands on the org's actual region
 *                                         instead of a hardcoded city.
 * @param {boolean} props.cluster        - When true, points are bucketed into a
 *                                         grid at low zoom levels and rendered
 *                                         as a single colored bubble per cell.
 *                                         Bursts back to individual pins at
 *                                         zoom ≥ CLUSTER_BREAKPOINT_ZOOM (16).
 * @param {boolean} props.pinValueScale  - When true, booked pins scale in size
 *                                         with `estimated_value` so the highest
 *                                         dollar deals visually stand out.
 * @param {Function} props.onContextMenu        - (latlng, screenPos) => void
 *                                                Right-click on empty map area.
 * @param {Function} props.onPinContextMenu     - (interaction, screenPos) => void
 *                                                Right-click on an interaction pin.
 * @param {Function} props.onViewportChange     - ({bounds, zoom, center}) => void
 *                                                Fires on moveend/zoomend so the
 *                                                parent can drive a "current view"
 *                                                summary panel.
 */
const MapView = forwardRef(function MapView({ trail = [], interactions = [], currentPos = null, className = '', followUser = false, territories = [], doNotKnock = [], dnkZones = [], heatmapCells = [], repLocations = [], onInteractionClick = null, onRepClick = null, autoFit = false, regionFallback = null, cluster = false, pinValueScale = false, onContextMenu = null, onPinContextMenu = null, onViewportChange = null, renderPins = true }, ref) {
  const containerRef       = useRef(null)
  const mapRef             = useRef(null)
  const trailRef           = useRef(null)
  const markersRef         = useRef([])
  const currentMarker      = useRef(null)
  const territoryLayersRef = useRef([])
  const dnkLayersRef       = useRef([])
  const dnkZoneLayersRef   = useRef([])
  const heatmapLayersRef   = useRef([])
  const repMarkersRef      = useRef([])
  const autoFitDoneRef     = useRef(false)

  // Expose imperative API so parent (e.g. Manager Map tab) can fly the map
  // to a geocoded address or programmatically re-fit to current activity.
  useImperativeHandle(ref, () => ({
    // Default zoom bumped 16 → 17.75 so address-search lands on a
    // street-level view matching the rep's Start-Canvassing default
    // (same constant used as the initial viewport below).
    flyTo(lat, lng, zoom = 17.75) {
      if (!mapRef.current || lat == null || lng == null) return
      mapRef.current.flyTo([lat, lng], zoom, { duration: 0.75 })
    },
    // Tightest reasonable fit: 12px padding and maxZoom 19 so a small
    // cluster of pins frames to individual-house detail. Single-pin case
    // uses the full maxZoom too.
    fitToInteractions(pad = 12, maxZoom = 19) {
      if (!mapRef.current) return
      const pts = (interactions || []).filter((i) => i.lat && i.lng).map((i) => [i.lat, i.lng])
      if (pts.length === 0) return
      if (pts.length === 1) {
        mapRef.current.setView(pts[0], maxZoom)
      } else {
        mapRef.current.fitBounds(pts, { padding: [pad, pad], maxZoom })
      }
    },
  }))

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
      // Allow fractional zoom steps so we can land between whole zoom
      // levels (e.g. 17.75 ≈ 1.68× the detail of 17). Default zoomSnap=1
      // forces integer-only zoom which makes the default feel either
      // too loose or too tight.
      zoomSnap:  0.25,
      zoomDelta: 0.5,
    })

    // True satellite (aerial) base layer — Esri World Imagery. Free, no API
    // key. maxNativeZoom caps the real imagery at z19 and Leaflet upscales to
    // z20 so deep zooms stay usable.
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 20, maxNativeZoom: 19 }
    ).addTo(map)

    // Street + place-name labels drawn on top of the imagery, so the view
    // reads like Google's satellite/hybrid mode — labels stay legible while
    // the canvasser still sees real rooftops.
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 20, maxNativeZoom: 19 }
    ).addTo(map)
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 20, maxNativeZoom: 19 }
    ).addTo(map)

    trailRef.current = L.polyline([], {
      color: '#3B82F6',
      weight: 3,
      opacity: 0.7,
    }).addTo(map)

    mapRef.current = map

    // Initial viewport priority:
    //   1. If we already have interactions on first render, fit to them.
    //      (Most common path on Manager Map — data has loaded by the time
    //      MapView mounts.)
    //   2. Else if the parent gave us a regionFallback (org's known service
    //      area, derived from historical interactions or territories), use
    //      that. This is the fix for the "demo opens on Tampa instead of
    //      the org's actual region" bug — Tampa is no longer the universal
    //      default.
    //   3. Else fall back to a wide continental-US view. Brief flash for
    //      the rep-side Start-Canvassing screen until GPS arrives, but
    //      it's correct-for-everyone instead of correct-for-Tampa.
    const seedPts = (interactions || []).filter((i) => i.lat && i.lng).map((i) => [i.lat, i.lng])
    if (seedPts.length >= 2) {
      map.fitBounds(seedPts, { padding: [20, 20], maxZoom: 18.5 })
      autoFitDoneRef.current = true
    } else if (seedPts.length === 1) {
      map.setView(seedPts[0], 18)
      autoFitDoneRef.current = true
    } else if (regionFallback?.bounds && regionFallback.bounds.length >= 2) {
      map.fitBounds(regionFallback.bounds, { padding: [40, 40], maxZoom: 14 })
    } else if (regionFallback?.center) {
      map.setView(regionFallback.center, regionFallback.zoom ?? 11)
    } else {
      // Continental US — chosen so no org sees a wrong-coast bias.
      map.setView([39.5, -98.35], 4)
    }

    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wire optional context-menu + viewport-change callbacks. Re-registers
  // when the parent swaps the callback identity (e.g., closure over fresh
  // state) so handlers never call into a stale reference.
  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current
    const onCtx = (e) => {
      if (!onContextMenu) return
      L.DomEvent.preventDefault(e)
      onContextMenu(
        { lat: e.latlng.lat, lng: e.latlng.lng },
        { x: e.originalEvent.clientX, y: e.originalEvent.clientY },
      )
    }
    const fireViewport = () => {
      if (!onViewportChange) return
      const b = map.getBounds()
      onViewportChange({
        bounds: [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]],
        zoom:   map.getZoom(),
        center: [map.getCenter().lat, map.getCenter().lng],
      })
    }
    if (onContextMenu)    map.on('contextmenu', onCtx)
    if (onViewportChange) { map.on('moveend', fireViewport); map.on('zoomend', fireViewport); fireViewport() }
    return () => {
      if (onContextMenu)    map.off('contextmenu', onCtx)
      if (onViewportChange) { map.off('moveend', fireViewport); map.off('zoomend', fireViewport) }
    }
  }, [onContextMenu, onViewportChange])

  // Update GPS trail
  useEffect(() => {
    if (!trailRef.current || !trail.length) return
    const latlngs = trail.map((p) => [p.lat, p.lng])
    trailRef.current.setLatLngs(latlngs)
  }, [trail])

  // Update interaction pins (re-runs on cluster/zoom/value-scale changes too)
  //
  // Clustering: when `cluster` is on and the zoom is below
  // CLUSTER_BREAKPOINT_ZOOM, points are grouped into pixel-grid buckets and
  // rendered as a single colored bubble per bucket. Click a bubble → zoom in.
  // Above the breakpoint, every interaction renders as its own pin.
  //
  // Value scaling: when `pinValueScale` is on, booked pins get a size from
  // 22→36px depending on their estimated_value (capped so a $50k outlier
  // doesn't draw a beach ball over Phoenix).
  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current
    const CLUSTER_BREAKPOINT_ZOOM = 16

    // Escape HTML in rep-entered free text (notes / contact name) so it
    // can't break popup markup or inject script.
    const escapeHtml = (s) =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

    const renderPin = (interaction) => {
      const color = OUTCOME_COLORS[interaction.outcome] || '#9CA3AF'
      // Value-scale: clamp 22..36px across $0..$10k. Above $10k saturates.
      let size = 22
      if (pinValueScale && interaction.outcome === 'booked') {
        const v = Math.min(10000, Math.max(0, Number(interaction.estimated_value) || 0))
        size = Math.round(22 + (v / 10000) * 14)
      }
      const marker = L.marker([interaction.lat, interaction.lng], { icon: makePin(color, size) })

      const editHint = onInteractionClick
        ? `<div style="color:#3B82F6;font-size:11px;margin-top:6px;font-weight:500">Tap to edit ↻</div>`
        : ''
      const notesHtml = interaction.notes
        ? `<div style="margin-top:6px;padding:6px 8px;background:#F3F4F6;border-radius:6px;color:#374151;font-size:12px;white-space:pre-wrap;line-height:1.35">💬 ${escapeHtml(interaction.notes)}</div>`
        : ''
      const repNameHtml = interaction.users?.full_name
        ? `<div style="color:#6B7280;font-size:11px;margin-top:2px">by ${escapeHtml(interaction.users.full_name)}</div>`
        : ''
      const popupContent = `
        <div style="min-width:160px;max-width:240px;font-family:system-ui;font-size:13px">
          <div style="font-weight:700;color:${color};margin-bottom:4px">
            ${OUTCOME_LABELS[interaction.outcome] || interaction.outcome}
          </div>
          <div style="color:#374151;margin-bottom:2px">${escapeHtml(interaction.address || 'Unknown address')}</div>
          ${interaction.contact_name ? `<div style="color:#6B7280">👤 ${escapeHtml(interaction.contact_name)}</div>` : ''}
          ${interaction.estimated_value ? `<div style="color:#059669;font-weight:600">$${interaction.estimated_value}</div>` : ''}
          ${notesHtml}
          ${repNameHtml}
          ${editHint}
        </div>
      `
      marker.bindPopup(popupContent)
      if (onInteractionClick) {
        marker.on('click', () => onInteractionClick(interaction))
      }
      if (onPinContextMenu) {
        marker.on('contextmenu', (e) => {
          L.DomEvent.stopPropagation(e)
          L.DomEvent.preventDefault(e)
          onPinContextMenu(interaction, { x: e.originalEvent.clientX, y: e.originalEvent.clientY })
        })
      }
      return marker
    }

    const renderCluster = (c) => {
      const color  = OUTCOME_COLORS[c.dominantOutcome] || '#9CA3AF'
      const icon   = makeClusterIcon(c.count, color)
      const marker = L.marker([c.lat, c.lng], { icon })
      // Click → zoom in one step on the cluster's center. fitBounds of the
      // cluster's items would over-zoom on single-cell clusters; +2 levels
      // is a sweet spot that splits most clusters into smaller ones.
      marker.on('click', () => {
        const z = Math.min(map.getMaxZoom(), map.getZoom() + 2)
        map.setView([c.lat, c.lng], z)
      })
      const booked   = c.items.filter((i) => i.outcome === 'booked').length
      const revenue  = c.items.reduce((s, i) => s + (Number(i.estimated_value) || 0), 0)
      marker.bindTooltip(
        `<div style="font-family:system-ui;font-size:12px;font-weight:600">${c.count} knocks</div>` +
        `<div style="font-family:system-ui;font-size:11px;color:#6B7280">${booked} booked${revenue > 0 ? ` · $${Math.round(revenue).toLocaleString()}` : ''}</div>`,
        { sticky: true, direction: 'top' }
      )
      return marker
    }

    const rebuild = () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      // `renderPins` lets the caller use the same `interactions` prop for
      // imperative actions (fitToInteractions, viewport summary) while
      // suppressing pin draw in heatmap mode. Without this we'd have to
      // pass an empty array — which then breaks Recenter.
      if (!renderPins) return
      const validPoints = (interactions || []).filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lng))
      const shouldCluster = cluster && map.getZoom() < CLUSTER_BREAKPOINT_ZOOM
      if (shouldCluster) {
        for (const c of gridClusterPoints(map, validPoints)) {
          if (c.count === 1) {
            const m = renderPin(c.items[0]); m.addTo(map); markersRef.current.push(m)
          } else {
            const m = renderCluster(c); m.addTo(map); markersRef.current.push(m)
          }
        }
      } else {
        for (const it of validPoints) {
          const m = renderPin(it); m.addTo(map); markersRef.current.push(m)
        }
      }
    }
    rebuild()

    // Re-cluster on zoom changes when clustering is enabled. We intentionally
    // skip moveend — cluster IDs are zoom-dependent only, so panning doesn't
    // change the buckets and we save the rebuild cost.
    let handler = null
    if (cluster) {
      handler = () => rebuild()
      map.on('zoomend', handler)
    }
    return () => {
      if (handler) map.off('zoomend', handler)
    }
  }, [interactions, onInteractionClick, onPinContextMenu, cluster, pinValueScale, renderPins])

  // Update current position marker + pan
  useEffect(() => {
    if (!mapRef.current || !currentPos) return

    if (!currentMarker.current) {
      currentMarker.current = L.marker([currentPos.lat, currentPos.lng], {
        icon: makeCurrentLocationPin(),
        zIndexOffset: 1000,
      }).addTo(mapRef.current)
    } else {
      currentMarker.current.setLatLng([currentPos.lat, currentPos.lng])
    }

    if (followUser) {
      // Preserve the rep's current zoom if they've pinched, but floor at
      // 17.75 so the first-GPS-fix view stays at the tight default rather
      // than sticking at whatever the map was initialized with.
      const z = Math.max(mapRef.current.getZoom() || 17.75, 17.75)
      mapRef.current.setView([currentPos.lat, currentPos.lng], z)
    }
  }, [currentPos, followUser])

  // Render assigned territory overlays (rep view)
  useEffect(() => {
    if (!mapRef.current) return
    territoryLayersRef.current.forEach((l) => l.remove())
    territoryLayersRef.current = []
    territories.forEach((t) => {
      if (!t.polygon || t.polygon.length < 3) return
      const color = t.color || '#3B82F6'
      const poly  = L.polygon(t.polygon, {
        color, weight: 2, fillColor: color, fillOpacity: 0.12, dashArray: '6 4',
      })
      poly.bindTooltip(`Your zone: ${t.name}`, { permanent: false, sticky: true })
      poly.addTo(mapRef.current)
      territoryLayersRef.current.push(poly)
    })
  }, [territories])

  // Render Do-Not-Knock pins (rep view)
  useEffect(() => {
    if (!mapRef.current) return
    dnkLayersRef.current.forEach((m) => m.remove())
    dnkLayersRef.current = []
    doNotKnock.forEach((dnk) => {
      if (!dnk.lat || !dnk.lng) return
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:20px;height:20px;background:#DC2626;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.4);color:white;font-size:12px;font-weight:bold;line-height:1">✕</div>`,
        iconSize: [20, 20], iconAnchor: [10, 10],
      })
      const marker = L.marker([dnk.lat, dnk.lng], { icon })
      marker.bindPopup(`<div style="font-family:system-ui;font-size:12px"><b style="color:#DC2626">🚫 Do Not Knock</b><br/>${dnk.address || ''}</div>`)
      marker.addTo(mapRef.current)
      dnkLayersRef.current.push(marker)
    })
  }, [doNotKnock])

  // Render Do-Not-Knock POLYGON zones (HOAs, school zones, cooldown
  // regions). Polygons are stored in GeoJSON [lng, lat] order; Leaflet
  // wants [lat, lng] pairs so we flip each pair on mount. Zones are
  // filled with a semi-transparent red with a dashed border so they
  // stand out from rep territory overlays, which use a colored dashed
  // line without fill.
  useEffect(() => {
    if (!mapRef.current) return
    dnkZoneLayersRef.current.forEach((l) => l.remove())
    dnkZoneLayersRef.current = []
    dnkZones.forEach((z) => {
      if (!z?.polygon || z.polygon.length < 3) return
      // Flip [lng, lat] → [lat, lng] for Leaflet.
      const latlngs = z.polygon.map(([lng, lat]) => [lat, lng])
      const poly = L.polygon(latlngs, {
        color:       '#B91C1C',
        weight:      2,
        fillColor:   '#DC2626',
        fillOpacity: 0.18,
        dashArray:   '4 4',
      })
      const reason  = z.reason ? `<br/><span style="color:#6B7280">${String(z.reason).replace(/[<>&]/g, '')}</span>` : ''
      poly.bindTooltip(
        `<b style="color:#B91C1C">🚫 ${z.name || 'Do Not Knock zone'}</b>${reason}`,
        { sticky: true }
      )
      poly.addTo(mapRef.current)
      dnkZoneLayersRef.current.push(poly)
    })
  }, [dnkZones])

  // Render coverage heatmap cells. Rendered UNDER interaction pins so
  // the pins stay tappable; we also keep fill opacity low (25%) so the
  // underlying street map remains legible.
  useEffect(() => {
    if (!mapRef.current) return
    heatmapLayersRef.current.forEach((l) => l.remove())
    heatmapLayersRef.current = []
    const bucketColor = {
      fresh:  { fill: '#EF4444', border: '#B91C1C' },
      recent: { fill: '#F59E0B', border: '#B45309' },
      older:  { fill: '#10B981', border: '#047857' },
    }
    heatmapCells.forEach((c) => {
      const style = bucketColor[c.bucket] || bucketColor.older
      const rect = L.rectangle(c.bbox, {
        color:       style.border,
        weight:      0.5,
        fillColor:   style.fill,
        fillOpacity: 0.25,
        interactive: false,
      })
      rect.addTo(mapRef.current)
      heatmapLayersRef.current.push(rect)
    })
  }, [heatmapCells])

  // Render live rep avatar pins (manager live map)
  useEffect(() => {
    if (!mapRef.current) return
    ensureStalledPulseStyles()
    repMarkersRef.current.forEach((m) => m.remove())
    repMarkersRef.current = []

    repLocations.forEach((rep, idx) => {
      if (!rep.lat || !rep.lng) return
      const color    = REP_COLORS[idx % REP_COLORS.length]
      const initials = repInitials(rep.user?.full_name)
      const icon     = makeRepPin(initials, color, !!rep.stalled)
      // Stalled reps pop above the stack so the pulse is never hidden
      // behind a neighbor's pin when two reps cluster.
      const marker   = L.marker([rep.lat, rep.lng], { icon, zIndexOffset: rep.stalled ? 3000 : 2000 })

      const sess      = rep.session
      const name      = rep.user?.full_name || 'Rep'
      const elapsed   = elapsedLabel(sess?.started_at)
      const doors     = sess?.doors_knocked  ?? '—'
      const convos    = sess?.conversations  ?? '—'
      const revenue   = sess?.revenue_booked != null ? `$${sess.revenue_booked.toFixed(0)}` : '—'
      // Stall banner inside the popup gives the manager immediate context
      // when they tap a red pin, without forcing them to cross-reference
      // the card list.
      const stalledBadge = rep.stalled
        ? `<div style="margin-bottom:6px;padding:4px 6px;background:#FEE2E2;border:1px solid #FCA5A5;border-radius:4px;color:#B91C1C;font-weight:700;font-size:11px">⚠ Possible stall — may need check-in</div>`
        : ''

      marker.bindPopup(`
        <div style="font-family:system-ui;font-size:13px;min-width:170px">
          <div style="font-weight:700;font-size:14px;color:#111827;margin-bottom:6px">${name}</div>
          ${stalledBadge}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
            <div style="color:#6B7280;font-size:11px">Session time</div>
            <div style="font-weight:600;font-size:11px">${elapsed}</div>
            <div style="color:#6B7280;font-size:11px">Doors</div>
            <div style="font-weight:600;font-size:11px">${doors}</div>
            <div style="color:#6B7280;font-size:11px">Convos</div>
            <div style="font-weight:600;font-size:11px">${convos}</div>
            <div style="color:#6B7280;font-size:11px">Revenue</div>
            <div style="font-weight:600;font-size:11px;color:#059669">${revenue}</div>
          </div>
        </div>
      `, { maxWidth: 220 })

      // Phase 6: live-tab rep pin click → fly to + notify caller. Used
      // by LiveTab so a single tap on a pin highlights the rep's card
      // and zooms the map in. Popup still binds separately so a slow
      // map-pan doesn't swallow the tap.
      if (onRepClick) {
        marker.on('click', () => {
          mapRef.current?.flyTo([rep.lat, rep.lng], 18.25, { duration: 0.75 })
          onRepClick(rep)
        })
      }

      marker.addTo(mapRef.current)
      repMarkersRef.current.push(marker)
    })

    // Auto-fit map to show all active reps. Tighter than before
    // (single rep → zoom 17, cluster → maxZoom 17 with 20px padding)
    // so a manager peeking at live activity lands on street-level
    // context instead of a city-wide overview.
    if (repLocations.length > 0) {
      const latlngs = repLocations.filter((r) => r.lat && r.lng).map((r) => [r.lat, r.lng])
      if (latlngs.length === 1) {
        mapRef.current.setView(latlngs[0], 17)
      } else if (latlngs.length > 1) {
        mapRef.current.fitBounds(latlngs, { padding: [20, 20], maxZoom: 17 })
      }
    }
  }, [repLocations])

  // Auto-fit to interactions on first render where `autoFit` is true and
  // we actually have data. Zooms as tight as the activity allows (up to
  // 19 — individual-house detail) with 12px padding so pins frame as
  // close to the street as Leaflet can get without clipping the outermost
  // markers. maxZoom 19 (raised from 18.5) lets tight clusters of pins
  // — a single block of doors — zoom in fully instead of capping early.
  useEffect(() => {
    if (!autoFit || !mapRef.current) return
    if (autoFitDoneRef.current) return
    const pts = (interactions || []).filter((i) => i.lat && i.lng).map((i) => [i.lat, i.lng])
    if (pts.length === 0) return
    if (pts.length === 1) {
      mapRef.current.setView(pts[0], 18)
    } else {
      mapRef.current.fitBounds(pts, { padding: [12, 12], maxZoom: 19 })
    }
    autoFitDoneRef.current = true
  }, [autoFit, interactions])

  // Apply a late-arriving regionFallback. If the parent fetched the org's
  // region asynchronously (network-bound), the prop arrives after the init
  // effect ran. We honor it only if no interactions ever rendered AND the
  // current view is still the wide-US default — never override a user pan.
  useEffect(() => {
    if (!mapRef.current || !regionFallback) return
    if (autoFitDoneRef.current) return
    if ((interactions || []).some((i) => i.lat && i.lng)) return
    if (regionFallback.bounds && regionFallback.bounds.length >= 2) {
      mapRef.current.fitBounds(regionFallback.bounds, { padding: [40, 40], maxZoom: 14 })
    } else if (regionFallback.center) {
      mapRef.current.setView(regionFallback.center, regionFallback.zoom ?? 11)
    }
  }, [regionFallback, interactions])

  return (
    <div ref={containerRef} className={`w-full ${className}`} style={{ minHeight: '200px' }} />
  )
})

export default MapView
