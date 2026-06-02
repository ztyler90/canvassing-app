import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Component, useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
import { SessionProvider } from './contexts/SessionContext.jsx'
import Login             from './screens/Login.jsx'
import Signup            from './screens/Signup.jsx'
import RepJoin           from './screens/RepJoin.jsx'
import PendingApproval   from './screens/PendingApproval.jsx'
import SetPassword       from './screens/SetPassword.jsx'
import RepHome           from './screens/RepHome.jsx'
import ActiveCanvassing  from './screens/ActiveCanvassing.jsx'
import SessionSummary    from './screens/SessionSummary.jsx'
import SessionDetail     from './screens/SessionDetail.jsx'
import ManagerDashboard  from './screens/ManagerDashboard.jsx'
import RepDetail         from './screens/RepDetail.jsx'
import Settings          from './screens/Settings.jsx'
import PipelineSettings  from './screens/PipelineSettings.jsx'
import ClosersSettings   from './screens/ClosersSettings.jsx'
import CloserHome        from './screens/CloserHome.jsx'
import CloserProfile     from './screens/CloserProfile.jsx'
import RepProfile        from './screens/RepProfile.jsx'
import RepTerritories    from './screens/RepTerritories.jsx'
import SuperAdminDashboard from './screens/SuperAdminDashboard.jsx'
import OrganizationDetail  from './screens/OrganizationDetail.jsx'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('[KnockIQ Error]', error?.message, info?.componentStack?.slice(0, 300)) }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 20, fontFamily: 'monospace', background: '#fee2e2', color: '#991b1b', minHeight: '100vh' }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>⚠️ App Error</h2>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#fff', padding: 12, borderRadius: 8 }}>
          {this.state.error?.toString()}{'\n\n'}{this.state.error?.stack}
        </pre>
      </div>
    )
    return this.props.children
  }
}

