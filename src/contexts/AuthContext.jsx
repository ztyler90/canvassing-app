import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const AuthContext = createContext(null)

/**
 * Race a promise against a timeout. If the promise doesn't settle in `ms`
 * milliseconds, reject — the caller decides what to do with the timeout.
 * Used to keep Supabase queries from hanging the loading screen forever
 * when the auth Web Lock is contended (multi-tab) or a token-refresh is
 * mid-flight. Without this, a single hung fetch can pin `loading=true`
 * indefinitely and the only way out is the hard refresh users have been
 * reporting.
 */
function withTimeout(promise, ms, label = 'query') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`[Auth] ${label} timed out after ${ms}ms`)), ms)
    ),
  ])
}

// Build a user profile from a Supabase session user object + optional DB row.
// Phase 1: also attaches the user's organization row so the UI can show org
// name / tier / seats and drive super-admin gating.
//
// Every DB call here is wrapped in withTimeout — if the network or the auth
// Web Lock is stuck, we'd rather fall back to a metadata-only profile (good
// enough to render the right route tree) than hang the loading screen. The
// real row will land on the next auth event / refreshUser() call.
async function buildProfile(sessionUser) {
  if (!sessionUser) return null
  const meta = sessionUser.user_metadata || {}
  const metaFallback = () => ({
    id: sessionUser.id,
    email: sessionUser.email,
    full_name: meta.full_name || sessionUser.email,
    role: meta.role || 'rep',
    organization_id: null,
    organization: null,
    is_super_admin: false,
    avatar_url: meta.avatar_url || null,
    force_password_change: false,
    phone: null,
  })

  try {
    const { data: row } = await withTimeout(
      supabase
        .from('users')
        .select('id, email, full_name, role, organization_id, is_super_admin, avatar_url, force_password_change, phone')
        .eq('id', sessionUser.id)
        .single(),
      4000,
      'users.select'
    )
    if (row) {
      let organization = null
      if (row.organization_id) {
        try {
          const { data: org } = await withTimeout(
            supabase
              .from('organizations')
              .select('id, name, tier, status, created_at, trial_ends_at')
              .eq('id', row.organization_id)
              .single(),
            4000,
            'organizations.select'
          )
          organization = org || null
        } catch (orgErr) {
          // Org lookup is non-blocking — render the rep tree without the org
          // header if we can't fetch it. Better than freezing the app.
          console.warn(orgErr.message)
        }
      }
      return { ...row, organization }
    }
  } catch (err) {
    // Timeout or RLS failure — fall through to metadata profile. We log so
    // the next "stuck loading" regression shows up in the console instead of
    // silently degrading.
    console.warn('[Auth] profile fetch failed, using metadata fallback:', err?.message || err)
  }
  return metaFallback()
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    let loadingResolved = false   // true once we've called setLoading(false)
    let initResolved   = false    // true once the listener has fired at all

    // Single chokepoint for clearing the loading screen — guarantees we
    // never set loading=false twice, and any path (listener, 2s fallback,
    // 8s absolute failsafe) can race to be the one that unsticks the UI.
    const resolveLoading = (profile) => {
      if (!mounted || loadingResolved) return
      loadingResolved = true
      if (profile !== undefined) setUser(profile)
      setLoading(false)
    }

    // Always-on handler: processes every auth event (INITIAL_SESSION, SIGNED_IN,
    // SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, etc.)
    //
    // IMPORTANT: do NOT await supabase queries directly inside this callback.
    // supabase-js holds a Web Lock while the listener runs, and any
    // supabase.auth.* call fired elsewhere during that window will deadlock
    // (classic symptom: "Save" or "Upload" buttons stuck spinning forever).
    // Defer the async work with setTimeout(0) so the lock is released before
    // buildProfile runs its DB queries.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return
        initResolved = true
        setTimeout(async () => {
          if (!mounted) return
          try {
            if (session?.user) {
              const profile = await buildProfile(session.user)
              if (!mounted) return
              setUser(profile)
              resolveLoading()
            } else {
              resolveLoading(null)
            }
          } catch (err) {
            // buildProfile already handles its own internal failures, but
            // belt-and-suspenders: any unexpected throw still resolves loading
            // so we never trap the user on the spinner.
            console.warn('[Auth] listener handler failed:', err?.message || err)
            resolveLoading(null)
          }
        }, 0)
      }
    )

    // Safety net #1: if INITIAL_SESSION never fires (Web Locks race on some
    // supabase-js versions), fall back to getSession() after 2s. Wrapped in
    // withTimeout so a hung getSession can't itself pin loading.
    const fallbackTimer = setTimeout(async () => {
      if (initResolved || !mounted) return
      try {
        const { data: { session } } = await withTimeout(
          supabase.auth.getSession(),
          3000,
          'getSession'
        )
        if (!mounted) return
        initResolved = true
        const profile = session?.user ? await buildProfile(session.user) : null
        if (!mounted) return
        resolveLoading(profile ?? null)
      } catch (err) {
        console.warn('[Auth] fallback getSession failed:', err?.message || err)
        if (mounted) resolveLoading(null)
      }
    }, 2000)

    // Safety net #2 (absolute failsafe): no matter what happened above —
    // listener fired but buildProfile hung, getSession hung, the JS event
    // loop got stuck behind a slow fetch — force the loading screen off
    // after 8s. The user can still re-auth from the login screen if their
    // session genuinely couldn't be restored. This is the fix for the
    // "stuck on loading, hard refresh works" bug: a hard refresh was the
    // only way out of a hung in-flight auth request.
    const absoluteFailsafe = setTimeout(() => {
      if (loadingResolved || !mounted) return
      console.warn('[Auth] forced loading resolution — auth init exceeded 8s')
      resolveLoading(null)
    }, 8000)

    return () => {
      mounted = false
      clearTimeout(fallbackTimer)
      clearTimeout(absoluteFailsafe)
      subscription.unsubscribe()
    }
  }, [])

  // refreshUser: re-reads the current session from local storage (no network
  // lock needed) then fetches the DB profile. Used after profile edits etc.
  const refreshUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { setUser(null); return null }
      const profile = await buildProfile(session.user)
      setUser(profile)
      return profile
    } catch {
      return null
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, refreshUser, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
