/**
 * InteractionModal
 * The core UX moment — fires when a door knock is detected (or manually triggered).
 *
 * Steps: 'outcome' → 'details' (estimate/booked) → 'followup'
 * Extras: editable address, photo attachments, booking celebration animation
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { X, User, Phone, Mail, DollarSign, MapPin, Edit2, Check, Camera, MessageSquare } from 'lucide-react'
import {
  logInteraction,
  updateInteraction,
  createBooking,
  uploadInteractionPhoto,
  updateInteractionPhotos,
  flagInteractionFollowUp,
} from '../lib/supabase.js'
import { reverseGeocodeCandidates } from '../lib/geocoding.js'
import VoiceNoteButton from './VoiceNoteButton.jsx'

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

const CONFETTI_COLORS = ['#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#8B5CF6', '#EF4444', '#14B8A6', '#F97316']

export default function InteractionModal({
  knock,
  sessionId,
  repId,
  onClose,
  onSave,
  isAuto = false,
  existingInteraction = null,  // pass to open in edit mode
}) {
  const isEditing = !!existingInteraction
  const [step, setStep]               = useState('outcome')   // 'outcome' | 'details' | 'followup'
  const [selectedOutcome, setOutcome] = useState(existingInteraction?.outcome || null)
  const [address, setAddress]         = useState(existingInteraction?.address || knock?.address || '')
  const [editingAddress, setEditingAddress] = useState(false)
  const [addressDraft, setAddressDraft]     = useState('')
  // Ranked list of nearby address candidates, fetched after mount. Drives
  // the "Not this one?" picker so reps can tap the correct door when the
  // geocoder's top pick is off by a house or two.
  const [candidates, setCandidates]     = useState([])
  const [showPicker, setShowPicker]     = useState(false)
  // Track geocode status so "Detecting address…" doesn't linger forever
  // when the geocoder returns nothing or errors out. 'idle' | 'loading' |
  // 'ok' | 'empty' | 'error'. We only move beyond 'loading' after the
  // fetch resolves, so there's always a clear next state to render.
  const [geocodeStatus, setGeocodeStatus] = useState('idle')
  const [contactName, setContactName]   = useState(existingInteraction?.contact_name  || '')
  const [contactPhone, setContactPhone] = useState(existingInteraction?.contact_phone || '')
  const [contactEmail, setContactEmail] = useState(existingInteraction?.contact_email || '')
  const [selectedServices, setServices] = useState(existingInteraction?.service_types || [])
  const [estimatedValue, setEstValue]   = useState(
    existingInteraction?.estimated_value != null ? String(existingInteraction.estimated_value) : ''
  )
  // Free-form notes about the job — captured on the details step only
  // (Estimate / Booked). No-answer and not-interested outcomes save without
  // notes so reps can log them in one tap.
  const [notes, setNotes]               = useState(existingInteraction?.notes || '')
  const [photos, setPhotos]             = useState([])        // File[]
  const [photoPreviews, setPhotoPreviews] = useState([])      // data URLs
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState('')
  const [showCelebration, setShowCelebration] = useState(false)
  const [savedInteractionId, setSavedInteractionId] = useState(existingInteraction?.id || null)
  const [followUpFlagged, setFollowUpFlagged]       = useState(!!existingInteraction?.follow_up)
  const [slideVisible, setSlideVisible] = useState(false)  // drives slide-in/out
  const outcomeRef = useRef(existingInteraction?.outcome || null)
  const fileInputRef       = useRef(null)
  const celebrationTimeout = useRef(null)
  const slideDownTimer     = useRef(null)
  const dismissTimer       = useRef(null)

  // Fetch address candidates from the geocoder. We prefer the multi-candidate
  // call so the rep can pick a neighbor if the top pick is a house or two
  // off — reverse geocoding on suburban streets is frequently interpolated
  // along the segment rather than keyed to the actual parcel.
  //
  // Skip when editing an existing interaction — its address is already
  // authoritative and we don't want to override it on open.
  useEffect(() => {
    if (isEditing) return
    if (!knock?.lat || !knock?.lng) return
    let cancelled = false
    setGeocodeStatus('loading')
    reverseGeocodeCandidates(knock.lat, knock.lng)
      .then((cands) => {
        if (cancelled) return
        if (!cands?.length) {
          setGeocodeStatus('empty')
          return
        }
        setCandidates(cands)
        // Only auto-pick if we don't already have an address. If
        // `knock.address` was pre-filled by the detector, respect it —
        // the rep can still swap via the picker.
        setAddress((cur) => cur || cands[0].formatted)
        setGeocodeStatus('ok')
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[Geocode] candidates fetch failed', err?.message || err)
        setGeocodeStatus('error')
      })
    return () => { cancelled = true }
  }, [knock, isEditing])

  // Slide in on mount; clean up all timers on unmount
  useEffect(() => {
    requestAnimationFrame(() => setSlideVisible(true))
    return () => {
      clearTimeout(celebrationTimeout.current)
      clearTimeout(slideDownTimer.current)
      clearTimeout(dismissTimer.current)
    }
  }, [])

  // Auto-dismiss after 4 s visible → 0.4 s slide-down (only for auto knocks
  // on a brand-new interaction — never on edits). If no outcome was picked
  // by the time the timer fires, log the house as "no answer" so it still
  // shows on the map.
  useEffect(() => {
    if (!isAuto || isEditing) return
    slideDownTimer.current = setTimeout(() => {
      // If the rep never tapped an outcome, default to "no_answer"
      if (!outcomeRef.current) {
        saveInteraction('no_answer', {}, { silent: true })
      }
      setSlideVisible(false)
      dismissTimer.current = setTimeout(onClose, 400)
    }, 4000)
    return () => {
      clearTimeout(slideDownTimer.current)
      clearTimeout(dismissTimer.current)
    }
  }, [isAuto, isEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel auto-dismiss the moment the rep taps anything
  const cancelAutoDismiss = () => {
    clearTimeout(slideDownTimer.current)
    clearTimeout(dismissTimer.current)
  }

  // Generate photo preview data-URLs whenever selected photos change
  useEffect(() => {
    if (!photos.length) { setPhotoPreviews([]); return }
    const readers = photos.map(
      (file) => new Promise((resolve) => {
        const r = new FileReader()
        r.onload = (e) => resolve(e.target.result)
        r.readAsDataURL(file)
      })
    )
    Promise.all(readers).then(setPhotoPreviews)
  }, [photos])

  // Confetti particles — stable across renders
  const confetti = useMemo(() =>
    Array.from({ length: 28 }, (_, i) => ({
      id:       i,
      color:    CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      left:     `${(i * 3.7 + Math.sin(i) * 12 + 50) % 100}%`,
      delay:    `${((i * 0.09) % 0.7).toFixed(2)}s`,
      size:     `${8 + (i % 5) * 2}px`,
      duration: `${(0.75 + (i % 4) * 0.15).toFixed(2)}s`,
      shape:    i % 3 === 0 ? '50%' : i % 3 === 1 ? '2px' : '0%', // circle, rect, diamond
    })),
  [])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleOutcomeSelect = async (outcomeId) => {
    cancelAutoDismiss()
    setOutcome(outcomeId)
    outcomeRef.current = outcomeId
    if (outcomeId === 'no_answer' || outcomeId === 'not_interested') {
      // Carry the typed notes through so "no answer / not interested" saves
      // still capture any context the rep typed on the outcome screen.
      await saveInteraction(outcomeId, { notes: notes || null })
    } else {
      setStep('details')
    }
  }

  const handleDetailsSave = async (e) => {
    e.preventDefault()
    cancelAutoDismiss()
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
      notes:           notes || null,
    })
  }

  const saveInteraction = async (outcome, extras, opts = {}) => {
    const { silent = false } = opts
    setSaving(true)
    setError('')
    outcomeRef.current = outcome

    const payload = {
      session_id: sessionId,
      rep_id:     repId,
      address:    address || null,
      lat:        knock?.lat || existingInteraction?.lat || null,
      lng:        knock?.lng || existingInteraction?.lng || null,
      outcome,
      ...extras,
    }

    let interactionId = existingInteraction?.id || null
    let savedData     = null

    if (isEditing) {
      // Only update the fields that actually change via the modal — leave
      // session_id / rep_id / lat / lng alone.
      const editUpdates = {
        outcome,
        address:         address || null,
        contact_name:    extras.contact_name,
        contact_phone:   extras.contact_phone,
        contact_email:   extras.contact_email,
        service_types:   extras.service_types,
        estimated_value: extras.estimated_value,
        notes:           extras.notes,
      }
      // Strip undefined so we don't clobber fields with nulls on the "no answer"
      // / "not interested" branch (extras is {}).
      Object.keys(editUpdates).forEach(
        (k) => editUpdates[k] === undefined && delete editUpdates[k]
      )
      const { data, error: err } = await updateInteraction(interactionId, editUpdates)
      if (err) { setError(err.message); setSaving(false); return }
      savedData = data
    } else {
      const { data, error: err } = await logInteraction(payload)
      if (err) { setError(err.message); setSaving(false); return }
      savedData   = data
      interactionId = data?.id
      setSavedInteractionId(interactionId)
    }

    // Upload photos (best-effort — failure doesn't block saving). Skip in
    // silent mode (auto-dismiss without rep input) since no photos are possible.
    if (!silent && photos.length > 0 && interactionId) {
      try {
        const urls = (
          await Promise.all(photos.map((f) => uploadInteractionPhoto(interactionId, f)))
        ).filter(Boolean)
        if (urls.length > 0) {
          await updateInteractionPhotos(interactionId, urls)
          payload.photo_urls = urls
        }
      } catch (photoErr) {
        console.warn('[Photos] Upload failed:', photoErr)
      }
    }

    // Create booking record (only on first-time save — on edits the booking
    // row already exists and shouldn't be duplicated).
    if (!isEditing && outcome === 'booked' && savedData) {
      await createBooking({
        interaction_id:  savedData.id,
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

    onSave?.({ ...payload, id: interactionId, isEdit: isEditing })
    setSaving(false)

    // Silent saves (auto-no-answer on timeout, or edits) skip the
    // celebration / followup flow — the modal is about to close.
    if (silent) return

    if (isEditing) {
      // Edits: confirm + close without running the followup wizard again.
      onClose?.()
      return
    }

    if (outcome === 'booked') {
      setShowCelebration(true)
      celebrationTimeout.current = setTimeout(() => {
        setShowCelebration(false)
        setStep('followup')
      }, 2600)
    } else {
      setStep('followup')
    }
  }

  const handleFollowUpFlag = async () => {
    if (savedInteractionId) await flagInteractionFollowUp(savedInteractionId)
    setFollowUpFlagged(true)
  }

  const handleSetAppointment = () => {
    const title    = encodeURIComponent(`Follow Up${address ? ` – ${address}` : ''}${contactName ? ` (${contactName})` : ''}`)
    const details  = encodeURIComponent(
      [
        contactName  ? `Customer: ${contactName}`  : '',
        contactPhone ? `Phone: ${contactPhone}`    : '',
        contactEmail ? `Email: ${contactEmail}`    : '',
        address      ? `Address: ${address}`       : '',
      ].filter(Boolean).join('\n')
    )
    const location = encodeURIComponent(address || '')
    window.open(
      `https://calendar.google.com/calendar/r/eventedit?text=${title}&details=${details}&location=${location}`,
      '_blank'
    )
  }

  const handlePhotoSelect = (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length) setPhotos((prev) => [...prev, ...files].slice(0, 5))
    e.target.value = ''
  }

  const removePhoto = (i) => setPhotos((prev) => prev.filter((_, idx) => idx !== i))

  const toggleService = (svc) =>
    setServices((prev) => prev.includes(svc) ? prev.filter((s) => s !== svc) : [...prev, svc])

  const confirmAddress = () => {
    setAddress(addressDraft)
    setEditingAddress(false)
    // A manual edit supersedes the geocoded candidates — close the picker so
    // the rep doesn't think they still need to tap one of the chips.
    setShowPicker(false)
  }

  const pickCandidate = (formatted) => {
    setAddress(formatted)
    setShowPicker(false)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>

      {/* Keyframe definitions */}
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translateY(-12px) rotate(0deg)   scale(1);   opacity: 1; }
          100% { transform: translateY(300px) rotate(540deg) scale(0.3); opacity: 0; }
        }
        @keyframes cel-bounce {
          0%   { transform: scale(0.15); opacity: 0; }
          55%  { transform: scale(1.22); opacity: 1; }
          75%  { transform: scale(0.91); }
          90%  { transform: scale(1.06); }
          100% { transform: scale(1);    opacity: 1; }
        }
        @keyframes cel-fade-up {
          0%   { transform: translateY(18px); opacity: 0; }
          100% { transform: translateY(0);    opacity: 1; }
        }
      `}</style>

      {/* Bottom sheet — slides up on mount, slides back down on auto-dismiss */}
      <div
        className="w-full bg-white rounded-t-3xl shadow-2xl relative"
        style={{
          maxHeight: '92vh',
          overflowY: 'auto',
          transform: slideVisible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.4s ease-out',
        }}
      >

        {/* ── Celebration overlay ───────────────────────────────────────── */}
        {showCelebration && (
          <div
            className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-t-3xl overflow-hidden cursor-pointer select-none"
            style={{ backgroundColor: '#ECFDF5' }}
            onClick={() => { setShowCelebration(false); setStep('followup') }}
          >
            {/* Confetti pieces */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {confetti.map((p) => (
                <div
                  key={p.id}
                  className="absolute"
                  style={{
                    left:            p.left,
                    top:             '-14px',
                    width:           p.size,
                    height:          p.size,
                    backgroundColor: p.color,
                    borderRadius:    p.shape,
                    animation:       `confetti-fall ${p.duration} ${p.delay} ease-in both`,
                  }}
                />
              ))}
            </div>

            {/* Main celebration content */}
            <div style={{ animation: 'cel-bounce 0.75s ease-out both' }} className="text-8xl mb-5 leading-none">
              🎉
            </div>
            <div
              className="text-3xl font-extrabold text-green-700 mb-2 tracking-tight"
              style={{ animation: 'cel-fade-up 0.45s 0.3s ease-out both' }}
            >
              Job Booked!
            </div>
            <div
              className="text-green-500 text-base font-medium"
              style={{ animation: 'cel-fade-up 0.45s 0.5s ease-out both' }}
            >
              🏆 Great work!
            </div>
            <div
              className="text-gray-400 text-sm mt-6"
              style={{ animation: 'cel-fade-up 0.45s 0.7s ease-out both' }}
            >
              Tap to continue
            </div>
          </div>
        )}

        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* Address row — always visible */}
        <div className="px-5 pt-2 pb-3 border-b">
          {editingAddress ? (
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={addressDraft}
                onChange={(e) => setAddressDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')  confirmAddress()
                  if (e.key === 'Escape') setEditingAddress(false)
                }}
                placeholder="Enter address"
                className="flex-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400"
              />
              <button
                onClick={confirmAddress}
                className="p-1.5 rounded-lg bg-green-50 text-green-600 active:bg-green-100"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => setEditingAddress(false)}
                className="p-1.5 rounded-lg bg-gray-50 text-gray-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <MapPin className={`w-4 h-4 shrink-0 ${geocodeStatus === 'error' || geocodeStatus === 'empty' ? 'text-amber-500' : 'text-gray-400'}`} />
              <span className={`text-sm truncate flex-1 ${
                address
                  ? 'text-gray-600'
                  : geocodeStatus === 'loading' || geocodeStatus === 'idle'
                    ? 'text-gray-400 italic'
                    : 'text-amber-600'
              }`}>
                {address
                  ? address
                  : geocodeStatus === 'loading' || geocodeStatus === 'idle'
                    ? 'Detecting address…'
                    : geocodeStatus === 'error'
                      ? 'Address lookup failed — tap ✏️ to type it'
                      : 'No address found — tap ✏️ to type it'}
              </span>
              {(geocodeStatus === 'error' || geocodeStatus === 'empty') && (
                <button
                  type="button"
                  onClick={() => { /* bumping knock ref not possible — just retry directly */
                    if (!knock?.lat || !knock?.lng) return
                    setGeocodeStatus('loading')
                    reverseGeocodeCandidates(knock.lat, knock.lng)
                      .then((cands) => {
                        if (!cands?.length) { setGeocodeStatus('empty'); return }
                        setCandidates(cands)
                        setAddress((cur) => cur || cands[0].formatted)
                        setGeocodeStatus('ok')
                      })
                      .catch((err) => {
                        console.warn('[Geocode] retry failed', err?.message || err)
                        setGeocodeStatus('error')
                      })
                  }}
                  className="text-[11px] font-semibold text-blue-600 active:text-blue-700 px-1.5"
                  title="Try address lookup again"
                >
                  Retry
                </button>
              )}
              <button
                onClick={() => { setAddressDraft(address); setEditingAddress(true) }}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="Edit address"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={onClose} className="ml-0.5 p-1">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          )}
        </div>

        {/* Address picker — shown when the geocoder returned multiple nearby
            candidates. Lets the rep swap if the top pick is off by a house
            or two. Hidden entirely while editing the address manually. */}
        {!editingAddress && candidates.length > 1 && (
          <div className="px-5 pt-2 pb-3 border-b bg-gray-50/60">
            <button
              type="button"
              onClick={() => setShowPicker((s) => !s)}
              className="text-xs font-medium text-blue-600 active:text-blue-700"
            >
              {showPicker ? 'Hide nearby addresses ▲' : 'Wrong address? Pick from nearby ▾'}
            </button>
            {showPicker && (
              <div className="mt-2 space-y-1.5">
                {candidates.map((c, i) => {
                  const selected = c.formatted === address
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => pickCandidate(c.formatted)}
                      className="w-full flex items-center justify-between gap-2 p-2.5 rounded-xl border-2 text-left text-sm active:scale-[0.99] transition-transform"
                      style={{
                        borderColor:     selected ? '#1A6B3A' : '#E5E7EB',
                        backgroundColor: selected ? '#ECFDF5' : 'white',
                      }}
                    >
                      <span className="flex-1 text-gray-700 leading-snug">
                        {c.formatted}
                      </span>
                      <span className="shrink-0 flex flex-col items-end gap-0.5 text-[10px]">
                        <span className="text-gray-400">
                          ~{Math.round(c.distanceM)}m
                        </span>
                        <span
                          className="px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
                          style={{
                            backgroundColor: c.precise ? '#ECFDF5' : '#FFFBEB',
                            color:           c.precise ? '#047857' : '#B45309',
                          }}
                        >
                          {c.precise ? 'rooftop' : 'approx'}
                        </span>
                      </span>
                    </button>
                  )
                })}
                <p className="text-[11px] text-gray-400 pt-1">
                  Tap the door you're actually standing at. Rooftop matches are keyed to the building; approx picks are interpolated along the street.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Step: outcome ─────────────────────────────────────────────── */}
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

        {/* ── Step: details ─────────────────────────────────────────────── */}
        {step === 'details' && (
          <form onSubmit={handleDetailsSave} className="px-5 py-4 space-y-4">
            <h3 className="font-bold text-gray-900 text-base">
              {selectedOutcome === 'booked' ? '🎉 Book the Job' : '📋 Estimate Details'}
            </h3>

            {/* Customer name */}
            <div className="relative">
              <User className="absolute left-3 top-3.5 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Customer name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-blue-400 focus:outline-none"
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
                className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>

            {/* Email */}
            <div className="relative">
              <Mail className="absolute left-3 top-3.5 w-4 h-4 text-gray-400" />
              <input
                type="email"
                inputMode="email"
                placeholder="Email (optional)"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-blue-400 focus:outline-none"
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

            {/* Estimated value */}
            <div className="relative">
              <DollarSign className="absolute left-3 top-3.5 w-4 h-4 text-gray-400" />
              <input
                type="number"
                inputMode="numeric"
                placeholder={selectedOutcome === 'booked' ? 'Job value (required)' : 'Estimated value'}
                value={estimatedValue}
                onChange={(e) => setEstValue(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-blue-400 focus:outline-none"
                required={selectedOutcome === 'booked'}
              />
            </div>

            {/* Photo attachments */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                Photos {photos.length > 0 && <span className="normal-case text-gray-400 font-normal">({photos.length}/5)</span>}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handlePhotoSelect}
              />
              {/* Thumbnails */}
              {photoPreviews.length > 0 && (
                <div className="flex gap-2 mb-2.5 flex-wrap">
                  {photoPreviews.map((src, i) => (
                    <div key={i} className="relative">
                      <img
                        src={src}
                        alt={`Photo ${i + 1}`}
                        className="w-16 h-16 rounded-xl object-cover border-2 border-gray-200"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-bold shadow-sm"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {photos.length < 5 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 text-sm font-medium hover:border-blue-400 hover:text-blue-500 transition-colors active:bg-gray-50"
                >
                  <Camera className="w-4 h-4" />
                  {photoPreviews.length > 0 ? 'Add More Photos' : 'Add Photos'}
                </button>
              )}
            </div>

            {/* Notes — free-form comments saved with the interaction record.
                Voice-note button lives in the label row so the rep can dictate
                a note hands-free (Whisper transcription). The transcription is
                appended to whatever is already typed so reps can refine by
                voice + keyboard without clobbering earlier input. */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Notes <span className="text-gray-400 normal-case font-normal">(optional)</span>
                </label>
                <VoiceNoteButton
                  disabled={saving}
                  onTranscribed={(text) => {
                    if (!text) return
                    setNotes((prev) => prev ? `${prev.trimEnd()} ${text}` : text)
                  }}
                />
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any comments about this job… or tap the mic to dictate."
                rows={3}
                className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-blue-400 focus:outline-none resize-none"
              />
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

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

        {/* ── Step: followup ────────────────────────────────────────────── */}
        {step === 'followup' && (
          <div className="px-5 py-5 pb-8 space-y-3">
            <div className="text-center mb-5">
              <span className="text-2xl">✓</span>
              <h3 className="font-bold text-gray-900 text-lg mt-1">Saved!</h3>
              <p className="text-gray-500 text-sm mt-1">Anything else for this contact?</p>
            </div>

            {/* Flag for follow-up */}
            {followUpFlagged ? (
              <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-amber-50 border-2 border-amber-200">
                <span className="text-xl shrink-0">🏴</span>
                <div>
                  <p className="font-semibold text-amber-800 text-sm">Flagged for Follow Up</p>
                  <p className="text-amber-600 text-xs mt-0.5">Visible to managers in the Bookings view.</p>
                </div>
              </div>
            ) : (
              <button
                onClick={handleFollowUpFlag}
                className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl border-2 border-amber-200 bg-amber-50 active:bg-amber-100 transition-colors text-left"
              >
                <span className="text-2xl shrink-0">🏴</span>
                <div>
                  <p className="font-semibold text-amber-800 text-sm">Flag for Follow Up</p>
                  <p className="text-amber-600 text-xs mt-0.5">Mark this contact as worth reconnecting with</p>
                </div>
              </button>
            )}

            {/* Set appointment */}
            <button
              onClick={handleSetAppointment}
              className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl border-2 border-blue-200 bg-blue-50 active:bg-blue-100 transition-colors text-left"
            >
              <span className="text-2xl shrink-0">📅</span>
              <div>
                <p className="font-semibold text-blue-800 text-sm">Set an Appointment</p>
                <p className="text-blue-600 text-xs mt-0.5">Open Google Calendar with contact pre-filled</p>
              </div>
            </button>

            {/* Done */}
            <button
              onClick={onClose}
              className="w-full py-3.5 rounded-2xl border-2 border-gray-200 text-gray-600 font-semibold text-sm active:bg-gray-50 mt-1"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
