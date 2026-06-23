/**
 * ProGate — shared UI primitives for tier-gated feature gating.
 *
 *  • <ProBadge />          — a small lock pill to mark gated features.
 *  • <ProUpgradeModal />   — a centered modal explaining the locked feature.
 *
 * Web build: shows the "Pro" tier name + an "Upgrade to Pro" mailto CTA, which
 *   is how managers convert from Standard.
 * Native iOS bundle: per Apple Guideline 3.1.1 + 4 (Round 4) the iOS app
 *   cannot reference paid tiers ("Pro") or surface upgrade pathways. Instead
 *   the badge is a generic lock + the modal explains the feature is "not
 *   enabled for your team" and directs the user to ask their team's owner
 *   (who manages plans on the web).
 *
 * Standard-tier users still see Pro features rendered but grayed out (so they
 * know what they're missing) and get this modal if they try to use one —
 * the modal copy just changes between platforms.
 */
import { Lock, X, Sparkles, Check } from 'lucide-react'
import { Capacitor } from '@capacitor/core'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

export function ProBadge({ className = '' }) {
  // On native iOS, hide the "Pro" tier name — show just a generic lock icon
  // (or nothing). The feature itself is still gated by the same isProTier()
  // check; only the visible label changes.
  const isNative = Capacitor.isNativePlatform()
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${className}`}
      style={{ backgroundColor: '#EEF3FF', color: BRAND_BLUE }}
      aria-label={isNative ? 'Locked feature' : 'Pro feature'}>
      <Lock className="w-2.5 h-2.5" /> {isNative ? '' : 'Pro'}
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
  const isNative = Capacitor.isNativePlatform()
  // Native iOS variant: no tier names, no pricing, no upgrade CTA — just an
  // explanation that the team owner controls availability and a single
  // dismiss button.
  if (isNative) {
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
              className="absolute top-3 right-3 p-1 rounded-lg hover:bg-white/15"
              aria-label="Close">
              <X className="w-4 h-4" />
            </button>
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-2">
              <Lock className="w-5 h-5" />
            </div>
            <p className="text-[11px] uppercase tracking-wide font-semibold text-blue-100">Locked</p>
            <h3 className="text-lg font-extrabold leading-tight mt-0.5">{feature}</h3>
          </div>
          <div className="p-5">
            <p className="text-sm text-gray-600">
              This feature isn't enabled for your team. Ask your team's owner
              if you'd like to use it.
            </p>
            <div className="mt-5">
              <button onClick={onClose}
                className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold">
                OK
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
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
