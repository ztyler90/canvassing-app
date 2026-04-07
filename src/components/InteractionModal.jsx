/**
 * InteractionModal
 * The core UX moment — fires when a door knock is detected (or manually triggered).
 * Designed to complete in < 10 seconds for simple outcomes (no answer, not interested)
 * and < 30 seconds for estimate/booked with contact capture.
 */
import { useState, useEffect } from 'react'
import { X, User, Phone, Mail, DollarSign, MapPin } from 'lucide-react'
import { logInteraction, createBooking } from '../lib/supabase.js'
import { reverseGeocode } from '../lib/geocoding.js'

const OUTCOMES = [
  { id: 'no_answer',          label: 'No Answer',       emoji: '🚪', color: '#9CA3AF', bg: '#F9FAFB' },
  { id: 'not_interested',     label: 'Not Interested',  emoji: '✋', color: '#EF4444', bg: '#FEF2F2' },
  { id: 'estimate_requested', label: 'Estimate',        emoji: '📋', color: '#F59E0B', bg: '#FFFBEB' },
  { id: 'booked',             label: 'Booked!',         emoji: '✅', color: '#10B981', bg: '#ECFDF5' },
]

const SERVICES = [
  'Window Cleaning',
  'Gutter Cleaning',
  'House Washing',
  'Roof Cleaning',
  'Driveway Washing',
  'Holiday Lights',
]

