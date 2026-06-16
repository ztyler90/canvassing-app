/*
 * TeamLeaderboardChart — rep-facing "where do I stand?" bar chart.
 *
 * Only rendered when the manager has turned on `share_leaderboard` for the org
 * (see tier.isLeaderboardShared). Shows every rep's standing for the selected
 * metric over the selected period, with the viewing rep's own bar highlighted
 * so they can see their rank at a glance.
 *
 * Data comes from getLeaderboardData(period), which already returns per-rep
 * aggregates (doors / conversations / estimates / bookings / revenue) and is
 * readable by reps under the same-org RLS policy on canvassing_sessions.
 */
import { useEffect, useMemo, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { getLeaderboardData } from '../lib/supabase.js'
import { formatCompact } from './StatSparkCards.jsx'

const BRAND_BLUE = '#1B4FCC'

const PERIODS = [
  ['today', 'Today'],
  ['week',  'Week'],
  ['month', 'Month'],
]

export default function TeamLeaderboardChart({ repId, estimateNoun = 'estimate', hideRevenue = false }) {
  const [period, setPeriod]   = useState('week')
  const [metric, setMetric]   = useState('doors')
  const [rows, setRows]       = useState(null)   // null = not loaded
  const [loading, setLoading] = useState(false)

  const estimateLabel = estimateNoun === 'appointment' ? 'Appts' : 'Estimates'
  const METRICS = [
    { key: 'doors',         label: 'Doors' },
    { key: 'conversations', label: 'Convos' },
    { key: 'estimates',     label: estimateLabel },
    { key: 'bookings',      label: 'Bookings' },
    // Revenue is shown unless the manager opted to hide booked dollars.
    ...(hideRevenue ? [] : [{ key: 'revenue', label: 'Revenue', money: true }]),
  ]
  // If revenue was the active metric and the manager just hid it, fall back.
  useEffect(() => {
    if (hideRevenue && metric === 'revenue') setMetric('doors')
  }, [hideRevenue, metric])
  const activeMetric = METRICS.find((m) => m.key === metric) || METRICS[0]

  useEffect(() => {
    let alive = true
    setLoading(true)
    getLeaderboardData(period)
      .then((data) => { if (alive) setRows(Array.isArray(data) ? data : []) })
      .catch(() => { if (alive) setRows([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [period])

  const { ranked, max, myRank } = useMemo(() => {
    const list = (rows || [])
      .map((r) => ({ id: r.id, name: r.name || 'Unknown', value: Number(r[metric]) || 0 }))
      .sort((a, b) => b.value - a.value)
    const max = Math.max(1, ...list.map((r) => r.value))
    const myRank = list.findIndex((r) => r.id === repId)
    return { ranked: list, max, myRank: myRank >= 0 ? myRank + 1 : null }
  }, [rows, metric, repId])

  const fmt = (v) => (activeMetric.money ? `$${formatCompact(v)}` : Math.round(v).toLocaleString())

  return (
    <div className="bg-white rounded-2xl p-4 md:p-5 shadow-sm border border-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-gray-800 font-semibold text-sm md:text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-gray-400" /> Team Leaderboard
        </p>
        {myRank && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full text-white shrink-0"
            style={{ backgroundColor: BRAND_BLUE }}>
            You're #{myRank}
          </span>
        )}
      </div>

      {/* Period toggle */}
      <div className="flex gap-1 mb-2.5 bg-gray-100 rounded-lg p-0.5">
        {PERIODS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition-colors ${
              period === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Metric toggle — horizontally scrollable so 5 chips never wrap */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-colors ${
              metric === m.key
                ? 'text-white border-transparent'
                : 'bg-white text-gray-600 border-gray-200'
            }`}
            style={metric === m.key ? { backgroundColor: BRAND_BLUE } : undefined}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Bars */}
      {loading && <p className="text-center text-sm text-gray-400 py-6">Loading leaderboard…</p>}

      {!loading && ranked.length === 0 && (
        <p className="text-center text-sm text-gray-400 py-6">No team activity in this period yet.</p>
      )}

      {!loading && ranked.length > 0 && (
        <div className="space-y-2.5">
          {ranked.map((r, i) => {
            const isMe = r.id === repId
            const pct  = Math.max(2, (r.value / max) * 100)  // floor so tiny bars stay visible
            return (
              <div key={r.id} className="flex items-center gap-2.5">
                <span className={`w-5 text-right text-xs font-bold tabular-nums shrink-0 ${isMe ? 'text-blue-700' : 'text-gray-400'}`}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-semibold truncate ${isMe ? 'text-blue-700' : 'text-gray-700'}`}>
                      {isMe ? `${r.name.split(' ')[0]} (You)` : r.name}
                    </span>
                    <span className={`text-xs font-bold tabular-nums shrink-0 ml-2 ${isMe ? 'text-blue-700' : 'text-gray-600'}`}>
                      {fmt(r.value)}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: isMe
                          ? `linear-gradient(90deg, ${BRAND_BLUE} 0%, #4338CA 100%)`
                          : '#CBD5E1',
                      }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
