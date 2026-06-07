/**
 * SessionDetail — lets a rep view and edit a past session.
 * Accessible from RepHome → tap any session row.
 *
 * Editable:
 *  - Session summary: doors_knocked, conversations, estimates, bookings, revenue_booked
 *  - Individual interactions: outcome, address, notes
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ChevronLeft, Edit2, Check, X, MapPin, Clock, DollarSign, Home, MessageSquare, Save, Trash2, Loader2 } from 'lucide-react'
import { getSessionWithInteractions, updateInteraction, updateSession, deleteSession, getMyOrganization, getCurrentUser } from '../lib/supabase.js'
import { PhotoThumb } from '../lib/photos.jsx'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

// Outcome dropdown labels. The estimate_requested label swaps to
// "Appointment" when the org has opted into appointment-setter terminology
// under Settings → Daily Goal. Built per-render via the helper below so the
// label updates as soon as org config loads.
function buildOutcomes(countLabel) {
  const isAppt = countLabel === 'appointments'
  return [
    { value: 'no_answer',          label: 'No Answer',                       color: '#9CA3AF' },
    { value: 'not_interested',     label: 'Not Interested',                  color: '#EF4444' },
    { value: 'estimate_requested', label: isAppt ? 'Appointment' : 'Estimate', color: '#F59E0B' },
    { value: 'booked',             label: 'Booked ✓',                        color: '#10B981' },
  ]
}

export default function SessionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [session, setSession]           = useState(null)
  const [interactions, setInteractions] = useState([])
  const [loading, setLoading]           = useState(true)
  const [editingSession, setEditingSession] = useState(false)
  const [sessionDraft, setSessionDraft] = useState({})
  const [savingSession, setSavingSession] = useState(false)
  const [editingInteractionId, setEditingInteractionId] = useState(null)
  const [interactionDraft, setInteractionDraft] = useState({})
  const [savingInteraction, setSavingInteraction] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState(null)
  // Org-configured count noun. Determines whether the per-session
  // headers + outcome dropdown say "Estimates" or "Appointments". Lower-
  // case to match the raw org column value; capitalize at render time.
  const [countLabel, setCountLabel] = useState('estimates')
  useEffect(() => {
    let alive = true
    getMyOrganization().then((org) => {
      if (alive && org?.count_goal_label) setCountLabel(org.count_goal_label)
    }).catch(() => {})
    return () => { alive = false }
  }, [])
  const countSingular = countLabel === 'appointments' ? 'Appointment' : 'Estimate'
  const countPlural   = countLabel === 'appointments' ? 'Appointments' : 'Estimates'

  useEffect(() => {
    let alive = true
    getCurrentUser().then((u) => { if (alive) setCurrentUser(u) }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => { loadData() }, [id])

  async function loadData() {
    setLoading(true)
    const { session: s, interactions: ints } = await getSessionWithInteractions(id)
    setSession(s)
    setInteractions(ints)
    setLoading(false)
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  // ── Session summary editing ────────────────────────────────────────────────
  function startEditSession() {
    setSessionDraft({
      doors_knocked:  session.doors_knocked  || 0,
      conversations:  session.conversations  || 0,
      estimates:      session.estimates      || 0,
      bookings:       session.bookings       || 0,
      revenue_booked: session.revenue_booked || 0,
    })
    setEditingSession(true)
  }

  async function saveSession() {
    setSavingSession(true)
    const updates = {
      doors_knocked:  parseInt(sessionDraft.doors_knocked,  10) || 0,
      conversations:  parseInt(sessionDraft.conversations,  10) || 0,
      estimates:      parseInt(sessionDraft.estimates,      10) || 0,
      bookings:       parseInt(sessionDraft.bookings,       10) || 0,
      revenue_booked: parseFloat(sessionDraft.revenue_booked)   || 0,
    }
    const { data, error } = await updateSession(id, updates)
    setSavingSession(false)
    if (error) { showToast('Save failed: ' + error.message, 'error'); return }
    setSession({ ...session, ...updates })
    setEditingSession(false)
    showToast('Session updated')
  }

  // ── Interaction editing ────────────────────────────────────────────────────
  function startEditInteraction(interaction) {
    setInteractionDraft({
      outcome:        interaction.outcome        || 'no_answer',
      address:        interaction.address        || '',
      contact_name:   interaction.contact_name   || '',
      notes:          interaction.notes          || '',
      revenue_amount: interaction.revenue_amount || 0,
    })
    setEditingInteractionId(interaction.id)
  }

  async function saveInteraction(interactionId) {
    setSavingInteraction(true)
    const updates = {
      outcome:        interactionDraft.outcome,
      address:        interactionDraft.address,
      contact_name:   interactionDraft.contact_name,
      notes:          interactionDraft.notes,
      revenue_amount: parseFloat(interactionDraft.revenue_amount) || 0,
    }
    const { data, error } = await updateInteraction(interactionId, updates)
    setSavingInteraction(false)
    if (error) { showToast('Save failed: ' + error.message, 'error'); return }
    setInteractions(prev => prev.map(i => i.id === interactionId ? { ...i, ...updates } : i))
    setEditingInteractionId(null)
    showToast('Interaction updated')
  }

  function cancelEditInteraction() {
    setEditingInteractionId(null)
    setInteractionDraft({})
  }

  // ── Session deletion ────────────────────────────────────────────────────────
  // Only a manager looking at their OWN session can delete it — reps can't
  // remove their own history (the supabase helper + RLS enforce ownership; the
  // role check here keeps the control hidden from reps). Sessions with booked
  // jobs are blocked server-side and surface a friendly message.
  const canDelete = currentUser?.role === 'manager' && !!session && currentUser.id === session.rep_id

  async function handleDeleteSession() {
    if (!window.confirm(
      'Delete this session permanently? This removes the session and every door logged in it. This cannot be undone.'
    )) return
    setDeleting(true)
    const { error } = await deleteSession(id)
    setDeleting(false)
    if (error) { showToast(error.message || 'Delete failed', 'error'); return }
    navigate(-1)
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const duration = session?.started_at && session?.ended_at
    ? Math.round((new Date(session.ended_at) - new Date(session.started_at)) / 60000)
    : null

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin w-8 h-8 rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  )

  if (!session) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">Session not found.</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-white text-sm font-medium shadow-lg ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="px-4 pt-12 pb-5 bg-brand-header">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full bg-white/20">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div>
            <p className="text-blue-200 text-xs">Session Detail</p>
            <h1 className="text-white font-bold text-lg">
              {format(new Date(session.started_at), 'EEEE, MMMM d')}
            </h1>
          </div>
        </div>

        {/* Summary Card */}
        {editingSession ? (
          <div className="bg-white/15 rounded-2xl p-4 space-y-3">
            <p className="text-white font-semibold text-sm mb-1">Edit Session Totals</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['doors_knocked',  'Doors Knocked', 'number'],
                ['conversations',  'Conversations', 'number'],
                ['estimates',      countPlural,     'number'],
                ['bookings',       'Bookings',      'number'],
                ['revenue_booked', 'Revenue ($)',   'decimal'],
              ].map(([key, label, type]) => (
                <div key={key} className="bg-white/20 rounded-xl px-3 py-2">
                  <p className="text-blue-200 text-xs mb-1">{label}</p>
                  <input
                    type="number"
                    step={type === 'decimal' ? '0.01' : '1'}
                    min="0"
                    value={sessionDraft[key]}
                    onChange={e => setSessionDraft(d => ({ ...d, [key]: e.target.value }))}
                    className="bg-transparent text-white font-bold text-lg w-full focus:outline-none"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditingSession(false)}
                className="flex-1 py-2 rounded-xl bg-white/20 text-white text-sm font-medium">
                Cancel
              </button>
              <button onClick={saveSession} disabled={savingSession}
                className="flex-1 py-2 rounded-xl bg-white text-blue-700 text-sm font-bold flex items-center justify-center gap-1.5">
                <Save className="w-4 h-4" />
                {savingSession ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white/15 rounded-2xl p-4">
            <div className="flex justify-between items-start mb-3">
              <div className="flex gap-4">
                {duration !== null && (
                  <div className="flex items-center gap-1.5 text-blue-200 text-xs">
                    <Clock className="w-3.5 h-3.5" />
                    {duration} min
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-blue-200 text-xs">
                  <Home className="w-3.5 h-3.5" />
                  {session.doors_knocked || 0} doors
                </div>
              </div>
              <button onClick={startEditSession}
                className="flex items-center gap-1.5 bg-white/20 rounded-lg px-2.5 py-1.5 text-white text-xs font-medium">
                <Edit2 className="w-3 h-3" /> Edit
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <StatPill label="Conversations" value={session.conversations || 0} />
              <StatPill label={countPlural}   value={session.estimates      || 0} />
              <StatPill label="Bookings"      value={session.bookings       || 0} color={BRAND_LIME} />
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-green-300" />
              <span className="text-white font-bold text-xl">${(session.revenue_booked || 0).toFixed(2)}</span>
              <span className="text-blue-200 text-sm">revenue booked</span>
            </div>
          </div>
        )}
      </div>

      {/* Interactions List */}
      <div className="flex-1 px-4 py-5 space-y-3 pb-10">
        <h2 className="text-gray-700 font-semibold text-base">
          Interactions <span className="text-gray-400 font-normal text-sm">({interactions.length})</span>
        </h2>

        {interactions.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <MapPin className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No interactions logged this session.</p>
          </div>
        )}

        {interactions.map((interaction) => (
          <InteractionCard
            key={interaction.id}
            interaction={interaction}
            isEditing={editingInteractionId === interaction.id}
            draft={interactionDraft}
            saving={savingInteraction}
            countLabel={countLabel}
            onEdit={() => startEditInteraction(interaction)}
            onCancel={cancelEditInteraction}
            onSave={() => saveInteraction(interaction.id)}
            onDraftChange={setInteractionDraft}
          />
        ))}

        {/* Manager-only: delete this session. Hidden from reps. */}
        {canDelete && (
          <div className="pt-5 mt-2 border-t border-gray-100">
            <button
              onClick={handleDeleteSession}
              disabled={deleting}
              className="w-full py-2.5 rounded-xl border border-red-200 text-red-600 text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-red-50 disabled:opacity-50"
            >
              {deleting
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Trash2 className="w-4 h-4" />}
              {deleting ? 'Deleting…' : 'Delete this session'}
            </button>
            <p className="text-[11px] text-gray-400 text-center mt-2 leading-snug">
              Permanently removes this session and its logged doors. Sessions with booked jobs can't be deleted.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function StatPill({ label, value, color }) {
  return (
    <div className="bg-white/15 rounded-xl px-2 py-2 text-center">
      <p className="font-bold text-lg" style={{ color: color || 'white' }}>{value}</p>
      <p className="text-blue-200 text-xs">{label}</p>
    </div>
  )
}

function InteractionCard({ interaction, isEditing, draft, saving, countLabel = 'estimates', onEdit, onCancel, onSave, onDraftChange }) {
  const OUTCOMES = buildOutcomes(countLabel)
  const outcome = OUTCOMES.find(o => o.value === interaction.outcome) || OUTCOMES[0]

  if (isEditing) {
    return (
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-blue-100 space-y-3">
        <p className="text-gray-700 font-semibold text-sm">Edit Interaction</p>

        {/* Outcome selector */}
        <div>
          <p className="text-gray-500 text-xs mb-1.5">Outcome</p>
          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map(o => (
              <button
                key={o.value}
                onClick={() => onDraftChange(d => ({ ...d, outcome: o.value }))}
                className="px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all"
                style={{
                  borderColor: draft.outcome === o.value ? o.color : '#E5E7EB',
                  backgroundColor: draft.outcome === o.value ? o.color + '20' : 'white',
                  color: draft.outcome === o.value ? o.color : '#6B7280',
                }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Customer name */}
        <div>
          <p className="text-gray-500 text-xs mb-1">Customer Name</p>
          <input
            type="text"
            value={draft.contact_name}
            onChange={e => onDraftChange(d => ({ ...d, contact_name: e.target.value }))}
            placeholder="Customer name"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* Address */}
        <div>
          <p className="text-gray-500 text-xs mb-1">Address</p>
          <input
            type="text"
            value={draft.address}
            onChange={e => onDraftChange(d => ({ ...d, address: e.target.value }))}
            placeholder="123 Main St"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* Revenue (if booked) */}
        {(draft.outcome === 'booked' || draft.outcome === 'estimate_requested') && (
          <div>
            <p className="text-gray-500 text-xs mb-1">Revenue Amount ($)</p>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.revenue_amount}
              onChange={e => onDraftChange(d => ({ ...d, revenue_amount: e.target.value }))}
              placeholder="0.00"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        )}

        {/* Notes */}
        <div>
          <p className="text-gray-500 text-xs mb-1">Notes</p>
          <textarea
            value={draft.notes}
            onChange={e => onDraftChange(d => ({ ...d, notes: e.target.value }))}
            placeholder="Any notes about this visit…"
            rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
          />
        </div>

        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium flex items-center justify-center gap-1">
            <X className="w-4 h-4" /> Cancel
          </button>
          <button onClick={onSave} disabled={saving}
            className="btn-brand flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-1">
            <Check className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    )
  }

  const photoUrls = interaction.photo_urls || []

  return (
    <div className="bg-white rounded-2xl px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        {/* Outcome dot */}
        <div className="mt-1 flex-shrink-0 w-3 h-3 rounded-full" style={{ backgroundColor: outcome.color }} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold" style={{ color: outcome.color }}>{outcome.label}</span>
              {interaction.follow_up && (
                <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-1.5 py-0.5 rounded-full">
                  🏴 Follow Up
                </span>
              )}
            </div>
            <span className="text-gray-400 text-xs flex-shrink-0">
              {format(new Date(interaction.created_at), 'h:mm a')}
            </span>
          </div>
          {interaction.contact_name && (
            <p className="text-gray-800 text-sm mt-0.5 font-medium truncate">{interaction.contact_name}</p>
          )}
          {interaction.address && (
            <p className="text-gray-500 text-xs mt-0.5 truncate">{interaction.address}</p>
          )}
          {interaction.notes && (
            <p className="text-gray-400 text-xs mt-1 line-clamp-2">{interaction.notes}</p>
          )}
          {interaction.revenue_amount > 0 && (
            <p className="text-green-600 text-xs font-medium mt-1">${interaction.revenue_amount.toFixed(2)}</p>
          )}
        </div>

        <button onClick={onEdit}
          className="flex-shrink-0 p-1.5 rounded-lg bg-gray-50 text-gray-400 hover:text-blue-600 hover:bg-blue-50">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Photo thumbnails */}
      {photoUrls.length > 0 && (
        <div className="mt-2 ml-6 flex gap-1.5 flex-wrap">
          {photoUrls.map((url, i) => (
            <PhotoThumb
              key={i}
              pathOrUrl={url}
              bucket="interaction-photos"
              alt={`Photo ${i + 1}`}
              className="w-14 h-14 rounded-lg object-cover border border-gray-200 active:opacity-75"
            />
          ))}
        </div>
      )}
    </div>
  )
}
