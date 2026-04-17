/**
 * MapView — Leaflet map with GPS trail and color-coded interaction pins.
 * Works for both the Active Canvassing screen and the Manager Dashboard.
 */
import { useEffect, useRef } from 'react'
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

function makeRepPin(initials, color) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:36px;height:36px;
      background:${color};
      border:3px solid white;
      border-radius:50%;
      box-shadow:0 2px 8px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
      color:white;font-weight:700;font-size:12px;font-family:system-ui;
      letter-spacing:0.5px;
    ">${initials}</div>`,
    iconSize:   [36, 36],
    iconAnchor: [18, 18],
  })
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
 * @param {Array}   props.repLocations  - [{ rep_id, lat, lng, user, session }] live rep positions
 */
export default function MapView({ trail = [], interactions = [], currentPos = null, className = '', followUser = false, territories = [], doNotKnock = [], repLocations = [] }) {
  const containerRef       = useRef(null)
  const mapRef             = useRef(null)
  const trailRef           = useRef(null)
  const markersRef         = useRef([])
  const currentMarker      = useRef(null)
  const territoryLayersRef = useRef([])
  const dnkLayersRef       = useRef([])
  const repMarkersRef      = useRef([])

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
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

    // Default center: Tampa, FL
    map.setView([27.9506, -82.4572], 15)

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

      const popupContent = `
        <div style="min-width:160px;font-family:system-ui;font-size:13px">
          <div style="font-weight:700;color:${color};margin-bottom:4px">
            ${OUTCOME_LABELS[interaction.outcome] || interaction.outcome}
          </div>
          <div style="color:#374151;margin-bottom:2px">${interaction.address || 'Unknown address'}</div>
          ${interaction.contact_name ? `<div style="color:#6B7280">👤 ${interaction.contact_name}</div>` : ''}
          ${interaction.estimated_value ? `<div style="color:#059669;font-weight:600">$${interaction.estimated_value}</div>` : ''}
        </div>
      `
      marker.bindPopup(popupContent)
      marker.addTo(mapRef.current)
      markersRef.current.push(marker)
    })
  }, [interactions])

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
      mapRef.current.setView([currentPos.lat, currentPos.lng], mapRef.current.getZoom() || 17)
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

  // Render live rep avatar pins (manager live map)
  useEffect(() => {
    if (!mapRef.current) return
    repMarkersRef.current.forEach((m) => m.remove())
    repMarkersRef.current = []

    repLocations.forEach((rep, idx) => {
      if (!rep.lat || !rep.lng) return
      const color    = REP_COLORS[idx % REP_COLORS.length]
      const initials = repInitials(rep.user?.full_name)
      const icon     = makeRepPin(initials, color)
      const marker   = L.marker([rep.lat, rep.lng], { icon, zIndexOffset: 2000 })

      const sess      = rep.session
      const name      = rep.user?.full_name || 'Rep'
      const elapsed   = elapsedLabel(sess?.started_at)
      const doors     = sess?.doors_knocked  ?? '—'
      const convos    = sess?.conversations  ?? '—'
      const revenue   = sess?.revenue_booked != null ? `$${sess.revenue_booked.toFixed(0)}` : '—'

      marker.bindPopup(`
        <div style="font-family:system-ui;font-size:13px;min-width:170px">
          <div style="font-weight:700;font-size:14px;color:#111827;margin-bottom:6px">${name}</div>
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

    // Auto-fit map to show all active reps
    if (repLocations.length > 0) {
      const latlngs = repLocations.filter((r) => r.lat && r.lng).map((r) => [r.lat, r.lng])
      if (latlngs.length === 1) {
        mapRef.current.setView(latlngs[0], 15)
      } else if (latlngs.length > 1) {
        mapRef.current.fitBounds(latlngs, { padding: [40, 40], maxZoom: 16 })
      }
    }
  }, [repLocations])

  return (
    <div ref={containerRef} className={`w-full ${className}`} style={{ minHeight: '200px' }} />
  )
}
