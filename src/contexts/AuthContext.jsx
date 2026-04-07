import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, getCurrentUser } from '../lib/supabase.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)   // full profile from public.users
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check existing session on mount
    getCurrentUser().then((profile) => {
      setUser(profile)
      setLoading(false)
    }).catch(() => {
      setUser(null)
      setLoading(false)
    })

    // Listen for auth state changes (sign-in / sign-out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const profile = await getCurrentUser()
        setUser(profile)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const refreshUser = async () => {
    const profile = await getCurrentUser()
    setUser(profile)
    return profile
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
