/**
 * PendingApproval — gate shown to reps whose users.status='pending'.
 *
 * Reps land here after joining via an invite link. The owner sees them
 * in Settings' "Pending Approvals" list and taps Approve/Reject. Until
 * that happens, every authenticated route funnels into this screen
 * (see App.jsx — `if (user.status === 'pending')`).
 *
 * The screen offers two affordances besides "wait":
 *   1. Check again — refreshUser() re-reads public.users.status; if the
 *      owner has approved them, the next render flips into the rep app.
 *   2. Sign out — useful if the rep used the wrong email or wants to
 *      switch accounts.
 */
import { useState } from 'react'
import { Clock, RefreshCw, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { signOut } from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'

export default function PendingApproval() {
  const { user, refreshUser } = useAuth()
  const [checking, setChecking] = useState(false)

  const handleCheck = async () => {
    setChecking(true)
    await refreshUser()
    setChecking(false)
  }

  const orgName = user?.organization?.name || 'your team'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
      <div className="mb-6 flex flex-col items-center">
        <img src="/logo.png" alt="KnockIQ" className="h-16 w-auto object-contain" />
      </div>

      <div className="w-full max-w-sm bg-white rounded-2xl border border-blue-100 shadow-sm p-6 text-center">
        <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-3"
          style={{ backgroundColor: '#E0E7FF' }}>
          <Clock className="w-7 h-7" style={{ color: BRAND_BLUE }} />
        </div>
        <h1 className="font-bold text-gray-900 text-lg">Waiting for approval</h1>
        <p className="text-gray-600 text-sm mt-2 leading-relaxed">
          You've successfully joined <span className="font-semibold text-gray-800">{orgName}</span>.
          Your manager just needs to approve your account before you can start canvassing.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="btn-brand w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking…' : 'Check again'}
          </button>
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
        If you've been waiting a while, ask your manager to check the
        "Pending Approvals" list in their Settings.
      </p>
    </div>
  )
}
