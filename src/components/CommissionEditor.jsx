/**
 * CommissionEditor — shared editor for a single user's commission rule.
 *
 * Extracted from Settings so it can be reused anywhere a manager sets someone's
 * pay rule. Today that's two places: the rep list in Settings, and the platform
 * managers list in ManagersSettings (a manager who also knocks gets paid like a
 * rep). Lets the user pick one of three structures — flat %, per-booking, or
 * tiered % — and hands the resulting config to `onSave`. Pure UI: it never
 * touches Supabase itself; the caller persists via updateRepCommissionConfig.
 */
import { useState } from 'react'
import { Plus, Trash2, Loader, Check } from 'lucide-react'
import { DEFAULT_COMMISSION_CONFIG } from '../lib/repStats.js'

export default function CommissionEditor({ initialConfig, onSave, onCancel }) {
  const seed = initialConfig || DEFAULT_COMMISSION_CONFIG
  const [type, setType]           = useState(seed.type || 'flat_pct')
  const [flatPct, setFlatPct]     = useState(seed.type === 'flat_pct'    ? seed.value ?? 0 : 10)
  const [perBook, setPerBook]     = useState(seed.type === 'per_booking' ? seed.value ?? 0 : 50)
  const [tiers, setTiers]         = useState(
    seed.type === 'tiered_pct' && Array.isArray(seed.tiers) && seed.tiers.length
      ? seed.tiers
      : [{ upto: 10000, pct: 10 }, { upto: null, pct: 15 }]
  )
  const [saving, setSaving]       = useState(false)

  function updateTier(i, patch) {
    setTiers(prev => prev.map((t, idx) => idx === i ? { ...t, ...patch } : t))
  }
  function addTier() {
    setTiers(prev => {
      // Insert before the "null cap" (final) tier if present.
      const finalIdx = prev.findIndex(t => t.upto == null)
      const newTier  = { upto: 25000, pct: 12 }
      if (finalIdx === -1) return [...prev, newTier]
      const copy = [...prev]
      copy.splice(finalIdx, 0, newTier)
      return copy
    })
  }
  function removeTier(i) {
    setTiers(prev => prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    setSaving(true)
    let config
    if (type === 'flat_pct')    config = { type, value: Number(flatPct) || 0 }
    else if (type === 'per_booking') config = { type, value: Number(perBook) || 0 }
    else {
      // Sanitize tiers: strip empty rows, coerce numbers.
      const cleaned = tiers
        .map(t => ({
          upto: t.upto == null || t.upto === '' ? null : Number(t.upto),
          pct:  Number(t.pct) || 0,
        }))
        .filter(t => t.pct > 0 || t.upto != null)
      config = { type, tiers: cleaned }
    }
    await onSave(config)
    setSaving(false)
  }

  const BRAND = '#1B4FCC'
  const LIME  = '#7DC31E'

  return (
    <div className="border-t border-gray-100 bg-blue-50/30 px-4 py-4 space-y-3">
      {/* Type selector */}
      <div>
        <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-1.5">Commission Type</p>
        <div className="grid grid-cols-3 gap-1 bg-white rounded-xl p-1 border border-gray-200">
          {[
            { id: 'flat_pct',    label: 'Flat %'   },
            { id: 'per_booking', label: 'Per Book' },
            { id: 'tiered_pct',  label: 'Tiered'   },
          ].map(opt => {
            const active = type === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => setType(opt.id)}
                className="py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={active
                  ? { backgroundColor: BRAND, color: 'white' }
                  : { color: '#4B5563' }}>
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Per-type inputs */}
      {type === 'flat_pct' && (
        <div>
          <label className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 block mb-1">Percent of Revenue</label>
          <div className="relative">
            <input
              type="number"
              min="0" max="100" step="0.5"
              value={flatPct}
              onChange={e => setFlatPct(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <span className="absolute right-3 top-2.5 text-gray-400 text-sm">%</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Rep earns <span className="font-semibold" style={{ color: BRAND }}>{Number(flatPct) || 0}%</span> of every dollar booked.
          </p>
        </div>
      )}

      {type === 'per_booking' && (
        <div>
          <label className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 block mb-1">Dollars per Booking</label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-gray-400 text-sm">$</span>
            <input
              type="number"
              min="0" step="1"
              value={perBook}
              onChange={e => setPerBook(e.target.value)}
              className="w-full border border-gray-200 rounded-xl pl-6 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Rep earns <span className="font-semibold" style={{ color: BRAND }}>${Number(perBook) || 0}</span> flat for each booked job.
          </p>
        </div>
      )}

      {type === 'tiered_pct' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] uppercase font-semibold tracking-wide text-gray-500">Revenue Tiers</label>
            <button
              onClick={addTier}
              className="flex items-center gap-1 text-xs font-semibold"
              style={{ color: BRAND }}>
              <Plus className="w-3 h-3" /> Add Tier
            </button>
          </div>
          <div className="space-y-2">
            {tiers.map((t, i) => {
              const isLast = t.upto == null
              return (
                <div key={i} className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
                  <div className="flex-1 flex items-center gap-2 text-xs">
                    <span className="text-gray-500">Up to</span>
                    {isLast ? (
                      <span className="font-semibold text-gray-700 flex-1">∞ (final tier)</span>
                    ) : (
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1.5 text-gray-400">$</span>
                        <input
                          type="number"
                          min="0" step="500"
                          value={t.upto ?? ''}
                          onChange={e => updateTier(i, { upto: e.target.value === '' ? null : Number(e.target.value) })}
                          className="w-full border border-gray-200 rounded-lg pl-5 pr-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
                        />
                      </div>
                    )}
                    <span className="text-gray-500">at</span>
                    <div className="relative w-16">
                      <input
                        type="number"
                        min="0" max="100" step="0.5"
                        value={t.pct}
                        onChange={e => updateTier(i, { pct: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1 pr-5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                      <span className="absolute right-1.5 top-1 text-gray-400 text-xs">%</span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeTier(i)}
                    disabled={tiers.length <= 1}
                    className="p-1 rounded text-red-400 hover:bg-red-50 disabled:opacity-30">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            Earnings are calculated band-by-band — the % for each tier only applies to revenue inside that band.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
          style={{ backgroundColor: LIME }}>
          {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save Commission
        </button>
      </div>
    </div>
  )
}
