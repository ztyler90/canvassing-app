/**
 * ProGate — shared UI primitives for Pro feature gating.
 *
 *  • <ProBadge />          — a small "Pro" lock pill to mark gated features.
 *  • <ProUpgradeModal />   — a centered modal explaining the locked feature
 *                            with a "Contact to upgrade" CTA.
 *
 * Standard-tier users see Pro features rendered but grayed out (so they know
 * what they're missing) and get this modal if they try to use one — matching
 * the existing ProSection/LockedTeaser pattern in PipelineTab.
 */
import { Lock, X, Sparkles, Check } from 'lucide-react'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

export function ProBadge({ className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${className}`}
      style={{ backgroundColor: '#EEF3FF', color: BRAND_BLUE }}>
      <Lock className="w-2.5 h-2.5" /> Pro
    </span>
  )
}

export function ProUpgradeModal({
  open,
  onClose,
  feature = 'This feature',
  blurb = 'Upgrade to Pro to unlock it for your whole team.',
  perks = [],
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,.55)' }}
      onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="p-5 text-white relative"
          style={{ background: `linear-gradient(135deg, ${BRAND_BLUE} 0%, #2E6BFF 100%)` }}>
          <button onClick={onClose}
            className="absolute top-3 right-3 p-1 rounded-lg hover:bg-white/15">
            <X className="w-4 h-4" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-2">
            <Sparkles className="w-5 h-5" />
          </div>
          <p className="text-[11px] uppercase tracking-wide font-semibold text-blue-100">Pro feature</p>
          <h3 className="text-lg font-extrabold leading-tight mt-0.5">{feature}</h3>
        </div>
        <div className="p-5">
          <p className="text-sm text-gray-600">{blurb}</p>
          {perks.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {perks.map((p) => (
                <li key={p} className="flex items-center gap-2 text-sm text-gray-700">
                  <Check className="w-4 h-4 flex-shrink-0" style={{ color: BRAND_LIME }} />
                  {p}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex gap-2">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold">
              Not now
            </button>
            <a
              href="mailto:hello@knockiq.com?subject=Upgrade%20to%20Pro&body=Hi%2C%20I%27d%20like%20to%20upgrade%20my%20KnockIQ%20account%20to%20the%20Pro%20plan."
              className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold text-center"
              style={{ backgroundColor: BRAND_BLUE }}>
              Upgrade to Pro →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
