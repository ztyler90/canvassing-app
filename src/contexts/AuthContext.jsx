import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const AuthContext = createContext(null)

// Build a user profile from a Supabase session user object + optional DB row.
// Phase 1: also attaches the user's organization row so the UI can show org
// name / tier / seats and drive super-admin gating.
async function buildProfile(sessionUser) {
  if (!sessionUser) return null
  const meta = sessionUser.user_metadata || {}
  try {
    const { data: row } = await supabase
      .from('users')
      .select('id, email, full_name, role, organization_id, is_super_admin, avatar_url')
      .eq('id', sessionUser.id)
      .single()
    if (row) {
      let organization = null
      if (row.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('id, name, tier, status, created_at, trial_ends_at')
          .eq('id', row.organization_id)
          .single()
        organization = org || null
      }
      return { ...row, organization }
    }
  } catch { /* fall through to metadata fallback */ }
  return {
    id: sessionUser.id,
    email: sessionUser.email,
    full_name: meta.full_name || sessionUser.email,
    role: meta.role || 'rep',
    organization_id: null,
    organization: null,
    is_super_admin: false,
    avatar_url: meta.avatar_url || null,
  }
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    let initResolved = false   // tracks whether the initial session check fired

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
          if (session?.user) {
            const profile = await buildProfile(session.user)
            if (mounted) { setUser(profile); setLoading(false) }
          } else {
            if (mounted) { setUser(null); setLoading(false) }
          }
        }, 0)
      }
    )

    // Safety net: if INITIAL_SESSION never fires (Web Locks race on some
    // supabase-js versions), fall back to getSession() after 2 s so the
    // loading spinner doesn't hang forever.  Does NOT run after sign-in —
    // only protects the cold-start case.
    const fallbackTimer = setTimeout(async () => {
      if (initResolved || !mounted) return
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!mounted || initResolved) return
        initResolved = true
        const profile = session?.user ? await buildProfile(session.user) : null
        if (mounted) { setUser(profile ?? null); setLoading(false) }
      } catch {
        if (mounted && !initResolved) { initResolved = true; setLoading(false) }
      }
    }, 2000)

    return () => {
      mounted = false
      clearTimeout(fallbackTimer)
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
