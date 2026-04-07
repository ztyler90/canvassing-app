import { useEffect, useState } from 'react'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import { Users, DollarSign, Home, TrendingUp, MapPin, BarChart2, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { getAllSessions, getAllReps, getManagerMapData, signOut } from '../lib/supabase.js'
import MapView from '../components/MapView.jsx'

const BRAND_GREEN = '#1A6B3A'

const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart2 },
  { id: 'reps',     label: 'Reps',     icon: Users     },
  { id: 'map',      label: 'Map',      icon: MapPin    },
]

export default function ManagerDashboard() {
  const { user } = useAuth()
  const [tab, setTab]               = useState('overview')
  const [sessions, setSessions]     = useState([])
  const [reps, setReps]             = useState([])
  const [mapData, setMapData]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [dateRange, setDateRange]   = useState('7')   // days
  const [selectedRep, setSelectedRep] = useState('all')

  useEffect(() => { loadData() }, [dateRange, selectedRep])

  async function loadData() {
    setLoading(true)
    const days     = parseInt(dateRange)
    const dateFrom = startOfDay(subDays(new Date(), days)).toISOString()
    const dateTo   = endOfDay(new Date()).toISOString()
    const filters  = { dateFrom, dateTo, ...(selectedRep !== 'all' ? { repId: selectedRep } : {}) }

    const [sess, repList, interactions] = await Promise.all([
      getAllSessions(filters),
      getAllReps(),
      getManagerMapData(filters),
    ])
    setSessions(sess)
    setReps(repList)
    setMapData(interactions)
    setLoading(false)
  }

  // Aggregate KPIs
  const totalRevenue    = sessions.reduce((s, x) => s + (x.revenue_booked || 0), 0)
  const totalDoors      = sessions.reduce((s, x) => s + (x.doors_knocked || 0), 0)
  const totalBookings   = sessions.reduce((s, x) => s + (x.bookings || 0), 0)
  const totalEstimates  = sessions.reduce((s, x) => s + (x.estimates || 0), 0)
  const closeRate       = totalDoors > 0 ? ((totalBookings / totalDoors) * 100).toFixed(1) : '0'
  const revenuePerDoor  = totalDoors > 0 ? (totalRevenue / totalDoors).toFixed(2) : '0'

  // Per-rep breakdown
  const repMap = {}
  sessions.forEach((s) => {
    const repName = s.users?.full_name || s.rep_id
    if (!repMap[s.rep_id]) {
      repMap[s.rep_id] = {
        id: s.rep_id, name: repName,
        sessions: 0, doors: 0, bookings: 0, revenue: 0, estimates: 0,
      }
    }
    const r = repMap[s.rep_id]
    r.sessions++
    r.doors    += s.doors_knocked || 0
    r.bookings += s.bookings || 0
    r.revenue  += s.revenue_booked || 0
    r.estimates += s.estimates || 0
  })
  const repStats = Object.values(repMap).sort((a, b) => b.revenue - a.revenue)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="px-5 pt-12 pb-4" style={{ backgroundColor: BRAND_GREEN }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-green-200 text-sm">Manager View</p>
            <h1 className="text-white text-xl font-bold">Dashboard</h1>
          </div>
          <button onClick={signOut} className="p-2 rounded-full bg-white/20">
            <LogOut className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="flex-1 bg-white/20 text-white text-sm rounded-xl px-3 py-2 border border-white/30 focus:outline-none"
          >
            <option value="1"  className="text-gray-900">Today</option>
            <option value="7"  className="text-gray-900">Last 7 days</option>
            <option value="30" className="text-gray-900">Last 30 days</option>
            <option value="90" className="text-gray-900">Last 90 days</option>
          </select>
          <select
            value={selectedRep}
            onChange={(e) => setSelectedRep(e.target.value)}
            className="flex-1 bg-white/20 text-white text-sm rounded-xl px-3 py-2 border border-white/30 focus:outline-none"
          >
            <option value="all" className="text-gray-900">All Reps</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id} className="text-gray-900">{r.full_name || r.phone}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-white border-b flex">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-3 flex flex-col items-center gap-0.5 text-xs font-medium transition-colors ${
                active ? 'text-brand-700 border-b-2 border-brand-700' : 'text-gray-500'
              }`}
              style={active ? { color: BRAND_GREEN, borderBottomColor: BRAND_GREEN } : {}}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 pb-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-8 h-8 border-3 border-brand-700 border-t-transparent rounded-full"
              style={{ borderColor: `${BRAND_GREEN} transparent transparent transparent`, borderWidth: 3 }} />
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <OverviewTab
                sessions={sessions}
                totalRevenue={totalRevenue}
                totalDoors={totalDoors}
                totalBookings={totalBookings}
                totalEstimates={totalEstimates}
                closeRate={closeRate}
                revenuePerDoor={revenuePerDoor}
              />
            )}
            {tab === 'reps' && <RepsTab repStats={repStats} />}
            {tab === 'map'  && <MapTab interactions={mapData} />}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ sessions, totalRevenue, totalDoors, totalBookings, totalEstimates, closeRate, revenuePerDoor }) {
  const totalHours = sessions.reduce((sum, s) => {
    if (!s.started_at || !s.ended_at) return sum
    return sum + (new Date(s.ended_at) - new Date(s.started_at)) / 3600000
  }, 0)

  const revenuePerHour = totalHours > 0 ? (totalRevenue / totalHours).toFixed(0) : '—'

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        <KPICard label="Revenue Booked"   value={`$${totalRevenue.toFixed(0)}`}    icon={<DollarSign className="w-5 h-5"/>} color="green" />
        <KPICard label="Doors Knocked"    value={totalDoors}                        icon={<Home className="w-5 h-5"/>}        color="blue"  />
        <KPICard label="Jobs Booked"      value={totalBookings}                     icon={<TrendingUp className="w-5 h-5"/>}  color="emerald"/>
        <KPICard label="Close Rate"       value={`${closeRate}%`}                   icon={<BarChart2 className="w-5 h-5"/>}   color="purple"/>
      </div>

      {/* Secondary KPIs */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b">
          <p className="font-semibold text-gray-700 text-sm">Performance Metrics</p>
        </div>
        {[
          ['Revenue / Hour',         `$${revenuePerHour}`],
          ['Revenue / Door',         `$${revenuePerDoor}`],
          ['Estimates Requested',    totalEstimates],
          ['Sessions',               sessions.length],
          ['Total Hours Canvassing', `${totalHours.toFixed(1)} hrs`],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between px-5 py-2.5 border-b last:border-0">
            <span className="text-sm text-gray-600">{label}</span>
            <span className="text-sm font-bold text-gray-900">{value}</span>
          </div>
        ))}
      </div>

      {/* Recent Sessions */}
      {sessions.length > 0 && (
        <div>
          <p className="font-semibold text-gray-700 text-sm mb-2">Recent Sessions</p>
          <div className="space-y-2">
            {sessions.slice(0, 10).map((s) => (
              <div key={s.id} className="bg-white rounded-xl px-4 py-3 border border-gray-100">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-sm text-gray-900">
                      {s.users?.full_name || 'Rep'}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {format(new Date(s.started_at), 'EEE MMM d, h:mm a')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900">${(s.revenue_booked || 0).toFixed(0)}</p>
                    <p className="text-xs text-gray-400">{s.doors_knocked || 0} doors</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sessions.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No sessions in this period</p>
          <p className="text-sm mt-1">Try expanding the date range.</p>
        </div>
      )}
    </div>
  )
}

// ─── Reps Tab ─────────────────────────────────────────────────────────────────
function RepsTab({ repStats }) {
  if (!repStats.length) {
    return (
      <div className="text-center py-16 text-gray-400">
        <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No rep data for this period.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {repStats.map((rep, i) => {
        const closeRate = rep.doors > 0 ? ((rep.bookings / rep.doors) * 100).toFixed(1) : '0'
        return (
          <div key={rep.id} className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: BRAND_GREEN }}>
                {i + 1}
              </div>
              <div>
                <p className="font-bold text-gray-900">{rep.name}</p>
                <p className="text-xs text-gray-400">{rep.sessions} sessions</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-lg font-bold text-gray-900">${rep.revenue.toFixed(0)}</p>
                <p className="text-xs text-green-600">{rep.bookings} booked</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100">
              <MicroStat label="Doors"    value={rep.doors}    />
              <MicroStat label="Estimates" value={rep.estimates}/>
              <MicroStat label="Close %"  value={`${closeRate}%`} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Map Tab ──────────────────────────────────────────────────────────────────
function MapTab({ interactions }) {
  const counts = interactions.reduce((acc, i) => {
    acc[i.outcome] = (acc[i.outcome] || 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex gap-4 flex-wrap">
        {[
          { color: '#9CA3AF', label: `No Answer (${counts.no_answer || 0})` },
          { color: '#EF4444', label: `Not Int. (${counts.not_interested || 0})` },
          { color: '#F59E0B', label: `Estimate (${counts.estimate_requested || 0})` },
          { color: '#10B981', label: `Booked (${counts.booked || 0})` },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5 text-xs text-gray-600">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            {label}
          </div>
        ))}
      </div>

      {/* Map */}
      <div className="rounded-2xl overflow-hidden border border-gray-200" style={{ height: '480px' }}>
        <MapView
          interactions={interactions}
          className="w-full h-full"
          followUser={false}
        />
      </div>
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────
function KPICard({ label, value, icon, color }) {
  const colors = {
    green:   { bg: 'bg-green-50',   text: 'text-green-600'  },
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-600'   },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600'},
    purple:  { bg: 'bg-purple-50',  text: 'text-purple-600' },
  }
  const c = colors[color] || colors.blue
  return (
    <div className={`${c.bg} rounded-2xl p-4`}>
      <div className={`${c.text} mb-2`}>{icon}</div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function MicroStat({ label, value }) {
  return (
    <div className="text-center">
      <p className="font-bold text-gray-900 text-sm">{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  )
}