export default function InteractionModal({
  knock,
  sessionId,
  repId,
  onClose,
  onSave,
  isAuto = false,
}) {
  const [step, setStep]             = useState('outcome')  // 'outcome' | 'details'
  const [selectedOutcome, setOutcome] = useState(null)
  const [address, setAddress]       = useState(knock?.address || '')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [selectedServices, setServices] = useState([])
  const [estimatedValue, setEstValue] = useState('')
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  // Geocode address if not already provided
  useEffect(() => {
    if (!address && knock?.lat && knock?.lng) {
      reverseGeocode(knock.lat, knock.lng).then((addr) => {
        if (addr) setAddress(addr)
      })
    }
  }, [knock])

  const needsDetails = selectedOutcome === 'estimate_requested' || selectedOutcome === 'booked'

  const handleOutcomeSelect = async (outcomeId) => {
    setOutcome(outcomeId)
    if (outcomeId === 'no_answer' || outcomeId === 'not_interested') {
      // Immediate save — no extra fields needed
      await saveInteraction(outcomeId, {})
    } else {
      setStep('details')
    }
  }

  const handleDetailsSave = async (e) => {
    e.preventDefault()
    if (!estimatedValue && selectedOutcome === 'booked') {
      setError('Please enter an estimated job value.')
      return
    }
    await saveInteraction(selectedOutcome, {
      contact_name:    contactName,
      contact_phone:   contactPhone,
      contact_email:   contactEmail,
      service_types:   selectedServices,
      estimated_value: estimatedValue ? Number(estimatedValue) : null,
    })
  }

  const saveInteraction = async (outcome, extras) => {
    setSaving(true)
    setError('')

    const payload = {
      session_id: sessionId,
      rep_id:     repId,
      address:    address || null,
      lat:        knock?.lat || null,
      lng:        knock?.lng || null,
      outcome,
      ...extras,
    }

    const { data, error: err } = await logInteraction(payload)
    if (err) { setError(err.message); setSaving(false); return }

    // Also create a booking record if booked
    if (outcome === 'booked' && data) {
      await createBooking({
        interaction_id:  data.id,
        session_id:      sessionId,
        rep_id:          repId,
        address:         address,
        contact_name:    extras.contact_name,
        contact_phone:   extras.contact_phone,
        service_types:   extras.service_types,
        estimated_value: extras.estimated_value,
        status:          'booked',
      })
    }

    onSave?.({ ...payload, id: data?.id })
    setSaving(false)
  }

  const toggleService = (svc) => {
    setServices((prev) =>
      prev.includes(svc) ? prev.filter((s) => s !== svc) : [...prev, svc]
    )
  }

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      {/* Sheet */}
      <div className="w-full bg-white rounded-t-3xl shadow-2xl overflow-hidden"
        style={{ maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* Address */}
        <div className="px-5 pt-2 pb-3 border-b flex items-center gap-2">
          <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="text-sm text-gray-600 truncate">
            {address || 'Detecting address…'}
          </span>
          <button onClick={onClose} className="ml-auto p-1">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {step === 'outcome' && (
          <div className="px-5 py-4">
            {isAuto && (
              <p className="text-xs text-gray-400 text-center mb-4">
                Stop detected — what happened at this door?
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {OUTCOMES.map((o) => (
                <button
                  key={o.id}
                  onClick={() => handleOutcomeSelect(o.id)}
                  disabled={saving}
                  className="flex flex-col items-center py-5 rounded-2xl active:scale-95 transition-transform disabled:opacity-60"
                  style={{ backgroundColor: o.bg, border: `2px solid ${o.color}20` }}
                >
                  <span className="text-3xl mb-2">{o.emoji}</span>
                  <span className="font-semibold text-sm" style={{ color: o.color }}>{o.label}</span>
                </button>
              ))}
            </div>
            {saving && (
              <p className="text-center text-sm text-gray-400 mt-4">Saving…</p>
            )}
          </div>
        )}

        {step === 'details' && (
          <form onSubmit={handleDetailsSave} className="px-5 py-4 space-y-4">
            <h3 className="font-bold text-gray-900 text-base">
              {selectedOutcome === 'booked' ? '🎉 Book the Job' : '📋 Estimate Details'}
            </h3>

            {/* Name */}
            <div className="relative">
              <User className="absolute left-3 top-3.5 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Customer name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-brand-700 focus:outline-none"
              />
            </div>

            {/* Phone */}
            <div className="relative">
              <Phone className="absolute left-3 top-3.5 w-4 h-4 text-gray-400" />
              <input
                type="tel"
                inputMode="tel"
                placeholder="Phone number"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-brand-700 focus:outline-none"
              />
            </div>

            {/* Email (optional) */}
            <div className="relative">
              <Mail className="absolute left-3 top-3.5 w-4 h-4 text-gray-400" />
              <input
                type="email"
                inputMode="email"
                placeholder="Email (optional)"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-brand-700 focus:outline-none"
              />
            </div>

            {/* Services */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Services</p>
              <div className="flex flex-wrap gap-2">
                {SERVICES.map((svc) => {
                  const active = selectedServices.includes(svc)
                  return (
                    <button
                      key={svc}
                      type="button"
                      onClick={() => toggleService(svc)}
                      className="px-3 py-1.5 rounded-full text-sm font-medium border-2 transition-colors"
                      style={{
                        backgroundColor: active ? '#1A6B3A' : 'transparent',
                        borderColor:     active ? '#1A6B3A' : '#D1D5DB',
                        color:           active ? 'white'   : '#374151',
                      }}
                    >
                      {svc}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Estimated Value */}
            <div className="relative">
              <DollarSign className="absolute left-3 top-3.5 w-4 h-4 text-gray-400" />
              <input
                type="number"
                inputMode="numeric"
                placeholder={selectedOutcome === 'booked' ? 'Job value (required)' : 'Estimated value'}
                value={estimatedValue}
                onChange={(e) => setEstValue(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-brand-700 focus:outline-none"
                required={selectedOutcome === 'booked'}
              />
            </div>

            {error && (
              <p className="text-red-600 text-sm">{error}</p>
            )}

            <div className="flex gap-3 pt-1 pb-4">
              <button
                type="button"
                onClick={() => setStep('outcome')}
                className="flex-1 py-3.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm"
              >
                ← Back
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-3.5 rounded-xl text-white font-semibold text-sm disabled:opacity-60"
                style={{ backgroundColor: selectedOutcome === 'booked' ? '#10B981' : '#F59E0B' }}
              >
                {saving ? 'Saving…' : selectedOutcome === 'booked' ? 'Book Job ✓' : 'Save Estimate'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
