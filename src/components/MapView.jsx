/**
 * MapView — Leaflet map with GPS trail and color-coded interaction pins.
 * Works for both the Active Canvassing screen and the Manager Dashboard.
 */
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { motionClassifier } from '../lib/motion.js'

// Active-canvassing follow behavior. Rather than hard-recentering on every GPS
// fix (which makes the map impossible to explore — it snaps back instantly),
// we let the rep pan/zoom freely and only resume following once they actually
// start walking again. RESUME_WALK_M is how far the rep must physically move
// from where they began exploring before we glide back to them; it's set well
// above typical standing GPS jitter (~5–10 m) so simply standing at a door
// doesn't yank the map back while they're looking around.
const RESUME_WALK_M = 6

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

// Ripple color matches the logged outcome's pin color so the pulse reads as
// "that door." Unknown/blank outcomes fall back to the brand lime.
function rippleColorFor(outcome) {
  return OUTCOME_COLORS[outcome] || '#7DC31E'
}

// Hard ceiling on how many trail vertices we feed the map. A multi-hour route
// can accumulate thousands of GPS points; rendering (and rebuilding the fading
// chunks for) all of them every tick is wasted work the eye can't resolve.
const MAX_TRAIL_POINTS = 400

// Evenly downsample latlngs to at most MAX_TRAIL_POINTS while ALWAYS keeping
// the first and last points — so the route keeps its full extent and shape and
// the bright head stays pinned to the rep's current position. Cheap O(n) pass.
function capTrailPoints(latlngs) {
  const n = latlngs.length
  if (n <= MAX_TRAIL_POINTS) return latlngs
  const step = (n - 1) / (MAX_TRAIL_POINTS - 1)
  const out = []
  for (let i = 0; i < MAX_TRAIL_POINTS - 1; i++) {
    out.push(latlngs[Math.round(i * step)])
  }
  out.push(latlngs[n - 1]) // guarantee the freshest point is included
  return out
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
  // Live "you are here" beacon: a solid blue dot with a continuously
  // expanding ring behind it, so the rep's own position reads as live and
  // animated rather than a static marker. The ring overflows a 20×20 icon
  // box via absolute positioning, so iconSize/anchor stay unchanged.
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:20px;height:20px">
      <span style="
        position:absolute;inset:0;border-radius:50%;
        background:rgba(59,130,246,0.45);
        animation:knockiq-gps-pulse 1.8s ease-out infinite;
      "></span>
      <span style="
        position:absolute;inset:0;
        background:#3B82F6;
        border:3px solid white;
        border-radius:50%;
        box-shadow:0 0 0 6px rgba(59,130,246,0.25), 0 1px 4px rgba(0,0,0,0.35);
      "></span>
    </div>`,
    iconSize:   [20, 20],
    iconAnchor: [10, 10],
  })
}

// One-shot ripple dropped at a door the moment it's logged. Two concentric
// expanding rings (offset timing) give a quick radar-ping feel. The marker
// is added then removed after the animation; see the ripple effect below.
function makeKnockRipple(color = '#7DC31E') {
  const ring = (delay) => `<span style="
    position:absolute;inset:0;border-radius:50%;
    border:3px solid ${color};
    box-shadow:0 0 8px ${color};
    animation:knockiq-knock-ripple 0.85s ease-out ${delay} forwards;
  "></span>`
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:26px;height:26px">
      ${ring('0s')}${ring('0.18s')}
    </div>`,
    iconSize:   [26, 26],
    iconAnchor: [13, 13],
  })
}

const REP_COLORS = [
  '#3B82F6','#8B5CF6','#F59E0B','#EC4899',
  '#10B981','#EF4444','#0EA5E9','#14B8A6',
  '#F97316','#6366F1',
]

// Hex (#rgb or #rrggbb) → rgba() string. Used to tint a rep's live pulse with
// their own pin color at low alpha.
function hexToRgba(hex, a) {
  const h = String(hex || '').replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  if (Number.isNaN(n)) return `rgba(59,130,246,${a})`
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// Stalled pins get a pulsing red halo; active (non-stalled) pins get a softer
// pulse in their own color so the manager can see at a glance who's live right
// now. The halo is a second div behind the avatar chip so we don't fight
// Leaflet's positioning math — iconSize stays 36×36 and the halo overflows via
// negative positioning.
function makeRepPin(initials, color, stalled = false, active = false) {
  const halo = stalled
    ? `<span style="
        position:absolute;inset:-8px;border-radius:50%;
        background:rgba(220,38,38,0.35);
        box-shadow:0 0 0 2px #DC2626, 0 0 14px 2px rgba(220,38,38,0.55);
        animation:knockiq-stalled-pulse 1.6s ease-out infinite;
      "></span>`
    : active
    ? `<span style="
        position:absolute;inset:-6px;border-radius:50%;
        background:${hexToRgba(color, 0.30)};
        box-shadow:0 0 0 2px ${hexToRgba(color, 0.55)}, 0 0 12px 1px ${hexToRgba(color, 0.5)};
        animation:knockiq-rep-pulse 1.9s ease-out infinite;
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

// Inject all map-FX styles once per app: the stalled-pin pulse, the GPS
// beacon pulse, and the neon glow filter for the GPS trail. Safe to call
// repeatedly — the id-guard prevents duplicate style tags on hot-reload.
function ensureMapFxStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('knockiq-map-fx-styles')) return
  const style = document.createElement('style')
  style.id = 'knockiq-map-fx-styles'
  style.textContent = `
    @keyframes knockiq-stalled-pulse {
      0%   { transform: scale(1);   opacity: 0.9 }
      70%  { transform: scale(1.25); opacity: 0   }
      100% { transform: scale(1.25); opacity: 0   }
    }
    /* Expanding ring behind the live GPS dot — signals "you are here, live". */
    @keyframes knockiq-gps-pulse {
      0%   { transform: scale(0.6); opacity: 0.55 }
      70%  { transform: scale(2.4); opacity: 0    }
      100% { transform: scale(2.4); opacity: 0    }
    }
    /* Gentler ring for active rep pins on the manager map — "this rep is
       live right now". Smaller max scale than the GPS beacon so clustered
       pins don't overlap their neighbors' halos. */
    @keyframes knockiq-rep-pulse {
      0%   { transform: scale(0.85); opacity: 0.5 }
      75%  { transform: scale(1.8);  opacity: 0   }
      100% { transform: scale(1.8);  opacity: 0   }
    }
    /* Neon glow on the GPS trail. drop-shadow follows the SVG path outline,
       so the whole breadcrumb line gets a soft blue halo as it draws. */
    .knockiq-trail {
      filter: drop-shadow(0 0 3px rgba(59,130,246,0.95))
              drop-shadow(0 0 6px rgba(59,130,246,0.55));
    }
    /* Marching ants — a thin dashed overlay whose dashes slide toward the
       rep's current position, implying forward motion along the trail.
       dashoffset goes negative so the flow runs oldest → newest. */
    .knockiq-trail-flow {
      stroke-dasharray: 6 16;
      animation: knockiq-ants 0.9s linear infinite;
    }
    @keyframes knockiq-ants {
      to { stroke-dashoffset: -22; }
    }
    /* Knock ripple — expanding ring dropped at a door the instant it's
       logged, for a quick "got it" pulse of feedback on the map. */
    @keyframes knockiq-knock-ripple {
      0%   { transform: scale(0.3); opacity: 0.85 }
      80%  { transform: scale(2.6); opacity: 0    }
      100% { transform: scale(2.6); opacity: 0    }
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
  const trailGlowRef       = useRef(null)   // wide soft halo (uniform)
  const trailFlowRef       = useRef(null)   // thin dashed "marching ants" overlay
  const trailSegmentsRef   = useRef([])     // fading main line, one polyline per chunk
  const knockSeenRef       = useRef(null)   // # interactions already seen (ripple gate)
  const repStatsSeenRef    = useRef(null)   // per-rep {doors,bookings} seen (manager heartbeat)
  const markersRef         = useRef([])
  const currentMarker      = useRef(null)
  const territoryLayersRef = useRef([])
  const dnkLayersRef       = useRef([])
  const dnkZoneLayersRef   = useRef([])
  const heatmapLayersRef   = useRef([])
  const repMarkersRef      = useRef([])
  const autoFitDoneRef     = useRef(false)
  const repFitDoneRef      = useRef(false)  // fit-to-reps runs once, not every poll

  // ── Follow / explore state (active-canvassing only) ──────────────────────
  // `exploring` true means the rep has panned/zoomed away to look around, so
  // we suspend auto-follow until they start walking again. We keep it in both
  // a ref (read inside event handlers / the position effect without re-binding)
  // and state (to drive the Recenter button's visibility).
  const exploringRef       = useRef(false)
  const [exploring, setExploring] = useState(false)
  const exploreAnchorRef   = useRef(null)  // rep's GPS pos when exploration began
  const lastUserPosRef     = useRef(null)  // most recent GPS pos we've seen
  const programmaticMoveRef = useRef(false) // guards our own pan/zoom from tripping explore

  const setExploreState = (v) => { exploringRef.current = v; setExploring(v) }

  // Begin "explore" mode: the rep grabbed the map to look around, so freeze
  // auto-follow and remember where they physically were at that moment (the
  // anchor) so we can tell when they've walked far enough to resume.
  function beginExplore() {
    if (!followUser) return
    exploreAnchorRef.current =
      lastUserPosRef.current ||
      (currentPos ? { lat: currentPos.lat, lng: currentPos.lng } : null)
    if (!exploringRef.current) setExploreState(true)
  }

  // Glide back to the rep's current position and resume auto-follow. Uses a
  // short flyTo so it reads as a smooth "snap back to me," not a hard jump.
  function recenterToUser(animate = true) {
    const map = mapRef.current
    const pos = lastUserPosRef.current || currentPos
    if (!map || !pos) return
    const z = Math.max(map.getZoom() || 17.75, 17.75)
    programmaticMoveRef.current = true
    if (animate) map.flyTo([pos.lat, pos.lng], z, { duration: 0.6 })
    else         map.setView([pos.lat, pos.lng], z)
    setExploreState(false)
  }

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
    // Snap back to the rep and resume auto-follow. Wired to the on-map
    // Recenter button, and available to the parent if it wants its own.
    recenter() {
      recenterToUser(true)
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

    // GPS trail is drawn in three stacked layers for a neon, alive look:
    //   1. trailGlow  — wide, low-opacity halo (the soft outer glow), uniform.
    //   2. fading main line — built per-update as several chunks whose opacity
    //      ramps from faint (oldest) to bright (newest); see the trail effect.
    //   3. trailFlow  — a thin dashed overlay ("marching ants") that slides
    //      toward the rep, implying forward motion.
    // Layers 1 and 3 are created here (single polylines we just feed points
    // to); the fading chunks in layer 2 are rebuilt on each trail update.
    // Rounded caps/joins keep everything smooth as the path bends.
    trailGlowRef.current = L.polyline([], {
      color: '#3B82F6',
      weight: 13,
      opacity: 0.18,
      lineCap:  'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(map)

    trailFlowRef.current = L.polyline([], {
      color: '#DBEAFE',           // pale blue dashes read as light moving on the line
      weight: 2,
      opacity: 0.9,
      lineCap:  'butt',
      lineJoin: 'round',
      className: 'knockiq-trail-flow',
      interactive: false,
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

  // Update GPS trail: feed the glow + flow overlays, then rebuild the fading
  // main line as a handful of chunks whose opacity ramps oldest → newest.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !trailGlowRef.current) return
    const latlngs = capTrailPoints(trail.map((p) => [p.lat, p.lng]))

    trailGlowRef.current.setLatLngs(latlngs)
    if (trailFlowRef.current) trailFlowRef.current.setLatLngs(latlngs)

    // Rebuild fading chunks. Cheap enough to recreate each tick (≤ MAX_CHUNKS
    // short polylines), and far simpler than diffing per-segment opacity.
    trailSegmentsRef.current.forEach((seg) => seg.remove())
    trailSegmentsRef.current = []

    if (latlngs.length >= 2) {
      const MAX_CHUNKS = 14
      const MIN_OP = 0.12   // oldest end — faint
      const MAX_OP = 0.95   // newest end — bright
      const L0 = latlngs.length
      const chunks = Math.min(MAX_CHUNKS, L0 - 1)
      for (let c = 0; c < chunks; c++) {
        const startIdx = Math.floor((c       * (L0 - 1)) / chunks)
        const endIdx   = Math.floor(((c + 1) * (L0 - 1)) / chunks)
        // +1 so adjacent chunks share a vertex and the line has no gaps.
        const pts = latlngs.slice(startIdx, endIdx + 1)
        if (pts.length < 2) continue
        const t = chunks === 1 ? 1 : c / (chunks - 1)
        const opacity = MIN_OP + (MAX_OP - MIN_OP) * t
        const seg = L.polyline(pts, {
          color: '#3B82F6',
          weight: 4.5,                 // ~50% thicker than the original 3
          opacity,
          lineCap:  'round',
          lineJoin: 'round',
          className: 'knockiq-trail',   // neon drop-shadow glow
          interactive: false,
        }).addTo(map)
        trailSegmentsRef.current.push(seg)
      }
    }

    // Keep the marching-ants overlay above the freshly-added chunks.
    if (trailFlowRef.current) trailFlowRef.current.bringToFront()
  }, [trail])

  // Knock ripple — when a new interaction appears, drop a one-shot expanding
  // ring at its location for instant "logged it" feedback. We gate on the
  // count we've already seen so resuming a session with existing pins doesn't
  // fire a burst of ripples on mount.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const list = interactions || []

    // First run for this map: record the baseline, don't ripple history.
    if (knockSeenRef.current === null) {
      knockSeenRef.current = list.length
      return
    }
    if (list.length <= knockSeenRef.current) {
      // No growth (or a reset/shrink) — just resync the baseline.
      knockSeenRef.current = list.length
      return
    }

    // Ripple each newly-added interaction that has a location.
    for (let i = knockSeenRef.current; i < list.length; i++) {
      const it = list[i]
      if (!it || it.lat == null || it.lng == null) continue
      const ripple = L.marker([it.lat, it.lng], {
        icon: makeKnockRipple(rippleColorFor(it.outcome)),
        zIndexOffset: 1500,
        interactive: false,
      }).addTo(map)
      setTimeout(() => ripple.remove(), 1100)
    }
    knockSeenRef.current = list.length
  }, [interactions])

  // Knock ripple heartbeat (manager live view). repLocations refreshes on a
  // poll; when a rep's door count climbs between polls, ripple at their pin so
  // the team map reads as a live activity feed. Green if a booking also landed,
  // else blue. Baselines on first run so the initial load doesn't fire a burst.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const list = repLocations || []
    const snap = (r) => ({
      doors:    Number(r.session?.doors_knocked || 0),
      bookings: Number(r.session?.bookings      || 0),
    })

    if (repStatsSeenRef.current === null) {
      repStatsSeenRef.current = new Map(list.map((r) => [r.rep_id, snap(r)]))
      return
    }

    const prev = repStatsSeenRef.current
    const next = new Map()
    for (const r of list) {
      const cur = snap(r)
      next.set(r.rep_id, cur)
      const before = prev.get(r.rep_id)
      if (before && r.lat != null && r.lng != null && cur.doors > before.doors) {
        const color = cur.bookings > before.bookings ? '#10B981' : '#3B82F6'
        const ripple = L.marker([r.lat, r.lng], {
          icon: makeKnockRipple(color),
          zIndexOffset: 2500,
          interactive: false,
        }).addTo(map)
        setTimeout(() => ripple.remove(), 1100)
      }
    }
    repStatsSeenRef.current = next
  }, [repLocations])

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

    const prevUserPos = lastUserPosRef.current
    lastUserPosRef.current = { lat: currentPos.lat, lng: currentPos.lng }

    if (!followUser) return

    const map = mapRef.current

    // ── Rep is exploring: hold position until they start walking again ──────
    if (exploringRef.current) {
      const anchor = exploreAnchorRef.current
      const movedFromAnchor = anchor
        ? map.distance([anchor.lat, anchor.lng], [currentPos.lat, currentPos.lng])
        : Infinity
      // Two independent "they're walking now" signals: the accelerometer
      // classifier (immediate, when the sensor's available) OR enough GPS
      // displacement from the explore anchor (robust fallback that ignores
      // standing jitter). Either one glides us back to the rep.
      const walking = motionClassifier.classify() === 'walking'
      if (walking || movedFromAnchor > RESUME_WALK_M) {
        recenterToUser(true)
      }
      return
    }

    // ── Following: glide to the new fix ─────────────────────────────────────
    // Preserve the rep's current zoom if they've pinched, but floor at 17.75
    // so the first-GPS-fix view lands at the tight default. If we're already
    // essentially centered on them, skip the move so a stationary rep's GPS
    // jitter doesn't cause constant micro-animations.
    const z = Math.max(map.getZoom() || 17.75, 17.75)
    programmaticMoveRef.current = true
    if (map.getZoom() < 17.5) {
      // First real fix (or zoomed way out): glide in to street level.
      map.flyTo([currentPos.lat, currentPos.lng], 17.75, { duration: 0.6 })
    } else {
      const movedSinceLast = prevUserPos
        ? map.distance([prevUserPos.lat, prevUserPos.lng], [currentPos.lat, currentPos.lng])
        : Infinity
      if (movedSinceLast >= 3) {
        map.panTo([currentPos.lat, currentPos.lng], { animate: true, duration: 0.5 })
      } else {
        programmaticMoveRef.current = false  // no move scheduled; clear the guard
      }
    }
  }, [currentPos, followUser])

  // Detect manual map gestures so we can pause auto-follow while the rep
  // explores. `dragstart` only fires from a real user drag, so it's a clean
  // signal. `zoomstart` fires for both user and programmatic zooms, so we
  // gate it on the programmatic-move guard. `moveend` clears the guard once
  // our own animations settle. Only active while following (followUser).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !followUser) return
    const onDragStart = () => beginExplore()
    const onZoomStart = () => { if (!programmaticMoveRef.current) beginExplore() }
    const onMoveEnd   = () => { programmaticMoveRef.current = false }
    map.on('dragstart', onDragStart)
    map.on('zoomstart', onZoomStart)
    map.on('moveend',   onMoveEnd)
    return () => {
      map.off('dragstart', onDragStart)
      map.off('zoomstart', onZoomStart)
      map.off('moveend',   onMoveEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followUser])

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
    ensureMapFxStyles()
    repMarkersRef.current.forEach((m) => m.remove())
    repMarkersRef.current = []

    repLocations.forEach((rep, idx) => {
      if (!rep.lat || !rep.lng) return
      const color    = REP_COLORS[idx % REP_COLORS.length]
      const initials = repInitials(rep.user?.full_name)
      // Active = mid-session and not flagged stalled → gets the live pulse.
      const active   = !!rep.session && !rep.stalled
      const icon     = makeRepPin(initials, color, !!rep.stalled, active)
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

    // Auto-fit map to show all active reps — but ONLY once, on the first poll
    // that has data. Re-fitting on every 10s poll would yank the manager's
    // viewport back to "all reps" mid-inspection, overriding both their manual
    // pan/zoom and the flyTo from tapping a rep (which drives the focus trail).
    // Tight zoom (single rep → 17, cluster → maxZoom 17) lands on street level.
    if (!repFitDoneRef.current && repLocations.length > 0) {
      const latlngs = repLocations.filter((r) => r.lat && r.lng).map((r) => [r.lat, r.lng])
      if (latlngs.length === 1) {
        mapRef.current.setView(latlngs[0], 17)
        repFitDoneRef.current = true
      } else if (latlngs.length > 1) {
        mapRef.current.fitBounds(latlngs, { padding: [20, 20], maxZoom: 17 })
        repFitDoneRef.current = true
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
    <div className={`relative w-full ${className}`} style={{ minHeight: '200px' }}>
      <div ref={containerRef} className="w-full h-full" style={{ minHeight: '200px' }} />

      {/* Recenter pill — only on the active-canvassing map, and only while the
          rep has panned away. Tapping snaps back to them and resumes follow.
          Sits bottom-center, above Leaflet panes (z 1000) and clear of the
          bottom knock UI. */}
      {followUser && exploring && (
        <button
          type="button"
          onClick={() => recenterToUser(true)}
          className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[1000] flex items-center gap-1.5 pl-3 pr-3.5 py-2 rounded-full bg-white shadow-lg ring-1 ring-black/5 text-sm font-semibold text-gray-800 active:bg-gray-100"
          aria-label="Recenter map on my location"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          Recenter
        </button>
      )}
    </div>
  )
})

export default MapView
