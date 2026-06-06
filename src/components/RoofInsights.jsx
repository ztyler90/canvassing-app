/**
 * RoofInsights — Pro-gated roof intelligence panel (Google Solar).
 *
 * Shows four rep-facing signals derived from Google's Building Insights:
 *   • Roof size      — sq ft + Small/Medium/Large (job-size proxy)
 *   • Facets         — # roof segments + Simple/Moderate/Complex (complexity)
 *   • Pitch          — avg degrees + Low/Moderate/Steep (difficulty + safety)
 *   • Sun exposure   — sunshine hrs/yr + Low/Good/Excellent
 *
 * Used in two places:
 *   • LeadDetailModal  (manager drills into a pipeline lead)
 *   • InteractionModal (rep logs/sizes a door)
 *
 * Gating (matches the ProSection / LockedTeaser pattern):
 *   • Pro org      → fetches and renders the live panel.
 *   • Standard org → renders a grayed teaser with a Pro badge; tapping opens
 *                    the ProUpgradeModal. Standard reps SEE what they're
 *                    missing but no Google call is ever made for them.
 *
 * Data fetch is lazy + cached server-side, so a re-opened lead or a
 * re-canvassed door costs nothing. Any failure hides the panel — the door
 * flow is never blocked on Solar.
 */
import { useEffect, useState } from 'react'
import { Home, Layers, Mountain, Sun, Loader2, Lock } from 'lucide-react'
import { getRoofInsights } from '../lib/solar.js'
import { ProBadge, ProUpgradeModal } from './ProGate.jsx'

const BRAND_BLUE = '#1B4FCC'

// Bucket → swatch. Pitch "Steep" is amber on purpose: it's a difficulty +
// ladder-safety flag, not a positive.
const TONE = {
  good:    { bg: '#ECFDF5', fg: '#047857' },  // green
  mid:     { bg: '#EFF6FF', fg: '#1D4ED8' },  // blue
  warn:    { bg: '#FFFBEB', fg: '#B45309' },  // amber
  neutral: { bg: '#F3F4F6', fg: '#374151' },  // gray
}

const sizeTone     = (b) => (b === 'Large' ? TONE.good : b === 'Medium' ? TONE.mid : TONE.neutral)
const complexTone  = (b) => (b === 'Complex' ? TONE.good : b === 'Moderate' ? TONE.mid : TONE.neutral)
const pitchTone    = (b) => (b === 'Steep' ? TONE.warn : b === 'Moderate' ? TONE.mid : TONE.neutral)
const sunTone      = (b) => (b === 'Excellent' ? TONE.good : b === 'Good' ? TONE.mid : TONE.neutral)

function Chip({ icon: Icon, label, value, sub, tone }) {
  if (value == null) return null
  const t = tone || TONE.neutral
  return (
    <div className="flex-1 min-w-[80px] rounded-xl px-2.5 py-2" style={{ backgroundColor: t.bg }}>
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className="w-3 h-3" style={{ color: t.fg }} />
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: t.fg }}>{label}</span>
      </div>
      <div className="text-sm font-bold leading-tight" style={{ color: t.fg }}>{value}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: t.fg, opacity: 0.75 }}>{sub}</div>}
    </div>
  )
}

export default function RoofInsights({ lat, lng, isPro = false, enabled = false, className = '' }) {
  const [state, setState] = useState('idle')   // idle | loading | ready | none | error
  const [data, setData]   = useState(null)
  const [showUpsell, setShowUpsell] = useState(false)

  const hasCoords = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
  // Only Pro orgs that have switched the add-on ON ever hit the Solar API.
  const live = isPro && enabled

  useEffect(() => {
    let alive = true
    if (!live || !hasCoords) return
    setState('loading'); setData(null)
    getRoofInsights(lat, lng).then((res) => {
      if (!alive) return
      if (!res)            { setState('error'); return }
      if (!res.found || !res.insights) { setState('none'); return }
      setData(res.insights); setState('ready')
    })
    return () => { alive = false }
  }, [lat, lng, live, hasCoords])

  if (!hasCoords) return null

  // ── Standard tier: locked teaser ──────────────────────────────────────────
  if (!isPro) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowUpsell(true)}
          className={`w-full text-left rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 ${className}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sun className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-xs font-semibold text-gray-500">Roof insights</span>
            </div>
            <ProBadge />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            Roof size, complexity, pitch &amp; sun exposure — tap to unlock.
          </p>
        </button>
        <ProUpgradeModal
          open={showUpsell}
          onClose={() => setShowUpsell(false)}
          feature="Roof Insights"
          blurb="See each home's roof size, complexity, pitch and sun exposure before you quote — straight from satellite data."
          perks={[
            'Roof square footage to size every estimate',
            'Roofline complexity & pitch for accurate pricing',
            'Steep-roof safety flags before the crew arrives',
          ]}
        />
      </>
    )
  }

  // Pro org, but the manager hasn't switched the add-on on → render nothing and
  // never call the Solar API. This is the cost-saver for teams that don't want
  // roof data.
  if (!enabled) return null

  // ── Pro tier + add-on ON: live panel ──────────────────────────────────────
  const header = (
    <div className="flex items-center gap-1.5 mb-2">
      <Sun className="w-3.5 h-3.5" style={{ color: BRAND_BLUE }} />
      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: BRAND_BLUE }}>Roof insights</span>
      {state === 'ready' && data?.imageryDate && (
        <span className="text-[10px] text-gray-400 ml-auto">satellite · {data.imageryDate}</span>
      )}
    </div>
  )

  return (
    <div className={`rounded-xl border border-gray-100 bg-white p-3 ${className}`}>
      {header}

      {state === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the roof…
        </div>
      )}

      {state === 'none' && (
        <p className="text-[11px] text-gray-400">No satellite roof data for this address.</p>
      )}

      {state === 'error' && (
        <p className="text-[11px] text-gray-400">Roof insights unavailable right now.</p>
      )}

      {state === 'ready' && data && (
        <div className="flex gap-2 flex-wrap">
          <Chip
            icon={Home} label="Roof size"
            value={data.roofAreaSqFt ? `${data.roofAreaSqFt.toLocaleString()} ft²` : null}
            sub={data.sizeBucket} tone={sizeTone(data.sizeBucket)}
          />
          <Chip
            icon={Layers} label="Facets"
            value={data.segmentCount != null ? String(data.segmentCount) : null}
            sub={data.complexityBucket} tone={complexTone(data.complexityBucket)}
          />
          <Chip
            icon={Mountain} label="Pitch"
            value={data.avgPitchDeg != null ? `${data.avgPitchDeg}°` : null}
            sub={data.pitchBucket} tone={pitchTone(data.pitchBucket)}
          />
          <Chip
            icon={Sun} label="Sun"
            value={data.sunHoursPerYear ? `${data.sunHoursPerYear.toLocaleString()} hrs` : null}
            sub={data.sunBucket} tone={sunTone(data.sunBucket)}
          />
        </div>
      )}
    </div>
  )
}
