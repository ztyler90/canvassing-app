/**
 * ClosersSettings — manager-only screen for inviting and managing closers.
 *
 * Lives at /settings/closers. Reached from Settings → "Closers" tile.
 *
 * Closers are the people who receive setter-booked appointments for
 * high-ticket sales (roofing, solar, etc.). They do NOT canvass, so we
 * deliberately keep their UX separate from the rep Team section:
 *
 *  - Different invite copy ("Send invite to closer" not "Add Rep")
 *  - Notification preference picker per closer (app / email / sms / both)
 *  - No commission editor (closers paid differently; out of scope here)
 *  - No invite-code share link (closer team is small enough that owners
 *    invite one at a time)
 *
 * Reuses the same manage-team edge function as reps via createCloser(),
 * which just hard-codes role='closer' in the request body.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, UserCheck, Plus, X, Trash2, Mail, Bell, Smartphone,
  MessageSquare, Send, Loader2, Check, Copy,
} from 'lucide-react'
import {
  getAllClosers, createCloser, deleteRep, resendRepInvite,
  updateCloserNotificationPref,
} from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'

const PREF_OPTIONS = [
  { id: 'email', label: 'Email',  icon: Mail        },
  { id: 'sms',   label: 'SMS',    icon: MessageSquare },
  { id: 'app',   label: 'App',    icon: Smartphone  },
  { id: 'both',  label: 'Both',   icon: Bell, hint: 'Email + SMS' },
]

export default function ClosersSettings() {
  const navigate = useNavigate()

  const [closers, setClosers]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [showAdd, setShowAdd]         = useState(false)
  const [name,    setName]            = useState('')
  const [email,   setEmail]           = useState('')
  const [phone,   setPhone]           = useState('')
  const [adding,  setAdding]          = useState(false)
  const [deletingId, setDeletingId]   = useState(null)
  const [resendingId, setResendingId] = useState(null)
  const [toast,   setToast]           = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setClosers(await getAllClosers())
    setLoading(false)
  }

  function showToast(text, type = 'success') {
    setToast({ text, type })
    setTimeout(() => setToast(null), 2400)
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setAdding(true)
    const { error, emailSent, emailError } = await createCloser({
      fullName: name.trim(),
      email:    email.trim(),
      phone:    phone.trim() || undefined,
      mode:     'invite',
    })
    setAdding(false)
    if (error) {
      showToast(error.message || 'Invite failed', 'error')
      return
    }
    if (!emailSent) {
      showToast(`Created. Email delivery: ${emailError || 'failed'}`, 'error')
    } else {
      showToast('Invite sent')
    }
    setName(''); setEmail(''); setPhone('')
    setShowAdd(false)
    await load()
  }

  async function handleDelete(closer) {
    if (!window.confirm(`Remove ${closer.full_name || closer.email} as a closer?`)) return
    setDeletingId(closer.id)
    const { error } = await deleteRep(closer.id)
    setDeletingId(null)
    if (error) {
      showToast(error.message || 'Delete failed', 'error')
      return
    }
    showToast('Closer removed')
    await load()
  }

  async function handleResend(closer) {
    setResendingId(closer.id)
    const { error, emailSent } = await resendRepInvite(closer.id)
    setResendingId(null)
    if (error || !emailSent) {
      showToast(error?.message || 'Resend failed', 'error')
    } else {
      showToast('Invite re-sent')
    }
  }

  async function handlePrefChange(closer, pref) {
    // Optimistic update so the chips feel responsive on slow networks.
    setClosers((cs) =>
      cs.map((c) => c.id === closer.id ? { ...c, closer_notification_pref: pref } : c)
    )
    const { error } = await updateCloserNotificationPref(closer.id, pref)
    if (error) {
      showToast(error.message || 'Update failed', 'error')
      await load() // revert
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <div
        className="px-5 pt-10 pb-6"
        style={{ background: 'linear-gradient(135deg, #1B4FCC 0%, #4338CA 55%, #6D28D9 100%)' }}
      >
        <div className="max-w-3xl mx-auto w-full flex items-center gap-3">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-full bg-white/20 active:bg-white/30 shrink-0"
            aria-label="Back to settings"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-blue-100 text-xs">Settings · Closers</p>
            <h1 className="text-white text-xl font-bold truncate leading-tight">
              Closers
            </h1>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-3xl mx-auto w-full px-4 pt-6 space-y-4">

        {/* Header row + add button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4" style={{ color: BRAND_BLUE }} />
            <h2 className="text-sm font-bold text-gray-800">
              Your closers
            </h2>
            <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {closers.length}
            </span>
          </div>
          {!showAdd && (
            <button
              onClick={() => setShowAdd(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1.5"
              style={{ background: BRAND_BLUE }}
            >
              <Plus className="w-3.5 h-3.5" />
              Invite closer
            </button>
          )}
        </div>

        {/* Add form */}
        {showAdd && (
          <form
            onSubmit={handleAdd}
            className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-900">Invite a new closer</p>
              <button
                type="button"
                onClick={() => { setShowAdd(false); setName(''); setEmail(''); setPhone('') }}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[12px] text-gray-500 leading-snug">
              They'll get an email invite with a link to set their password. By default
              they'll receive new leads via email; they can switch to SMS or the app
              once they log in.
            </p>
            <Input value={name}  onChange={setName}  placeholder="Full name"     required />
            <Input value={email} onChange={setEmail} placeholder="Email address" type="email" required />
            <Input value={phone} onChange={setPhone} placeholder="Phone (optional, for SMS notifications)" type="tel" />
            <button
              type="submit"
              disabled={adding || !name.trim() || !email.trim()}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: BRAND_BLUE }}
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send invite
            </button>
          </form>
        )}

        {/* Closer list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          </div>
        ) : closers.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
            <UserCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-700">No closers yet</p>
            <p className="text-[12px] text-gray-500 mt-1 leading-snug max-w-xs mx-auto">
              Once you invite a closer, setters can route appointments to them at the door.
              Skip this if your reps close their own deals.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {closers.map((c) => (
              <CloserRow
                key={c.id}
                closer={c}
                onResend={() => handleResend(c)}
                onDelete={() => handleDelete(c)}
                onPrefChange={(p) => handlePrefChange(c, p)}
                resending={resendingId === c.id}
                deleting={deletingId === c.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className={`px-4 py-2 rounded-full text-sm font-semibold shadow-lg flex items-center gap-2 ${
            toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
          }`}>
            {toast.type === 'success' && <Check className="w-4 h-4" />}
            {toast.text}
          </div>
        </div>
      )}
    </div>
  )
}

function Input({ value, onChange, placeholder, type = 'text', required }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
    />
  )
}

function CloserRow({ closer, onResend, onDelete, onPrefChange, resending, deleting }) {
  const pref = closer.closer_notification_pref || 'email'
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3.5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 text-sm font-bold flex items-center justify-center shrink-0">
          {(closer.full_name || closer.email || 'C')[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {closer.full_name || '—'}
          </p>
          <p className="text-[12px] text-gray-500 truncate">{closer.email}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onResend}
            disabled={resending}
            title="Resend invite email"
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40"
          >
            {resending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            title="Remove closer"
            className="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Notification pref */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400">Notify via</span>
        {PREF_OPTIONS.map((opt) => {
          const active = opt.id === pref
          const Icon = opt.icon
          return (
            <button
              key={opt.id}
              onClick={() => !active && onPrefChange(opt.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 border transition-colors ${
                active
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
              }`}
              title={opt.hint || opt.label}
            >
              <Icon className="w-3 h-3" />
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
