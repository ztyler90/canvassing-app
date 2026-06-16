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
import { useRef, useState } from 'react'
import { format, subDays, startOfDay, startOfMonth, subMonths, differenceInCalendarMonths } from 'date-fns'

// ─── Card shell ──────────────────────────────────────────────────────────────
// `trendLabel` (optional) — short, human noun that names what's trending
// (e.g. "revenue"). Surfaces in the trend chip's hover blurb so a manager
// who's never seen the dashboard can decode "▼ 63%" without guessing.
export function RichStatCard({ label, value, trend, trendLabel, icon, gradient, border, iconColor, children }) {
  return (
    <div className={`bg-gradient-to-br ${gradient} ${border} border rounded-2xl p-3 md:p-4`}>
      <div className="flex items-center justify-between">
        <div className={`p-1.5 rounded-lg bg-white/70 ${iconColor}`}>{icon}</div>
        {trend && <TrendChip trend={trend} label={trendLabel || label} />}
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
// Hover the chip and a tooltip surfaces the back-half-vs-front-half
// comparison rule in plain English. Done as a custom popover (not the
// native `title=` attribute) so the blurb appears instantly instead of
// after the OS-level hover delay, and so it's discoverable on touch.
export function TrendChip({ trend, label = 'this metric' }) {
  const [open, setOpen] = useState(false)
  if (!trend) return null
  const { dir, pct } = trend
  const blurb =
    `Compares the second half of the selected period to the first half for ${label}. ` +
    `▲ means the back half outpaced the front; ▼ means it lagged.`
  const base =
    'relative inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full cursor-help'
  const tone =
    dir === 'up'   ? 'bg-green-100 text-green-800' :
    dir === 'down' ? 'bg-red-100 text-red-800'     :
                     'bg-slate-100 text-slate-600'
  const symbol =
    dir === 'up'   ? `▲ ${pct}%` :
    dir === 'down' ? `▼ ${pct}%` :
                     '—'
  return (
    <span
      className={`${base} ${tone}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      aria-label={blurb}
    >
      {symbol}
      {open && (
        <span
          role="tooltip"
          className="absolute right-0 top-full mt-1.5 w-56 z-20 pointer-events-none rounded-md bg-gray-900 text-white text-[10.5px] leading-snug font-medium px-2.5 py-1.5 shadow-lg"
        >
          {blurb}
        </span>
      )}
    </span>
  )
}

// ─── Hover-tooltip helpers ───────────────────────────────────────────────────
// Centralized so both sparklines share the same tooltip styling + orientation
// rules. The tooltip is rendered as an absolutely-positioned div outside the
// SVG (HTML, not <foreignObject>) so it can overflow the chart bounds cleanly
// and pick up Tailwind classes.
//
// `xRatio` is 0..1 across the chart. We flip the anchor side near the edges
// so the tooltip doesn't slide off the card. `topOffset` lets bar charts push
// the tooltip up above the tallest bar instead of sitting on top of it.
function ChartTooltip({ xRatio, label, value, topOffset = -8 }) {
  // Left/right side flip: past 65% from the left we anchor from the right
  // so a "Jun 30" tooltip on the rightmost bar doesn't get clipped.
  const flip = xRatio > 0.65
  return (
    <div
      className="absolute z-20 pointer-events-none whitespace-nowrap rounded-md bg-gray-900 text-white text-[10px] leading-tight font-medium px-1.5 py-1 shadow-lg"
      style={{
        left: flip ? undefined : `${xRatio * 100}%`,
        right: flip ? `${(1 - xRatio) * 100}%` : undefined,
        top: topOffset,
        transform: flip ? 'translateY(-100%)' : 'translate(-50%, -100%)',
      }}
    >
      <div className="text-gray-300">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  )
}

// Map a mousemove event to the nearest series index. Pure function so it
// stays testable and both sparklines can share the same snap behavior.
function hoverIndexFromEvent(e, host, count) {
  if (!host || !count) return null
  const rect = host.getBoundingClientRect()
  const x = e.clientX - rect.left
  const i = Math.round((x / Math.max(rect.width, 1)) * (count - 1))
  return Math.max(0, Math.min(count - 1, i))
}

// Format a Date for the tooltip label, picking a format suited to the
// bucket unit. Month-bucketed series read as "Jun 2026"; daily series
// read as "Mon, Jun 2" (or just "Monday" when the series is small).
// Falls back to an index-relative label when we don't have a dates array.
function tooltipLabelFor(dates, i, totalCount, bucketUnit = 'day') {
  const d = dates?.[i]
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    if (bucketUnit === 'month') return format(d, 'MMM yyyy')
    return format(d, totalCount > 10 ? 'EEE, MMM d' : 'EEEE')
  }
  return `Point ${i + 1} of ${totalCount}`
}

// ─── Area sparkline ──────────────────────────────────────────────────────────
// Uses preserveAspectRatio="none" so the path stretches responsively in a
// 120×36 viewBox. Draws a filled area + top line + terminal dot.
//
// New optional props:
//   `dates`           — parallel array of Date objects (one per value), so
//                       the hover tooltip can show "Mon, Jun 2".
//   `valueFormatter`  — function(value) → string; defaults to a compact
//                       number. Pass `(v) => "$" + formatCompact(v)` for $.
export function MiniSparkArea({
  values = [], dates = [], valueFormatter, bucketUnit = 'day',
  color = '#5ea636', fill = '#7ac94373',
}) {
  const hostRef = useRef(null)
  const [hoverIdx, setHoverIdx] = useState(null)
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
  const fmt = valueFormatter || formatCompact

  const onMove  = (e) => setHoverIdx(hoverIndexFromEvent(e, hostRef.current, values.length))
  const onLeave = () => setHoverIdx(null)

  // Hovered point's screen position, as a 0..1 ratio of chart width, so the
  // HTML tooltip can sit above the exact data point even though the SVG is
  // stretched (preserveAspectRatio="none").
  const xRatio = hoverIdx != null ? pts[hoverIdx][0] / w : 0

  return (
    <div
      ref={hostRef}
      className="relative mt-1"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9 md:h-12 block" preserveAspectRatio="none">
        <path d={areaPath} fill={fill} />
        <path d={linePath} stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last[0]} cy={last[1]} r="2.4" fill={color} />
        {hoverIdx != null && (
          <g>
            <line
              x1={pts[hoverIdx][0]} x2={pts[hoverIdx][0]} y1={0} y2={h}
              stroke="#475569" strokeWidth="0.6" strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={pts[hoverIdx][0]} cy={pts[hoverIdx][1]} r="2.6"
              fill="#fff" stroke={color} strokeWidth="1.4"
            />
          </g>
        )}
      </svg>
      {hoverIdx != null && (
        <ChartTooltip
          xRatio={xRatio}
          label={tooltipLabelFor(dates, hoverIdx, values.length, bucketUnit)}
          value={fmt(values[hoverIdx])}
        />
      )}
    </div>
  )
}

// ─── Mini bar sparkline ──────────────────────────────────────────────────────
// Downsamples to `target` buckets (default 8) so long series stay legible.
// Final bar is rendered with the `highlight` color to draw the eye to "now".
//
// On hover, the bar under the mouse highlights and a tooltip shows the
// underlying date range + summed value for that bucket — important since
// each bar may represent several days once we downsample a 30-day series.
export function MiniSparkBars({
  values = [], dates = [], valueFormatter, bucketUnit = 'day',
  color = '#2757d7', highlight = '#1e44b0', target = 8,
}) {
  const hostRef = useRef(null)
  const [hoverIdx, setHoverIdx] = useState(null)
  if (!values.length) return <div className="w-full h-9 md:h-12 mt-1" />

  // Downsample both values + dates together so each visible bar knows the
  // date span it represents. `bucketDates` is an array of {from, to} pairs
  // (or null when no parallel dates were passed).
  const { bars, bucketDates } = downsamplePaired(values, dates, target)
  const w = 120, h = 36
  const max = Math.max(...bars, 1)
  const barW = (w - 4) / bars.length - 2
  const fmt = valueFormatter || formatCompact

  const onMove = (e) => {
    if (!hostRef.current) return
    const rect = hostRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    // Snap to the bucket the mouse is over (each bucket gets equal width).
    const i = Math.floor((x / Math.max(rect.width, 1)) * bars.length)
    setHoverIdx(Math.max(0, Math.min(bars.length - 1, i)))
  }
  const onLeave = () => setHoverIdx(null)

  const xRatio = hoverIdx != null
    ? (2 + hoverIdx * (barW + 2) + barW / 2) / w
    : 0

  return (
    <div
      ref={hostRef}
      className="relative mt-1"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9 md:h-12 block" preserveAspectRatio="none">
        <g>
          {bars.map((v, i) => {
            const bh = Math.max((v / max) * (h - 4), 1.5)
            const x = 2 + i * (barW + 2)
            const y = h - 2 - bh
            const isLast    = i === bars.length - 1
            const isHovered = i === hoverIdx
            return (
              <rect
                key={i} x={x} y={y} width={barW} height={bh} rx="2"
                fill={isHovered ? '#0f172a' : isLast ? highlight : color}
                opacity={isHovered ? 1 : isLast ? 1 : 0.85}
              />
            )
          })}
        </g>
      </svg>
      {hoverIdx != null && (
        <ChartTooltip
          xRatio={xRatio}
          label={bucketLabelFor(bucketDates, hoverIdx, bars.length, bucketUnit)}
          value={fmt(bars[hoverIdx])}
        />
      )}
    </div>
  )
}

// Downsample values + dates in lockstep so each bucket carries the {from,to}
// of the source rows it averaged. Mirrors `downsample()` exactly when
// values.length <= target; otherwise builds size-matched buckets.
function downsamplePaired(values, dates, target) {
  if (values.length <= target) {
    return {
      bars: values,
      bucketDates: values.map((_, i) => {
        const d = dates?.[i]
        return d instanceof Date ? { from: d, to: d } : null
      }),
    }
  }
  const size = values.length / target
  const bars = []
  const bucketDates = []
  for (let i = 0; i < target; i++) {
    const lo = Math.floor(i * size)
    const hi = Math.floor((i + 1) * size)
    const slice = values.slice(lo, hi)
    bars.push(slice.reduce((s, v) => s + v, 0) / Math.max(slice.length, 1))
    const from = dates?.[lo]
    const to   = dates?.[Math.max(lo, hi - 1)]
    bucketDates.push(
      from instanceof Date && to instanceof Date ? { from, to } : null
    )
  }
  return { bars, bucketDates }
}

// "Mon, Jun 2" for a single-day bucket, "May 5 – May 11" for a multi-day
// downsampled bucket. Month-bucket series get a "MMM yyyy" form (single
// month) or "MMM – MMM yyyy" (range). Falls back to an index-relative
// label when dates weren't provided.
function bucketLabelFor(bucketDates, i, totalBuckets, bucketUnit = 'day') {
  const b = bucketDates?.[i]
  if (!b) return `Bucket ${i + 1} of ${totalBuckets}`
  if (bucketUnit === 'month') {
    if (b.from.getTime() === b.to.getTime()) return format(b.from, 'MMM yyyy')
    return `${format(b.from, 'MMM')} – ${format(b.to, 'MMM yyyy')}`
  }
  if (b.from.getTime() === b.to.getTime()) return format(b.from, 'EEE, MMM d')
  return `${format(b.from, 'MMM d')} – ${format(b.to, 'MMM d')}`
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
// Bucket sessions into `monthCount` calendar months (oldest → newest),
// ending with the current month. Zero-fills empty months so the chart's
// X axis is regular even if the team skipped a month. Each row carries
// `date` set to the first-of-month so downstream formatting can render
// "Jun 2026" / "Jul 2026" labels.
//
// `monthCount` is typically derived from the time span of the data —
// pass `monthsCoveringSessions(sessions)` for the "all time" view. The
// helper caps at 24 so a very-long-tenured org doesn't blow out the
// chart width.
export function groupSessionsByMonth(sessions, monthCount) {
  const end = startOfMonth(new Date())
  const order = []
  const buckets = {}
  for (let i = 0; i < monthCount; i++) {
    const d   = subMonths(end, monthCount - 1 - i)
    const key = format(d, 'yyyy-MM')
    buckets[key] = { date: d, revenue: 0, doors: 0, bookings: 0, estimates: 0 }
    order.push(key)
  }
  sessions.forEach((s) => {
    if (!s.started_at) return
    const key = format(startOfMonth(new Date(s.started_at)), 'yyyy-MM')
    const b   = buckets[key]
    if (!b) return
    b.revenue   += Number(s.revenue_booked) || 0
    b.doors     += s.doors_knocked  || 0
    b.bookings  += s.bookings       || 0
    b.estimates += s.estimates      || 0
  })
  return order.map((k) => buckets[k])
}

// How many months back the oldest session reaches (inclusive of the
// current month). Capped at 24 to keep month labels legible. Returns at
// least 1 even when there are no sessions, so the chart still renders a
// "this month" bucket instead of collapsing to zero columns.
export function monthsCoveringSessions(sessions) {
  if (!sessions || sessions.length === 0) return 1
  let oldest = Infinity
  for (const s of sessions) {
    const t = s.started_at ? new Date(s.started_at).getTime() : Infinity
    if (t < oldest) oldest = t
  }
  if (!Number.isFinite(oldest)) return 1
  const span = differenceInCalendarMonths(new Date(), new Date(oldest)) + 1
  return Math.min(Math.max(span, 1), 24)
}

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

// Daily series of bookings + revenue bucketed by the date each job actually
// BOOKED (booked_at), not the session date. Mirrors groupSessionsByDay's output
// shape ({ date, bookings, revenue }) so computeTrend + the spark charts work
// unchanged. This keeps the Bookings/Revenue cards consistent with commission:
// a deal converted this week shows up this week. `bookedItems` are interactions
// with stage='booked' (estimated_value = job value, booked_at = conversion day).
export function groupBookedByDay(bookedItems, days) {
  const end = startOfDay(new Date())
  const buckets = {}
  const order   = []
  for (let i = 0; i < days; i++) {
    const d   = subDays(end, days - 1 - i)
    const key = format(d, 'yyyy-MM-dd')
    buckets[key] = { date: d, revenue: 0, bookings: 0 }
    order.push(key)
  }
  ;(bookedItems || []).forEach((it) => {
    const ts = it.booked_at || it.created_at
    if (!ts) return
    const key = format(startOfDay(new Date(ts)), 'yyyy-MM-dd')
    const b   = buckets[key]
    if (!b) return
    b.revenue  += Number(it.estimated_value) || 0
    b.bookings += 1
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
