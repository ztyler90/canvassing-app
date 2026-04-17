import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import { Users, DollarSign, Home, TrendingUp, MapPin, BarChart2, LogOut, Map, Plus, Trash2, Edit2, X, Check, Radio, Trophy, Download, Settings, BookOpen } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  getAllSessions, getAllReps, getManagerMapData, signOut,
  getTerritories, createTerritory, updateTerritory, deleteTerritory,
  setTerritoryAssignments, getAllDoorHistory, getDoNotKnockList,
  addDoNotKnock, removeDoNotKnock,
  getActiveRepLocations, getLeaderboardData, getAllBookings,
} from '../lib/supabase.js'
import MapView from '../components/MapView.jsx'
import TerritoryMap from '../components/TerritoryMap.jsx'

const BRAND_GREEN = '#1B4FCC'  // KnockIQ blue
const BRAND_LIME  = '#7DC31E'  // KnockIQ lime (accent)
const TERRITORY_COLORS = ['#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#10B981', '#EF4444', '#0EA5E9', '#14B8A6']

const TABS = [
  { id: 'overview',    label: 'Overview',    icon: BarChart2 },
  { id: 'live',        label: 'Live',        icon: Radio     },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy    },
  { id: 'reps',        label: 'Reps',        icon: Users     },
  { id: 'bookings',    label: 'Bookings',    icon: BookOpen  },
  { id: 'map',         label: 'Map',         icon: MapPin    },
  { id: 'territories', label: 'Territories', icon: Map       },
]

// Tabs that suppress the date/rep filter bar
const NO_FILTER_TABS = new Set(['territories', 'live', 'leaderboard'])

