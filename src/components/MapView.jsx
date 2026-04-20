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

function makePin(color) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width: 22px; height: 22px;
      background: ${color};
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    "></div>`,
    iconSize:   [22, 22],
    iconAnchor: [11, 11],
  })
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
 */
const MapView = forwardRef(function MapView({ trail = [], interactions = [], currentPos = null, className = '', followUser = false, territories = [], doNotKnock = [], dnkZones = [], heatmapCells = [], repLocations = [], onInteractionClick = null, autoFit = false }, ref) {
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
    // Tighter defaults: 20px padding (was 40) and maxZoom 18.5 so a
    // small cluster of pins frames to individual-house detail rather
    // than block-wide. Single-pin case no longer artificially caps at
    // 17 — it uses the full maxZoom.
    fitToInteractions(pad = 20, maxZoom = 18.5) {
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

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
    }).addTo(map)

    trailRef.current = L.polyline([], {
      color: '#3B82F6',
      weight: 3,
      opacity: 0.7,
    }).addTo(map)

    mapRef.current = map

    // Default center: Tampa, FL. Zoom 17.75 ≈ 1.75× the detail of the
    // previous default (15) — close enough that reps see individual
    // houses as soon as Start Canvassing opens the map, before GPS
    // arrives and re-centers on them.
    map.setView([27.9506, -82.4572], 17.75)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Update GPS trail
  useEffect(() => {
    if (!trailRef.current || !trail.length) return
    const latlngs = trail.map((p) => [p.lat, p.lng])
    trailRef.current.setLatLngs(latlngs)
  }, [trail])

  // Update interaction pins
  useEffect(() => {
    if (!mapRef.current) return
    // Clear old markers
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    interactions.forEach((interaction) => {
      if (!interaction.lat || !interaction.lng) return
      const color   = OUTCOME_COLORS[interaction.outcome] || '#9CA3AF'
      const marker  = L.marker([interaction.lat, interaction.lng], { icon: makePin(color) })

      const editHint = onInteractionClick
        ? `<div style="color:#3B82F6;font-size:11px;margin-top:6px;font-weight:500">Tap pin to change status ↻</div>`
        : ''
      // Escape HTML in rep-entered free text (notes / contact name) so it
      // can't break popup markup or inject script.
      const escapeHtml = (s) =>
        String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      const notesHtml = interaction.notes
        ? `<div style="margin-top:6px;padding:6px 8px;background:#F3F4F6;border-radius:6px;color:#374151;font-size:12px;white-space:pre-wrap;line-height:1.35">💬 ${escapeHtml(interaction.notes)}</div>`
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
          ${editHint}
        </div>
      `
      marker.bindPopup(popupContent)

      // Tap to edit: fires the parent callback with the full interaction so
      // the caller can open InteractionModal in edit mode. We still bind the
      // popup so the rep sees the current status, then invoke the editor.
      if (onInteractionClick) {
        marker.on('click', () => {
          onInteractionClick(interaction)
        })
      }

      marker.addTo(mapRef.current)
      markersRef.current.push(marker)
    })
  }, [interactions, onInteractionClick])

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
  // 18.5 — individual-house detail) with 20px padding instead of 40 so
  // pins frame closer to the street they're on.
  useEffect(() => {
    if (!autoFit || !mapRef.current) return
    if (autoFitDoneRef.current) return
    const pts = (interactions || []).filter((i) => i.lat && i.lng).map((i) => [i.lat, i.lng])
    if (pts.length === 0) return
    if (pts.length === 1) {
      mapRef.current.setView(pts[0], 18)
    } else {
      mapRef.current.fitBounds(pts, { padding: [20, 20], maxZoom: 18.5 })
    }
    autoFitDoneRef.current = true
  }, [autoFit, interactions])

  return (
    <div ref={containerRef} className={`w-full ${className}`} style={{ minHeight: '200px' }} />
  )
})

export default MapView
