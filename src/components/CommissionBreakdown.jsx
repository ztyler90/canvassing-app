/*
 * CommissionBreakdown — a bottom-sheet that itemizes what makes up a rep's
 * commission for the selected period. Opened by tapping the Commission card on
 * the rep dashboard (own pay) or the manager's rep-detail screen (a rep's pay).
 *
 * Two sections:
 *   1. Booked jobs — every booked interaction in the window, with its job
 *      value and the commission it contributes. The per-row commission is
 *      exact for per-booking and flat-% plans; for tiered plans (where pay
 *      depends on cumulative revenue and can't be cleanly attributed to one
 *      job) we show each job's blended share so the rows still sum to the
 *      headline total.
 *   2. Pending estimates — estimate requests that haven't booked yet, with a
 *      callout totalling the job value still on the table. This is the
 *      "money you haven't closed yet" nudge.
 *
 * All figures derive from `interactions` (the same source as the bookings and
 * pipeline views), fetched lazily when the sheet opens.
 */
import { useEffect, useMemo, useState } from 'react'
import { X, DollarSign, Clock, MapPin, TrendingUp, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'
import { getRepCommissionItems } from '../lib/supabase.js'
import { calcCommission, describeCommission } from '../lib/repStats.js'

const fmtMoney = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

// Commission attributable to a single booked job. Exact for per-booking and
// flat-% plans; blended (proportional to job value) for tiered plans so the
// itemized rows always add up to the period total.
function rowCommission(item, config, totalRevenue, totalCommission) {
  const cfg = config || {}
  const val = Number(item.estimated_value) || 0
  switch (cfg.type) {
    case 'per_booking': return Number(cfg.value) || 0
    case 'flat_pct':    return val * ((Number(cfg.value) || 0) / 100)
    case 'tiered_pct':  return totalRevenue > 0 ? totalCommission * (val / totalRevenue) : 0
    default:            return 0
  }
}

function titleFor(item) {
  return item.contact_name?.trim() || item.address?.split(',')[0]?.trim() || 'Unnamed door'
}

export default function CommissionBreakdown({
  open,
  onClose,
  repId,
  days = null,
  config = null,
  periodLabel = '',
  estimateNoun = 'estimate',
  // Optional: parent can pass already-fetched { booked, pending } so the card
  // and this drawer share one fetch (and one source of truth). When omitted,
  // the drawer fetches its own data on open.
  data = null,
  dataLoading = false,
}) {
  const [fetched, setFetched] = useState(null)  // null = not loaded yet
  const [selfLoading, setSelfLoading] = useState(false)
  const usingParentData = data != null

  useEffect(() => {
    if (usingParentData || !open || !repId) return
    let alive = true
    setSelfLoading(true)
    setFetched(null)
    getRepCommissionItems(repId, { days })
      .then((d) => { if (alive) setFetched(d) })
      .catch(() => { if (alive) setFetched({ booked: [], pending: [] }) })
      .finally(() => { if (alive) setSelfLoading(false) })
    return () => { alive = false }
  }, [usingParentData, open, repId, days])

  const items   = usingParentData ? data : fetched
  const loading = usingParentData ? dataLoading : selfLoading

  const { booked, pending, totalRevenue, totalCommission, pendingValue } = useMemo(() => {
    const booked  = items?.booked  || []
    const pending = items?.pending || []
    const totalRevenue = booked.reduce((s, r) => s + (Number(r.estimated_value) || 0), 0)
    const totalCommission = calcCommission({ revenue: totalRevenue, bookings: booked.length }, config)
    const pendingValue = pending.reduce((s, r) => s + (Number(r.estimated_value) || 0), 0)
    return { booked, pending, totalRevenue, totalCommission, pendingValue }
  }, [items, config])

  if (!open) return null

  const pendingNounPlural = `${estimateNoun}s`

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="w-full bg-white rounded-t-3xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* Header — headline commission for the period */}
        <div className="px-5 pt-2 pb-4 border-b shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
                style={{ background: 'linear-gradient(135deg, #059669 0%, #7DC31E 100%)' }}>
                <DollarSign className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">
                  Commission{periodLabel ? ` · ${periodLabel}` : ''}
                </p>
                <p className="text-2xl font-extrabold text-gray-900 leading-tight">{fmtMoney(totalCommission)}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 -mr-1 rounded-full text-gray-400 active:bg-gray-100" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {config ? describeCommission(config) : 'No commission rate set'}
            {booked.length > 0 && <> · {booked.length} booked · {fmtMoney(totalRevenue)} revenue</>}
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading && (
            <p className="text-center text-sm text-gray-400 py-8">Loading your jobs…</p>
          )}

          {!loading && items && (
            <>
              {/* Pending estimates callout — money still on the table */}
              {pending.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                    <p className="text-sm font-bold text-amber-900">
                      {pending.length} pending {pending.length === 1 ? estimateNoun : pendingNounPlural} · {fmtMoney(pendingValue)} unbooked
                    </p>
                  </div>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Currently open (any date) — not booked yet. Commission lands the week each one books.
                  </p>
                </div>
              )}

              {/* Booked jobs */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Booked jobs
                  </h3>
                  <span className="text-xs text-gray-400">{booked.length}</span>
                </div>

                {booked.length === 0 ? (
                  <p className="text-sm text-gray-400 py-3">No booked jobs in this period yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {booked.map((it) => {
                      const comm = rowCommission(it, config, totalRevenue, totalCommission)
                      return (
                        <div key={it.id} className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{titleFor(it)}</p>
                            <p className="text-[11px] text-gray-400 truncate flex items-center gap-1">
                              {(it.booked_at || it.created_at) ? `Booked ${format(new Date(it.booked_at || it.created_at), 'MMM d')}` : ''}
                              {it.address && <><span>·</span><MapPin className="w-3 h-3 shrink-0" /><span className="truncate">{it.address.split(',')[0]}</span></>}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-gray-900 tabular-nums">{fmtMoney(it.estimated_value)}</p>
                            <p className="text-[11px] font-semibold text-emerald-600 tabular-nums">+{fmtMoney(comm)}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* Pending estimate list */}
              {pending.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-2">
                    <TrendingUp className="w-4 h-4 text-amber-500" /> Pending {pendingNounPlural}
                  </h3>
                  <div className="space-y-1.5">
                    {pending.map((it) => (
                      <div key={it.id} className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{titleFor(it)}</p>
                          <p className="text-[11px] text-gray-400 truncate flex items-center gap-1">
                            {it.created_at ? format(new Date(it.created_at), 'MMM d') : ''}
                            {it.appointment_at && <><span>·</span>appt {format(new Date(it.appointment_at), 'MMM d')}</>}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-gray-900 tabular-nums">{fmtMoney(it.estimated_value)}</p>
                          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Unbooked</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {booked.length === 0 && pending.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-8">
                  No bookings or estimates in this period.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