export default function ManagerDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab]               = useState('overview')
  const [sessions, setSessions]     = useState([])
  const [reps, setReps]             = useState([])
  const [mapData, setMapData]       = useState([])
  const [bookings, setBookings]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [dateRange, setDateRange]   = useState('7')
  const [selectedRep, setSelectedRep] = useState('all')

  useEffect(() => { loadData() }, [dateRange, selectedRep])

  async function loadData() {
    setLoading(true)
    const days     = parseInt(dateRange)
    const dateFrom = startOfDay(subDays(new Date(), days)).toISOString()
    const dateTo   = endOfDay(new Date()).toISOString()
    const filters  = { dateFrom, dateTo, ...(selectedRep !== 'all' ? { repId: selectedRep } : {}) }

    const [sess, repList, interactions, bkgs] = await Promise.all([
      getAllSessions(filters),
      getAllReps(),
      getManagerMapData(filters),
      getAllBookings(filters),
    ])
    setSessions(sess)
    setReps(repList)
    setMapData(interactions)
    setBookings(bkgs)
    setLoading(false)
  }

  const totalRevenue   = sessions.reduce((s, x) => s + (x.revenue_booked || 0), 0)
  const totalDoors     = sessions.reduce((s, x) => s + (x.doors_knocked || 0), 0)
  const totalBookings  = sessions.reduce((s, x) => s + (x.bookings || 0), 0)
  const totalEstimates = sessions.reduce((s, x) => s + (x.estimates || 0), 0)
  const closeRate      = totalDoors > 0 ? ((totalBookings / totalDoors) * 100).toFixed(1) : '0'
  const revenuePerDoor = totalDoors > 0 ? (totalRevenue / totalDoors).toFixed(2) : '0'

  const repMap = {}
  sessions.forEach((s) => {
    const repName = s.users?.full_name || s.rep_id
    if (!repMap[s.rep_id]) {
      repMap[s.rep_id] = { id: s.rep_id, name: repName, sessions: 0, doors: 0, bookings: 0, revenue: 0, estimates: 0 }
    }
    const r = repMap[s.rep_id]
    r.sessions++; r.doors += s.doors_knocked || 0; r.bookings += s.bookings || 0
    r.revenue += s.revenue_booked || 0; r.estimates += s.estimates || 0
  })
  const repStats = Object.values(repMap).sort((a, b) => b.revenue - a.revenue)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="px-5 pt-12 pb-4" style={{ backgroundColor: BRAND_GREEN }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-blue-200 text-sm">Manager View</p>
            <div className="flex items-baseline gap-0.5 mt-0.5">
              <span className="text-white text-xl font-extrabold">Knock</span>
              <span className="text-xl font-extrabold" style={{ color: BRAND_LIME }}>IQ</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/settings')} className="p-2 rounded-full bg-white/20">
              <Settings className="w-5 h-5 text-white" />
            </button>
            <button onClick={signOut} className="p-2 rounded-full bg-white/20">
              <LogOut className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
        {!NO_FILTER_TABS.has(tab) && (
          <div className="flex gap-2">
            <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}
              className="flex-1 bg-white/20 text-white text-sm rounded-xl px-3 py-2 border border-white/30 focus:outline-none">
              <option value="1"  className="text-gray-900">Today</option>
              <option value="7"  className="text-gray-900">Last 7 days</option>
              <option value="30" className="text-gray-900">Last 30 days</option>
              <option value="90" className="text-gray-900">Last 90 days</option>
            </select>
            <select value={selectedRep} onChange={(e) => setSelectedRep(e.target.value)}
              className="flex-1 bg-white/20 text-white text-sm rounded-xl px-3 py-2 border border-white/30 focus:outline-none">
              <option value="all" className="text-gray-900">All Reps</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id} className="text-gray-900">{r.full_name || r.email}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tab Bar — horizontally scrollable for 6 tabs */}
      <div className="bg-white border-b flex overflow-x-auto scrollbar-hide">
        {TABS.map((t) => {
          const Icon   = t.icon
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-shrink-0 px-4 py-3 flex flex-col items-center gap-0.5 text-xs font-medium transition-colors min-w-[72px] ${active ? 'border-b-2' : 'text-gray-500'}`}
              style={active ? { color: BRAND_GREEN, borderBottomColor: BRAND_GREEN } : {}}>
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${!NO_FILTER_TABS.has(tab) ? 'px-4 py-5 space-y-4 pb-8' : ''}`}>
        {!NO_FILTER_TABS.has(tab) && loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-8 h-8 rounded-full"
              style={{ borderWidth: 3, borderStyle: 'solid', borderColor: `${BRAND_GREEN} transparent transparent transparent` }} />
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <OverviewTab sessions={sessions} totalRevenue={totalRevenue} totalDoors={totalDoors}
                totalBookings={totalBookings} totalEstimates={totalEstimates}
                closeRate={closeRate} revenuePerDoor={revenuePerDoor} />
            )}
            {tab === 'live'        && <LiveTab allReps={reps} />}
            {tab === 'leaderboard' && <LeaderboardTab />}
            {tab === 'reps'        && <RepsTab repStats={repStats} />}
            {tab === 'bookings'    && <BookingsTab bookings={bookings} />}
            {tab === 'map'         && <MapTab interactions={mapData} />}
            {tab === 'territories' && <TerritoryTab allReps={reps} managerId={user?.id} />}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ sessions, totalRevenue, totalDoors, totalBookings, totalEstimates, closeRate, revenuePerDoor }) {
  const navigate = useNavigate()
  const totalHours     = sessions.reduce((sum, s) => {
    if (!s.started_at || !s.ended_at) return sum
    return sum + (new Date(s.ended_at) - new Date(s.started_at)) / 3600000
  }, 0)
  const revenuePerHour = totalHours > 0 ? (totalRevenue / totalHours).toFixed(0) : '—'

  function exportCSV() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

    // ── Section 1: Summary ──────────────────────────────────────────
    const summary = [
      ['SUMMARY'],
      ['Revenue Booked', `$${totalRevenue.toFixed(2)}`],
      ['Doors Knocked', totalDoors],
      ['Jobs Booked', totalBookings],
      ['Estimates Requested', totalEstimates],
      ['Close Rate', `${closeRate}%`],
      ['Revenue / Door', `$${revenuePerDoor}`],
      ['Revenue / Hour', revenuePerHour !== '—' ? `$${revenuePerHour}` : '—'],
      ['Total Sessions', sessions.length],
      ['Total Hours Canvassing', `${totalHours.toFixed(1)}`],
      [],
    ]

    // ── Section 2: Per-Rep Breakdown ────────────────────────────────
    const repMap = {}
    sessions.forEach((s) => {
      const key = s.rep_id
      if (!repMap[key]) repMap[key] = { name: s.users?.full_name || s.rep_id, sessions: 0, doors: 0, bookings: 0, estimates: 0, revenue: 0, hours: 0 }
      const r = repMap[key]
      r.sessions++
      r.doors     += s.doors_knocked  || 0
      r.bookings  += s.bookings       || 0
      r.estimates += s.estimates      || 0
      r.revenue   += s.revenue_booked || 0
      if (s.started_at && s.ended_at)
        r.hours += (new Date(s.ended_at) - new Date(s.started_at)) / 3600000
    })
    const repRows = [
      ['REP BREAKDOWN'],
      ['Name', 'Sessions', 'Doors', 'Bookings', 'Estimates', 'Close %', 'Revenue', 'Hours'],
      ...Object.values(repMap).sort((a, b) => b.revenue - a.revenue).map((r) => {
        const cr = r.doors > 0 ? ((r.bookings / r.doors) * 100).toFixed(1) : '0'
        return [esc(r.name), r.sessions, r.doors, r.bookings, r.estimates, `${cr}%`, `$${r.revenue.toFixed(2)}`, r.hours.toFixed(1)]
      }),
      [],
    ]

    // ── Section 3: Session Log ───────────────────────────────────────
    const sessionRows = [
      ['SESSION LOG'],
      ['Rep', 'Date', 'Start Time', 'End Time', 'Doors', 'Bookings', 'Estimates', 'Revenue', 'Hours'],
      ...sessions.map((s) => {
        const start = s.started_at ? new Date(s.started_at) : null
        const end   = s.ended_at   ? new Date(s.ended_at)   : null
        const hrs   = start && end ? ((end - start) / 3600000).toFixed(1) : ''
        return [
          esc(s.users?.full_name || s.rep_id),
          start ? format(start, 'yyyy-MM-dd') : '',
          start ? format(start, 'h:mm a') : '',
          end   ? format(end,   'h:mm a') : '',
          s.doors_knocked  || 0,
          s.bookings       || 0,
          s.estimates      || 0,
          `$${(s.revenue_booked || 0).toFixed(2)}`,
          hrs,
        ]
      }),
    ]

    const allRows = [...summary, ...repRows, ...sessionRows]
    const csv     = allRows.map((row) => row.join(',')).join('\r\n')
    const blob    = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url     = URL.createObjectURL(blob)
    const a       = document.createElement('a')
    a.href        = url
    a.download    = `canvassing-overview-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function openInSheets() {
    // Build CSV and encode it, then open Google Sheets import flow
    // Easiest reliable path: download CSV first, then link to sheets.new
    exportCSV()
    setTimeout(() => window.open('https://sheets.new', '_blank'), 600)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <KPICard label="Revenue Booked"  value={`$${totalRevenue.toFixed(0)}`}  icon={<DollarSign className="w-5 h-5"/>} color="green"   />
        <KPICard label="Doors Knocked"   value={totalDoors}                      icon={<Home className="w-5 h-5"/>}       color="blue"    />
        <KPICard label="Jobs Booked"     value={totalBookings}                   icon={<TrendingUp className="w-5 h-5"/>} color="emerald" />
        <KPICard label="Close Rate"      value={`${closeRate}%`}                 icon={<BarChart2 className="w-5 h-5"/>}  color="purple"  />
      </div>
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
      {sessions.length > 0 && (
        <div>
          <p className="font-semibold text-gray-700 text-sm mb-2">Recent Sessions</p>
          <div className="space-y-2">
            {sessions.slice(0, 10).map((s) => (
              <button
                key={s.id}
                onClick={() => navigate('/session/' + s.id)}
                className="w-full bg-white rounded-xl px-4 py-3 border border-gray-100 text-left active:bg-gray-50 transition-colors">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-sm text-gray-900">{s.users?.full_name || 'Rep'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{format(new Date(s.started_at), 'EEE MMM d, h:mm a')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-bold text-gray-900">${(s.revenue_booked || 0).toFixed(0)}</p>
                      <p className="text-xs text-gray-400">{s.doors_knocked || 0} doors</p>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </button>
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
      {/* Export buttons — compact, bottom of page */}
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={exportCSV} title="Export CSV"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
          style={{ backgroundColor: BRAND_GREEN }}>
          <Download className="w-3.5 h-3.5" />
          CSV
        </button>
        <button onClick={openInSheets} title="Open in Google Sheets"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 text-gray-600 bg-white">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="2" fill="#34A853" opacity=".15"/>
            <path d="M3 9h18M3 15h18M9 3v18" stroke="#34A853" strokeWidth="1.5"/>
          </svg>
          Sheets
        </button>
      </div>
    </div>
  )
}

// ─── Bookings Tab ─────────────────────────────────────────────────────────────
function BookingsTab({ bookings }) {
  if (!bookings.length) return (
    <div className="text-center py-16 text-gray-400">
      <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
      <p className="font-medium text-sm">No bookings in this period</p>
      <p className="text-xs mt-1">Try expanding the date range.</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {bookings.map((b) => {
        const photos    = b.interactions?.photo_urls || []
        const followUp  = b.interactions?.follow_up  || false
        const services  = Array.isArray(b.service_types) ? b.service_types : []
        const createdAt = b.created_at ? new Date(b.created_at) : null

        return (
          <div key={b.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-bold text-green-700">✅ Booked</span>
                  {followUp && (
                    <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-1.5 py-0.5 rounded-full">
                      🏴 Follow Up
                    </span>
                  )}
                </div>
                <p className="text-gray-700 text-sm mt-0.5 font-medium truncate">
                  {b.contact_name || '—'}
                </p>
                {b.address && (
                  <p className="text-gray-400 text-xs mt-0.5 truncate">{b.address}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                {b.estimated_value > 0 && (
                  <p className="text-green-600 font-bold text-base">${b.estimated_value.toFixed(0)}</p>
                )}
                {createdAt && (
                  <p className="text-gray-400 text-xs">{format(createdAt, 'MMM d, h:mm a')}</p>
                )}
              </div>
            </div>

            {/* Rep + services row */}
            <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
              {b.users?.full_name && (
                <span className="text-xs bg-blue-50 text-blue-700 font-medium px-2 py-0.5 rounded-full">
                  {b.users.full_name}
                </span>
              )}
              {b.contact_phone && (
                <span className="text-xs text-gray-500">📞 {b.contact_phone}</span>
              )}
              {services.map((svc) => (
                <span key={svc} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {svc}
                </span>
              ))}
            </div>

            {/* Photo thumbnails */}
            {photos.length > 0 && (
              <div className="px-4 pb-3 flex gap-1.5 flex-wrap">
                {photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={url}
                      alt={`Photo ${i + 1}`}
                      className="w-16 h-16 rounded-xl object-cover border border-gray-200 active:opacity-75"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Reps Tab ─────────────────────────────────────────────────────────────────
function RepsTab({ repStats }) {
  if (!repStats.length) return (
    <div className="text-center py-16 text-gray-400">
      <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
      <p>No rep data for this period.</p>
    </div>
  )
  return (
    <div className="space-y-3">
      {repStats.map((rep, i) => {
        const cr = rep.doors > 0 ? ((rep.bookings / rep.doors) * 100).toFixed(1) : '0'
        return (
          <div key={rep.id} className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: BRAND_GREEN }}>{i + 1}</div>
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
              <MicroStat label="Doors"     value={rep.doors}       />
              <MicroStat label="Estimates" value={rep.estimates}   />
              <MicroStat label="Close %"   value={`${cr}%`}        />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Map Tab ──────────────────────────────────────────────────────────────────
function MapTab({ interactions }) {
  const counts = interactions.reduce((acc, i) => { acc[i.outcome] = (acc[i.outcome] || 0) + 1; return acc }, {})
  return (
    <div className="space-y-3">
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
      <div className="rounded-2xl overflow-hidden border border-gray-200" style={{ height: '480px' }}>
        <MapView interactions={interactions} className="w-full h-full" followUser={false} />
      </div>
    </div>
  )
}

// ─── Territory Tab ────────────────────────────────────────────────────────────
function TerritoryTab({ allReps, managerId }) {
  const [territories, setTerritories] = useState([])
  const [doorHistory, setDoorHistory] = useState([])
  const [doNotKnock, setDoNotKnock]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [drawing, setDrawing]         = useState(false)

  // Territory create/edit form
  const [showForm, setShowForm]       = useState(false)
  const [editingId, setEditingId]     = useState(null)
  const [newPolygon, setNewPolygon]   = useState(null)
  const [form, setForm]               = useState({ name: '', color: '#3B82F6', repIds: [] })
  const [saving, setSaving]           = useState(false)

  // DNK form
  const [showDnkForm, setShowDnkForm] = useState(false)
  const [dnkForm, setDnkForm]         = useState({ address: '', lat: '', lng: '', reason: '' })
  const [dnkSaving, setDnkSaving]     = useState(false)

  const mapRef = useRef(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [terrs, history, dnk] = await Promise.all([
      getTerritories(),
      getAllDoorHistory(),
      getDoNotKnockList(),
    ])
    setTerritories(terrs)
    setDoorHistory(history)
    setDoNotKnock(dnk)
    setLoading(false)
  }

  function startDraw() {
    mapRef.current?.startDrawing()
    setDrawing(true)
  }

  function cancelDraw() {
    mapRef.current?.cancelDrawing()
    setDrawing(false)
  }

  function handlePolygonComplete(coords) {
    setDrawing(false)
    setNewPolygon(coords)
    setEditingId(null)
    setForm({ name: '', color: '#3B82F6', repIds: [] })
    setShowForm(true)
  }

  function openEditForm(territory) {
    setEditingId(territory.id)
    setNewPolygon(null)
    setForm({
      name:   territory.name,
      color:  territory.color || '#3B82F6',
      repIds: (territory.territory_assignments || []).map((a) => a.rep_id),
    })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editingId) {
        await updateTerritory(editingId, { name: form.name.trim(), color: form.color })
        await setTerritoryAssignments(editingId, form.repIds, managerId)
      } else {
        const { data } = await createTerritory({
          name: form.name.trim(), color: form.color, polygon: newPolygon, createdBy: managerId,
        })
        if (data) await setTerritoryAssignments(data.id, form.repIds, managerId)
      }
      setShowForm(false); setNewPolygon(null); setEditingId(null)
      await loadAll()
    } finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this territory? This cannot be undone.')) return
    await deleteTerritory(id)
    await loadAll()
  }

  async function handleAddDnk() {
    const lat = parseFloat(dnkForm.lat)
    const lng = parseFloat(dnkForm.lng)
    if (!dnkForm.address && (isNaN(lat) || isNaN(lng))) return
    setDnkSaving(true)
    await addDoNotKnock({
      address: dnkForm.address || null,
      lat:     isNaN(lat) ? 0 : lat,
      lng:     isNaN(lng) ? 0 : lng,
      reason:  dnkForm.reason || null,
      addedBy: managerId,
    })
    setDnkForm({ address: '', lat: '', lng: '', reason: '' })
    setShowDnkForm(false); setDnkSaving(false)
    const dnk = await getDoNotKnockList()
    setDoNotKnock(dnk)
  }

  async function handleRemoveDnk(id) {
    await removeDoNotKnock(id)
    setDoNotKnock((prev) => prev.filter((d) => d.id !== id))
  }

  const toggleRep = (repId) => setForm((f) => ({
    ...f,
    repIds: f.repIds.includes(repId) ? f.repIds.filter((r) => r !== repId) : [...f.repIds, repId],
  }))

  if (loading) return (
    <div className="flex justify-center py-24">
      <div className="animate-spin w-8 h-8 rounded-full"
        style={{ borderWidth: 3, borderStyle: 'solid', borderColor: `${BRAND_GREEN} transparent transparent transparent` }} />
    </div>
  )

  return (
    <div className="flex flex-col">
      {/* Control bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b">
        <p className="font-semibold text-gray-800 text-sm">
          {territories.length} {territories.length === 1 ? 'territory' : 'territories'}
        </p>
        {drawing ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-600 font-medium animate-pulse">
              Click to place points · Double-click to finish
            </span>
            <button onClick={cancelDraw}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-100 text-red-600 text-xs font-semibold">
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        ) : (
          <button onClick={startDraw}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-xs font-semibold"
            style={{ backgroundColor: BRAND_GREEN }}>
            <Plus className="w-3.5 h-3.5" /> Draw Territory
          </button>
        )}
      </div>

      {/* Territory Map */}
      <div style={{ height: '380px' }}>
        <TerritoryMap
          ref={mapRef}
          territories={territories}
          doorHistory={doorHistory}
          doNotKnock={doNotKnock}
          onPolygonComplete={handlePolygonComplete}
          className="w-full h-full"
        />
      </div>

      {/* Legend */}
      <div className="flex gap-3 px-4 py-2 bg-white border-b flex-wrap text-xs">
        <span className="text-gray-400 font-medium">Doors:</span>
        {[['#9CA3AF','No Ans.'],['#EF4444','Not Int.'],['#F59E0B','Estimate'],['#10B981','Booked']].map(([c,l]) => (
          <div key={l} className="flex items-center gap-1 text-gray-500">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />{l}
          </div>
        ))}
        <span className="text-red-500 ml-1">✕ DNK</span>
      </div>

      {/* Territory list + DNK */}
      <div className="px-4 py-3 space-y-2 pb-8">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Zones</p>

        {territories.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <Map className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No territories yet.</p>
            <p className="text-xs mt-1">Click "Draw Territory" and outline a zone on the map.</p>
          </div>
        )}

        {territories.map((t) => {
          const assignedReps = (t.territory_assignments || []).map((a) => a.users?.full_name).filter(Boolean)
          return (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ backgroundColor: t.color }} />
                <p className="font-semibold text-gray-900 text-sm flex-1 truncate">{t.name}</p>
                <button onClick={() => openEditForm(t)} className="p-1.5 text-gray-400 hover:text-blue-500">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDelete(t.id)} className="p-1.5 text-gray-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1 ml-5">
                {assignedReps.length ? assignedReps.join(', ') : 'Unassigned'}
              </p>
            </div>
          )
        })}

        {/* DNK Section */}
        <div className="mt-5 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">🚫 Do Not Knock</p>
            <button onClick={() => setShowDnkForm((v) => !v)}
              className="text-xs font-semibold text-red-600 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add Entry
            </button>
          </div>

          {showDnkForm && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 space-y-2">
              <input placeholder="Address (e.g. 123 Main St)" value={dnkForm.address}
                onChange={(e) => setDnkForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none bg-white" />
              <div className="flex gap-2">
                <input placeholder="Lat" type="number" value={dnkForm.lat}
                  onChange={(e) => setDnkForm((f) => ({ ...f, lat: e.target.value }))}
                  className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none bg-white" />
                <input placeholder="Lng" type="number" value={dnkForm.lng}
                  onChange={(e) => setDnkForm((f) => ({ ...f, lng: e.target.value }))}
                  className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none bg-white" />
              </div>
              <input placeholder="Reason (optional)" value={dnkForm.reason}
                onChange={(e) => setDnkForm((f) => ({ ...f, reason: e.target.value }))}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none bg-white" />
              <div className="flex gap-2">
                <button onClick={() => setShowDnkForm(false)}
                  className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 font-medium">Cancel</button>
                <button onClick={handleAddDnk} disabled={dnkSaving}
                  className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-60">
                  {dnkSaving ? 'Saving…' : 'Add Entry'}
                </button>
              </div>
            </div>
          )}

          {doNotKnock.length === 0 && !showDnkForm && (
            <p className="text-xs text-gray-400">No entries yet. Addresses added here will show as red ✕ pins on all rep maps.</p>
          )}
          <div className="space-y-1.5">
            {doNotKnock.map((dnk) => (
              <div key={dnk.id} className="flex items-center gap-2 bg-white border border-red-100 rounded-lg px-3 py-2">
                <span className="text-red-600 text-xs font-bold flex-shrink-0">✕</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">
                    {dnk.address || `${dnk.lat?.toFixed(4)}, ${dnk.lng?.toFixed(4)}`}
                  </p>
                  {dnk.reason && <p className="text-xs text-gray-400 truncate">{dnk.reason}</p>}
                </div>
                <button onClick={() => handleRemoveDnk(dnk.id)} className="text-gray-300 hover:text-red-500 flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Create/Edit Territory Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full bg-white rounded-t-3xl shadow-2xl px-5 pt-5 pb-8 max-h-[82vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900 text-base">
                {editingId ? 'Edit Territory' : 'Name Your Territory'}
              </h3>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Name</label>
            <input autoFocus placeholder="e.g. Zone Alpha, Maple District" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 mb-4" />

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Color</label>
            <div className="flex gap-2 flex-wrap mb-4">
              {TERRITORY_COLORS.map((c) => (
                <button key={c} onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className="w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all"
                  style={{ backgroundColor: c, borderColor: form.color === c ? '#0F172A' : 'transparent' }}>
                  {form.color === c && <Check className="w-4 h-4 text-white" />}
                </button>
              ))}
            </div>

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Assign Reps</label>
            {allReps.length === 0 && <p className="text-xs text-gray-400 mb-4">No reps available.</p>}
            <div className="space-y-2 mb-5">
              {allReps.map((rep) => {
                const selected = form.repIds.includes(rep.id)
                return (
                  <button key={rep.id} onClick={() => toggleRep(rep.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-colors text-left ${selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'}`}>
                      {selected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{rep.full_name || rep.email}</p>
                      <p className="text-xs text-gray-400">{rep.email}</p>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-3.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="flex-1 py-3.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
                style={{ backgroundColor: BRAND_GREEN }}>
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Territory'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Live Tab ─────────────────────────────────────────────────────────────────
const REP_COLORS = ['#3B82F6','#8B5CF6','#F59E0B','#EC4899','#10B981','#EF4444','#0EA5E9','#14B8A6','#F97316','#6366F1']

function repInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(' ')
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

function elapsedSince(startedAt) {
  if (!startedAt) return '—'
  const secs = Math.floor((Date.now() - new Date(startedAt)) / 1000)
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function LiveTab({ allReps }) {
  const [activeReps, setActiveReps]   = useState([])
  const [refreshedAt, setRefreshedAt] = useState(null)
  const [loading, setLoading]         = useState(true)

  const refresh = async () => {
    try {
      const data = await getActiveRepLocations()
      setActiveReps(data)
      setRefreshedAt(new Date())
    } catch (_e) { /* keep showing last data */ }
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 10000)  // poll every 10s for snappier live view
    // Also refresh immediately when manager's tab regains focus or comes online
    const onFocus = () => refresh()
    const onOnline = () => refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  const activeIds  = new Set(activeReps.map((r) => r.rep_id))
  const inactiveReps = allReps.filter((r) => !activeIds.has(r.id))

  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${activeReps.length > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
          <span className="text-sm font-semibold text-gray-800">
            {activeReps.length} rep{activeReps.length !== 1 ? 's' : ''} active now
          </span>
        </div>
        <button onClick={refresh} className="text-xs text-gray-400 hover:text-gray-600">
          {refreshedAt ? `Updated ${format(refreshedAt, 'h:mm:ss a')}` : 'Loading…'}
        </button>
      </div>

      {/* Live map */}
      <div style={{ height: '380px' }}>
        {loading ? (
          <div className="flex items-center justify-center h-full bg-gray-50">
            <div className="animate-spin w-8 h-8 rounded-full"
              style={{ borderWidth: 3, borderStyle: 'solid', borderColor: `${BRAND_GREEN} transparent transparent transparent` }} />
          </div>
        ) : (
          <MapView repLocations={activeReps} className="w-full h-full" followUser={false} />
        )}
      </div>

      {/* Active rep cards */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Active Reps</p>
      </div>
      {activeReps.length === 0 && (
        <div className="text-center py-6 text-gray-400 px-4">
          <Radio className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No reps are currently active</p>
          <p className="text-xs mt-1">Rep pins appear here when a session is in progress.</p>
        </div>
      )}
      <div className="px-4 pb-3 space-y-2">
        {activeReps.map((rep, idx) => {
          const color = REP_COLORS[idx % REP_COLORS.length]
          const sess  = rep.session
          return (
            <div key={rep.rep_id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                style={{ backgroundColor: color }}>
                {repInitials(rep.user?.full_name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{rep.user?.full_name || 'Rep'}</p>
                <p className="text-xs text-gray-400">{elapsedSince(sess?.started_at)} elapsed</p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-right flex-shrink-0">
                <span className="text-xs text-gray-400">Doors</span>
                <span className="text-xs font-bold text-gray-900">{sess?.doors_knocked ?? '—'}</span>
                <span className="text-xs text-gray-400">Revenue</span>
                <span className="text-xs font-bold text-green-600">
                  {sess?.revenue_booked != null ? `$${sess.revenue_booked.toFixed(0)}` : '—'}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Inactive reps */}
      {inactiveReps.length > 0 && (
        <div className="px-4 pt-2 pb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Not Active</p>
          <div className="flex flex-wrap gap-2">
            {inactiveReps.map((rep) => (
              <div key={rep.id} className="flex items-center gap-1.5 bg-gray-100 rounded-full px-3 py-1">
                <div className="w-2 h-2 rounded-full bg-gray-300" />
                <span className="text-xs text-gray-500">{rep.full_name || rep.email}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Leaderboard Tab ──────────────────────────────────────────────────────────
function LeaderboardTab() {
  const [period, setPeriod]         = useState('today')
  const [sortBy, setSortBy]         = useState('revenue')
  const [rows, setRows]             = useState([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    setLoading(true)
    getLeaderboardData(period)
      .then(setRows)
      .finally(() => setLoading(false))
  }, [period])

  const sorted = [...rows].sort((a, b) => b[sortBy] - a[sortBy])

  const COLS = [
    { key: 'doors',         label: 'Doors'   },
    { key: 'conversations', label: 'Convos'  },
    { key: 'bookings',      label: 'Booked'  },
    { key: 'revenue',       label: 'Revenue' },
  ]

  return (
    <div className="flex flex-col">
      {/* Controls */}
      <div className="px-4 py-3 bg-white border-b flex items-center gap-2">
        {['today', 'week', 'month'].map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${period === p ? 'text-white' : 'bg-gray-100 text-gray-500'}`}
            style={period === p ? { backgroundColor: BRAND_GREEN } : {}}>
            {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : 'This Month'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin w-8 h-8 rounded-full"
            style={{ borderWidth: 3, borderStyle: 'solid', borderColor: `${BRAND_GREEN} transparent transparent transparent` }} />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-gray-400 px-4">
          <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-sm">No activity yet</p>
          <p className="text-xs mt-1">Data appears here once reps start sessions.</p>
        </div>
      ) : (
        <div className="px-4 pt-4 pb-8 space-y-3">
          {/* Sort chips */}
          <div className="flex gap-2 flex-wrap">
            <span className="text-xs text-gray-500 font-medium self-center mr-1">Sort by:</span>
            {COLS.map(({ key, label }) => (
              <button key={key} onClick={() => setSortBy(key)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${sortBy === key ? 'text-white' : 'bg-gray-100 text-gray-500'}`}
                style={sortBy === key ? { backgroundColor: BRAND_GREEN } : {}}>
                {label}
              </button>
            ))}
          </div>

          {/* Leaderboard rows */}
          {sorted.map((rep, i) => {
            const closeRate = rep.doors > 0 ? ((rep.bookings / rep.doors) * 100).toFixed(1) : '0'
            const isFirst   = i === 0
            return (
              <div key={rep.id}
                className={`rounded-2xl border p-4 ${isFirst ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${isFirst ? 'bg-yellow-400 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-sm truncate">{rep.name}</p>
                    <p className="text-xs text-gray-400">{rep.bookings} booking{rep.bookings !== 1 ? 's' : ''} · {closeRate}% close rate</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-gray-900">${rep.revenue.toFixed(0)}</p>
                    <p className="text-xs text-gray-400">revenue</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-2 border-t border-gray-100">
                  <MicroStat label="Doors"   value={rep.doors}         />
                  <MicroStat label="Convos"  value={rep.conversations} />
                  <MicroStat label="Estims"  value={rep.estimates}     />
                  <MicroStat label="Booked"  value={rep.bookings}      />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────
function KPICard({ label, value, icon, color }) {
  const colors = {
    green:   { bg: 'bg-green-50',   text: 'text-green-600'   },
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-600'    },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
    purple:  { bg: 'bg-purple-50',  text: 'text-purple-600'  },
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
