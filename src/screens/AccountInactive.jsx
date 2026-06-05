/**
 * AccountInactive — gate shown when an org is `paused` or `cancelled`.
 *
 * Mirrors PendingApproval's role in App.jsx: when the org isn't in a usable
 * state, every authenticated route funnels here instead of the dashboard/rep
 * app (see App.jsx — the `orgAccessState(...)` gate).
 *
 * What each viewer sees:
 *   - Owner  → the full story + a one-tap "Reactivate" button (calls the
 *              owner-only resume_org edge action) and a sign-out.
 *   - Rep/closer/non-owner manager → a calm "your team's account is paused"
 *              message and a sign-out. They can't reactivate; only the owner
 *              can, so we don't show them a button that would 403.
 *
 * Two states, one screen:
 *   paused    → reversible anytime; if a resume date was set we show it.
 *   cancelled → reversible until purge_at (90 days); we show the deadline so
 *               the owner knows the clock is running before data is purged.
 */
import { useState } from 'react'
import { PauseCircle, XCircle, RefreshCw, LogOut, AlertTriangle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { signOut, resumeOrganization } from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'

function fmtDate(d) {
  if (!d) return null
  try {
    return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return null
  }
}

export default function AccountInactive() {
  const { user, refreshUser } = useAuth()
  const [working, setWorking] = useState(false)
  const [err, setErr] = useState(null)

  const org      = user?.organization || {}
  const orgName  = org.name || 'your team'
  const cancelled = org.status === 'cancelled'
  // Owner-only reactivation. owner_user_id is loaded by AuthContext.
  const isOwner  = user?.role === 'manager' && org.owner_user_id === user?.id

  const resumeDate = fmtDate(org.resume_at)
  const purgeDate  = fmtDate(org.purge_at)

  const handleReactivate = async () => {
    setWorking(true)
    setErr(null)
    const { error } = await resumeOrganization()
    if (error) {
      setErr(error.message || 'Could not reactivate. Please try again.')
      setWorking(false)
      return
    }
    // Re-read the profile so the org status flips to active and the gate
    // releases on the next render.
    await refreshUser()
    setWorking(false)
  }

  const Icon = cancelled ? XCircle : PauseCircle
  const iconBg = cancelled ? '#FEE2E2' : '#E0E7FF'
  const iconColor = cancelled ? '#DC2626' : BRAND_BLUE

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
      <div className="mb-6 flex flex-col items-center">
        <img src="/logo.png" alt="KnockIQ" className="h-16 w-auto object-contain" />
      </div>

      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
        <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-3"
          style={{ backgroundColor: iconBg }}>
          <Icon className="w-7 h-7" style={{ color: iconColor }} />
        </div>

        <h1 className="font-bold text-gray-900 text-lg">
          {cancelled ? 'Account cancelled' : 'Account paused'}
        </h1>

        {/* Owner copy vs member copy */}
        {isOwner ? (
          <p className="text-gray-600 text-sm mt-2 leading-relaxed">
            {cancelled ? (
              <>
                <span className="font-semibold text-gray-800">{orgName}</span> is cancelled and your
                team's access is off. Your data is safe{purgeDate ? <> until <span className="font-semibold text-gray-800">{purgeDate}</span></> : ''} —
                reactivate before then to pick up exactly where you left off.
              </>
            ) : (
              <>
                <span className="font-semibold text-gray-800">{orgName}</span> is paused, so your
                team can't canvass right now. Everything — territories, reps, pipeline, history — is
                kept safe. {resumeDate
                  ? <>It'll resume automatically on <span className="font-semibold text-gray-800">{resumeDate}</span>, or turn it back on now.</>
                  : <>Turn it back on whenever you're ready.</>}
              </>
            )}
          </p>
        ) : (
          <p className="text-gray-600 text-sm mt-2 leading-relaxed">
            <span className="font-semibold text-gray-800">{orgName}</span>'s account is{' '}
            {cancelled ? 'cancelled' : 'paused'} right now, so the app is temporarily unavailable.
            Reach out to your account owner to bring it back online.
          </p>
        )}

        {err && (
          <div className="mt-4 flex items-start gap-2 text-left bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-700">{err}</p>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {isOwner && (
            <button
              onClick={handleReactivate}
              disabled={working}
              className="btn-brand w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${working ? 'animate-spin' : ''}`} />
              {working ? 'Reactivating…' : 'Reactivate account'}
            </button>
          )}
          <button
            onClick={signOut}
            className="w-full py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>

      <p className="text-center text-xs text-gray-400 mt-6 max-w-xs">
        Questions? <a href="mailto:hello@knockiq.com" className="text-blue-500 hover:underline">hello@knockiq.com</a>
      </p>
    </div>
  )
}