function WelcomeRedirect() {
  // Send unknown / unauthenticated routes to "/". Vercel rewrites "/" to
  // serve public/welcome.html silently, so the URL bar stays clean instead
  // of flashing "/welcome.html".
  //
  // Guard against an infinite-redirect loop: if we somehow rendered the
  // React app at "/" itself (stale service worker that hasn't picked up
  // the navigateFallbackDenylist yet, dev mode where Vercel rewrites
  // don't apply, or a CDN cache anomaly), redirecting to "/" again just
  // re-loads the React app and re-fires this component — that's the
  // "loading screen blinks forever" symptom users reported. Going to
  // /welcome.html directly bypasses both the rewrite and the loop. The
  // URL bar shows /welcome.html for that one navigation, which is a
  // small cosmetic cost compared to the marketing page never appearing.
  if (typeof window !== 'undefined') {
    if (window.location.pathname === '/') {
      window.location.replace('/welcome.html')
    } else {
      window.location.replace('/')
    }
  }
  return null
}

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingScreen />

  if (!user) return (
    <Routes>
      <Route path="/signup"        element={<Signup />} />
      <Route path="/login"         element={<Login />} />
      {/* /join/:code — shareable invite-link rep sign-up. Reachable
          pre-auth because the whole point is letting someone without an
          account create one. Resolves the code to an org-name preview
          before asking for any info, so a stale link surfaces an error
          immediately instead of after a failed signup. */}
      <Route path="/join/:code"    element={<RepJoin />} />
      {/* /set-password renders both pre-auth (while Supabase is still
          parsing the invite link from the URL hash) and post-auth (once
          the session has landed and the rep needs to pick a password),
          so it needs to be reachable in both trees. */}
      <Route path="/set-password"  element={<SetPassword />} />
      <Route path="*"              element={<WelcomeRedirect />} />
    </Routes>
  )

  // Pending-approval gate. Reps who self-registered via an invite link
  // land here in `status='pending'` until their manager taps Approve in
  // Settings. The check sits ABOVE force_password_change because invite-
  // link reps already chose their own password during the join flow —
  // they don't have a temp-password override to clear, and even if some
  // future code path stamped both flags, "your account isn't approved
  // yet" is the more honest first message to show. PendingApproval has
  // a "Check again" button that calls refreshUser(); the moment the
  // owner flips status → 'active', the next render falls through to
  // the rep tree below.
  if (user.status === 'pending') return (
    <Routes>
      <Route path="*" element={<PendingApproval />} />
    </Routes>
  )

  // Force-password-change gate. Set on a rep's row when their manager
  // creates them with a temporary password (Settings → Add Rep → Temp
  // Password mode). Until the rep picks a real password via /set-password
  // (which clears the flag), funnel every route into that screen so they
  // can't poke around the app on the manager's credential.
  if (user.force_password_change) return (
    <Routes>
      <Route path="/set-password" element={<SetPassword />} />
      <Route path="*"             element={<Navigate to="/set-password" replace />} />
    </Routes>
  )

  if (user.role === 'manager') return (
    <Routes>
      <Route path="/manager"           element={<ManagerDashboard />} />
      <Route path="/manager/rep/:repId" element={<RepDetail />} />
      <Route path="/settings"          element={<Settings />} />
      <Route path="/settings/pipeline" element={<PipelineSettings />} />
      <Route path="/settings/closers"  element={<ClosersSettings />} />
      <Route path="/session/:id"       element={<SessionDetail />} />
      {user.is_super_admin && <Route path="/super-admin"            element={<SuperAdminDashboard />} />}
      {user.is_super_admin && <Route path="/super-admin/org/:orgId" element={<OrganizationDetail />}  />}
      <Route path="*"                  element={<Navigate to="/manager" replace />} />
    </Routes>
  )

  // Closer routes — Phase 2. Closers see ONLY their inbox + profile.
  // No canvassing, no GPS, no territories, no other reps. The role enum
  // gate prevents managers/super-admins from accidentally hitting this
  // branch even if they craft the URL by hand. SessionProvider is not
  // wrapped here because closers don't run canvassing sessions.
  if (user.role === 'closer') return (
    <Routes>
      <Route path="/closer"         element={<CloserHome />} />
      <Route path="/closer/profile" element={<CloserProfile />} />
      <Route path="/set-password"   element={<SetPassword />} />
      <Route path="*"               element={<Navigate to="/closer" replace />} />
    </Routes>
  )

  // Rep routes (wrapped with SessionProvider for live session state)
  return (
    <SessionProvider>
      <Routes>
        <Route path="/"              element={<RepHome />} />
        <Route path="/profile"       element={<RepProfile />} />
        <Route path="/territories"   element={<RepTerritories />} />
        <Route path="/canvassing"    element={<ActiveCanvassing />} />
        <Route path="/summary"       element={<SessionSummary />} />
        <Route path="/session/:id"   element={<SessionDetail />} />
        {/* Reachable post-auth so a freshly-invited rep lands here after
            Supabase processes the invite link's hash and establishes a
            session — they still need to set a password before anything
            else makes sense. */}
        <Route path="/set-password"  element={<SetPassword />} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  )
}

function LoadingScreen() {
  // After 6s, surface a self-recovery option. The AuthContext failsafe
  // already force-unsticks loading at 8s, but on a flaky connection (or if
  // a service-worker / cached-bundle issue caused the JS to load in a weird
  // state) a reload from the user is still the cleanest reset. Showing this
  // means reps don't need to know about "hard refresh" — they can just tap.
  const [showRecovery, setShowRecovery] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShowRecovery(true), 6000)
    return () => clearTimeout(t)
  }, [])

  // Force a clean reload: bypass the SPA router AND nudge the service worker
  // to drop its cached HTML by appending a cache-busting query string.
  // Preserve the user's current path — for a logged-in rep stuck loading on
  // /canvassing, we don't want to dump them on the marketing page.
  const handleReload = () => {
    try {
      // Best-effort: tell any registered SW to skip waiting / re-fetch.
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => r.update())
        }).catch(() => {})
      }
    } finally {
      const path = window.location.pathname || '/'
      window.location.href = `${path}?_r=${Date.now()}`
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-brand-header">
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          </svg>
        </div>
        <p className="text-gray-500 text-sm">Loading…</p>
        {showRecovery && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-gray-400 text-xs">Taking longer than usual</p>
            <button
              onClick={handleReload}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300"
            >
              Tap to reload
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
