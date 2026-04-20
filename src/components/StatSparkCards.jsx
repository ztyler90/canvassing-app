// Shared KPI/stat card primitives used by both the Manager Overview and the
// Rep Home. Centralized so the two screens stay visually consistent — the
// rep sees the same gradient card + sparkline treatment the manager does.
//
// Exports:
//   <RichStatCard>     — gradient card shell with icon bubble, trend chip,
//                        big value, and a slot for a micro-chart child.
//   <TrendChip>        — ▲/▼/— pill rendered from a {dir, pct} object.
//   <MiniSparkArea>    — area sparkline for revenue/bookings-style series.
//   <MiniSparkBars>    — mini bar sparkline for doors-style volume series.
//   <RadialGauge>      — ring gauge used for % vs goal (close rate, etc.).
//
// Helpers (plain functions):
//   formatCompact(n)            — "$18.5k" / "1.2k" / "32" style labels.
//   computeTrend(series, field) — last-half vs first-half honest within-
//                                 window trend; returns {dir, pct}.
//   groupSessionsByDay(sessions, days) — zero-filled daily buckets for the
//                                 most recent N calendar days, summing
//                                 revenue / doors / bookings / estimates.
//   downsample(values, target)  — averages a long series into exactly
//                                 `target` buckets (used for mini-bars).
import { format, subDays, startOfDay } from 'date-fns'

// ─── Card shell ──────────────────────────────────────────────────────────────
export function RichStatCard({ label, value, trend, icon, gradient, border, iconColor, children }) {
  return (
    <div className={`bg-gradient-to-br ${gradient} ${border} border rounded-2xl p-3 md:p-4`}>
      <div className="flex items-center justify-between">
        <div className={`p-1.5 rounded-lg bg-white/70 ${iconColor}`}>{icon}</div>
        {trend && <TrendChip trend={trend} />}
      </div>
      <div className="mt-2">
        <p className="text-[11px] font-semibold text-gray-600">{label}</p>
        <p className="text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900">{value}</p>
      </div>
      {children}
    </div>
  )
}

// ─── Trend chip ──────────────────────────────────────────────────────────────
export function TrendChip({ trend }) {
  if (!trend) return null
  const { dir, pct } = trend
  if (dir === 'up')   return <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-800">▲ {pct}%</span>
  if (dir === 'down') return <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-800">▼ {pct}%</span>
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">—</span>
}

// ─── Area sparkline ──────────────────────────────────────────────────────────
// Uses preserveAspectRatio="none" so the path stretches responsively in a
// 120×36 viewBox. Draws a filled area + top line + terminal dot.
export function MiniSparkArea({ values = [], color = '#5ea636', fill = '#7ac94373' }) {
  if (!values.length) return <div className="w-full h-9 md:h-12 mt-1" />
  const w = 120, h = 36, pad = 4
  const max = Math.max(...values, 1)
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0
  const pts = values.map((v, i) => {
    const x = pad + i * step
    const y = h - pad - (v / max) * (h - pad * 2)
    return [x, y]
  })
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${(w - pad).toFixed(1)},${(h - pad).toFixed(1)} L${pad},${(h - pad).toFixed(1)} Z`
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9 md:h-12 mt-1" preserveAspectRatio="none">
      <path d={areaPath} fill={fill} />
      <path d={linePath} stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill={color} />
    </svg>
  )
}

// ─── Mini bar sparkline ──────────────────────────────────────────────────────
// Downsamples to `target` buckets (default 8) so long series stay legible.
// Final bar is rendered with the `highlight` color to draw the eye to "now".
export function MiniSparkBars({ values = [], color = '#2757d7', highlight = '#1e44b0', target = 8 }) {
  if (!values.length) return <div className="w-full h-9 md:h-12 mt-1" />
  const bars = downsample(values, target)
  const w = 120, h = 36
  const max = Math.max(...bars, 1)
  const barW = (w - 4) / bars.length - 2
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9 md:h-12 mt-1" preserveAspectRatio="none">
      <g>
        {bars.map((v, i) => {
          const bh = Math.max((v / max) * (h - 4), 1.5)
          const x = 2 + i * (barW + 2)
          const y = h - 2 - bh
          return <rect key={i} x={x} y={y} width={barW} height={bh} rx="2"
                       fill={i === bars.length - 1 ? highlight : color} opacity={i === bars.length - 1 ? 1 : 0.85} />
        })}
      </g>
    </svg>
  )
}

// ─── Radial gauge ────────────────────────────────────────────────────────────
// Ring filled to `pct` (0–100). Gradient id is namespaced so multiple gauges
// on the same page don't collide.
let _gaugeId = 0
export function RadialGauge({ pct = 0 }) {
  const r = 16
  const circumference = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(100, pct)) / 100 * circumference
  const id = `kiq-gauge-${++_gaugeId}`
  return (
    <svg className="shrink-0 w-14 h-14 md:w-16 md:h-16" viewBox="0 0 42 42">
      <circle cx="21" cy="21" r={r} fill="none" stroke="#ede9fe" strokeWidth="6" />
      <circle cx="21" cy="21" r={r} fill="none"
              stroke={`url(#${id})`} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${filled.toFixed(2)} ${circumference.toFixed(2)}`}
              transform="rotate(-90 21 21)" />
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Bucket sessions into `days` calendar days (oldest → newest). Sums the
// revenue/doors/bookings/estimates per day; missing days get zero rows.
export function groupSessionsByDay(sessions, days) {
  const end = startOfDay(new Date())
  const buckets = {}
  const order   = []
  for (let i = 0; i < days; i++) {
    const d   = subDays(end, days - 1 - i)
    const key = format(d, 'yyyy-MM-dd')
    buckets[key] = { date: d, revenue: 0, doors: 0, bookings: 0, estimates: 0 }
    order.push(key)
  }
  sessions.forEach((s) => {
    if (!s.started_at) return
    const key = format(startOfDay(new Date(s.started_at)), 'yyyy-MM-dd')
    const b   = buckets[key]
    if (!b) return
    b.revenue   += Number(s.revenue_booked) || 0
    b.doors     += s.doors_knocked  || 0
    b.bookings  += s.bookings       || 0
    b.estimates += s.estimates      || 0
  })
  return order.map((k) => buckets[k])
}

// Compare the last half of a day-series to the first half. Returns
// { dir: 'up' | 'down' | 'flat', pct }. Honest within-window trend —
// no extra query to pull the previous period.
export function computeTrend(series, field) {
  if (!series || series.length < 2) return { dir: 'flat', pct: 0 }
  const mid   = Math.floor(series.length / 2)
  const first = series.slice(0, mid).reduce((s, x) => s + (x[field] || 0), 0)
  const last  = series.slice(mid).reduce((s, x) => s + (x[field] || 0), 0)
  if (first === 0 && last === 0) return { dir: 'flat', pct: 0 }
  if (first === 0)                return { dir: 'up',   pct: 100 }
  const pct = Math.round(((last - first) / first) * 100)
  return { dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat', pct: Math.abs(pct) }
}

// Downsample a long series to exactly `target` bars by averaging buckets.
export function downsample(values, target) {
  if (values.length <= target) return values
  const size = values.length / target
  const out  = []
  for (let i = 0; i < target; i++) {
    const slice = values.slice(Math.floor(i * size), Math.floor((i + 1) * size))
    out.push(slice.reduce((s, v) => s + v, 0) / Math.max(slice.length, 1))
  }
  return out
}

// Compact formatter — 18450 → "18.5k", 1247 → "1.2k", 32 → "32".
export function formatCompact(n) {
  if (n == null || Number.isNaN(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return Math.round(n).toString()
}
