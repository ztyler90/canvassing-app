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

/**
 * @param {object} props
 * @param {Array}   props.trail        - [{ lat, lng }]
 * @param {Array}   props.interactions - [{ lat, lng, outcome, address, contact_name, ... }]
 * @param {object}  props.currentPos   - { lat, lng } | null
 * @param {string}  props.className
 * @param {boolean} props.followUser   - auto-pan to current position
 */
export default function MapView({ trail = [], interactions = [], currentPos = null, className = '', followUser = false }) {
  const containerRef  = useRef(null)
  const mapRef        = useRef(null)
  const trailRef      = useRef(null)
  const markersRef    = useRef([])
  const currentMarker = useRef(null)

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

  return (
    <div ref={containerRef} className={`w-full ${className}`} style={{ minHeight: '200px' }} />
  )
}
