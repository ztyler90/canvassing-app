import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  return { data, error }
}

export async function signUpWithEmail(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  return { data, error }
}

export async function signOut() {
  return supabase.auth.signOut()
}

export async function getCurrentUser() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // Try to get full profile from DB
    const { data, error } = await supabase.from('users').select('*').eq('id', user.id).single()

    // If DB query succeeded and returned a row, use it
    if (data) return data

    // Fallback: build profile from auth metadata (handles RLS issues or missing row)
    const meta = user.user_metadata || {}
    return {
      id: user.id,
      email: user.email,
      full_name: meta.full_name || user.email,
      role: meta.role || 'rep',
    }
  } catch {
    return null
  }
}

// ── Session helpers ───────────────────────────────────────────────────────────

export async function startSession(repId) {
  const { data, error } = await supabase
    .from('canvassing_sessions')
    .insert({ rep_id: repId, status: 'active' })
    .select()
    .single()
  return { data, error }
}

export async function endSession(sessionId, summary) {
  const { data, error } = await supabase
    .from('canvassing_sessions')
    .update({ ended_at: new Date().toISOString(), status: 'submitted', ...summary })
    .eq('id', sessionId)
    .select()
    .single()
  return { data, error }
}

export async function updateSessionStats(sessionId, stats) {
  return supabase.from('canvassing_sessions').update(stats).eq('id', sessionId)
}

export async function getActiveSession(repId) {
  const { data } = await supabase
    .from('canvassing_sessions')
    .select('*')
    .eq('rep_id', repId)
    .eq('status', 'active')
    .single()
  return data
}

// ── GPS helpers ───────────────────────────────────────────────────────────────

export async function insertGpsPoints(points) {
  return supabase.from('gps_points').insert(points)
}

export async function getSessionGpsTrail(sessionId) {
  const { data } = await supabase
    .from('gps_points')
    .select('lat, lng, recorded_at')
    .eq('session_id', sessionId)
    .order('recorded_at', { ascending: true })
  return data || []
}

// ── Interaction helpers ───────────────────────────────────────────────────────

export async function logInteraction(interaction) {
  const { data, error } = await supabase
    .from('interactions')
    .insert(interaction)
    .select()
    .single()
  return { data, error }
}

export async function getSessionInteractions(sessionId) {
  const { data } = await supabase
    .from('interactions')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  return data || []
}

export async function wasAddressRecentlyVisited(address, repId, withinHours = 24) {
  const since = new Date(Date.now() - withinHours * 3600 * 1000).toISOString()
  const { count } = await supabase
    .from('interactions')
    .select('id', { count: 'exact' })
    .eq('rep_id', repId)
    .eq('address', address)
    .gte('created_at', since)
  return count > 0
}

// ── Booking helpers ───────────────────────────────────────────────────────────

export async function createBooking(booking) {
  return supabase.from('bookings').insert(booking)
}

// ── Dashboard helpers ─────────────────────────────────────────────────────────

export async function getRepSessions(repId, limit = 30) {
  const { data } = await supabase
    .from('canvassing_sessions')
    .select('*')
    .eq('rep_id', repId)
    .eq('status', 'submitted')
    .order('started_at', { ascending: false })
    .limit(limit)
  return data || []
}

export async function getAllSessions(filters = {}) {
  let query = supabase
    .from('canvassing_sessions')
    .select(`*, users(full_name, email)`)
    .eq('status', 'submitted')
    .order('started_at', { ascending: false })

  if (filters.repId)    query = query.eq('rep_id', filters.repId)
  if (filters.dateFrom) query = query.gte('started_at', filters.dateFrom)
  if (filters.dateTo)   query = query.lte('started_at', filters.dateTo)

  const { data } = await query
  return data || []
}

export async function getAllReps() {
  const { data } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('role', 'rep')
    .order('full_name')
  return data || []
}

export async function getManagerMapData(filters = {}) {
  let query = supabase
    .from('interactions')
    .select(`*, canvassing_sessions(neighborhood), users(full_name)`)
    .order('created_at', { ascending: false })

  if (filters.repId)    query = query.eq('rep_id', filters.repId)
  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters.dateTo)   query = query.lte('created_at', filters.dateTo)

  const { data } = await query
  return data || []
}
