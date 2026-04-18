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

/**
 * Update the current rep's display name, email, and/or avatar_url.
 *
 * IMPORTANT: we deliberately use getSession() (not getUser()) and we do the
 * public.users row update BEFORE calling auth.updateUser(). Reason: calling
 * auth.updateUser() fires an onAuthStateChange event that acquires the
 * Supabase Web Lock, and if the listener (or anything running inside it)
 * awaits another supabase.auth.* call, the whole chain deadlocks and the
 * save button gets stuck on "Saving…". Running the DB mirror first, then
 * the auth update last, keeps everything lock-safe.
 */
export async function updateUserProfile({ fullName, email, avatarUrl } = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return { error: new Error('No active session') }

    // 1. Mirror to public.users FIRST so the Rep dashboard reflects it even
    //    if the auth update is slow or the user closes the page.
    const row = {}
    if (fullName)                row.full_name  = fullName
    if (avatarUrl !== undefined) row.avatar_url = avatarUrl
    if (Object.keys(row).length > 0) {
      const { error: dbError } = await supabase
        .from('users').update(row).eq('id', user.id)
      if (dbError) return { error: dbError }
    }

    // 2. Auth update (metadata + email). Run last so the trailing
    //    onAuthStateChange event doesn't block earlier DB work.
    const authUpdates = {}
    if (email) authUpdates.email = email
    if (fullName || avatarUrl !== undefined) {
      authUpdates.data = {}
      if (fullName)                authUpdates.data.full_name  = fullName
      if (avatarUrl !== undefined) authUpdates.data.avatar_url = avatarUrl
    }
    if (Object.keys(authUpdates).length > 0) {
      const { error: authError } = await supabase.auth.updateUser(authUpdates)
      if (authError) return { error: authError }
    }

    return { error: null }
  } catch (err) {
    return { error: err }
  }
}

/**
 * Upload a profile picture for the current user to the "avatars" bucket,
 * return its public URL (null on failure). Uses getSession() (local-storage
 * read, no network, no lock) instead of getUser() to avoid the Web Locks
 * deadlock that hangs the upload spinner forever.
 */
export async function uploadAvatar(file) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return null
    const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${user.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, file, { cacheControl: '3600', upsert: true })
    if (error) {
      console.warn('[Storage] Avatar upload failed:', error.message)
      return null
    }
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(path)
    return publicUrl
  } catch (err) {
    console.warn('[Storage] Avatar upload threw:', err)
    return null
  }
}

/** Send a password-reset email to the given address */
export async function sendPasswordReset(email) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`,
  })
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
  // Phase 1: tenant scoping is handled by RLS — selecting users with role='rep'
  // automatically filters to the caller's organization. No more manager_id.
  const { data } = await supabase
    .from('users')
    .select('id, full_name, email, role, organization_id, commission_config')
    .eq('role', 'rep')
    .order('full_name')
  return data || []
}

/** Get the rep's own commission_config (null if not set by manager yet) */
export async function getMyCommissionConfig() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('users')
    .select('commission_config')
    .eq('id', user.id)
    .single()
  return data?.commission_config || null
}

/**
 * Save a rep's commission_config. Must be called by a manager in the same org
 * (enforced by the "Managers update reps in their org" RLS policy added in the
 * 20260418_commission migration).
 */
export async function updateRepCommissionConfig(repId, config) {
  const { data, error } = await supabase
    .from('users')
    .update({ commission_config: config })
    .eq('id', repId)
    .select('id, commission_config')
    .single()
  return { data, error }
}

// ── Organization helpers (Phase 1) ────────────────────────────────────────────

/**
 * Provision a brand-new organization for the just-signed-up user.
 * Wraps the `provision_new_organization(business_name)` SECURITY DEFINER RPC
 * which (1) inserts the org row with status='trial' + 30-day trial window,
 * and (2) stamps the caller's public.users row with the new org id + role='manager'.
 * Idempotent: if the caller already has an org, returns the existing id.
 */
export async function provisionNewOrganization(businessName) {
  const { data, error } = await supabase.rpc('provision_new_organization', {
    business_name: businessName,
  })
  return { data, error }
}

/** Get the current user's organization row (RLS-filtered to their own org) */
export async function getMyOrganization() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: row } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!row?.organization_id) return null
  const { data: org } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', row.organization_id)
    .single()
  return org
}

/**
 * List every organization in the system. Only super-admins see more than one
 * row — RLS filters non-super-admins to their own org.
 */
export async function getAllOrganizations() {
  const { data } = await supabase
    .from('organizations')
    .select('id, name, tier, status, created_at')
    .order('created_at', { ascending: false })
  return data || []
}

/** Fetch the billing view (monthly revenue per tenant). Super-admin-only use. */
export async function getOrganizationBilling() {
  const { data } = await supabase
    .from('organization_billing')
    .select('*')
  return data || []
}

/** Change an org's tier. Super-admin only — RLS enforces that. */
export async function updateOrganizationTier(orgId, tier) {
  const { data, error } = await supabase
    .from('organizations')
    .update({ tier })
    .eq('id', orgId)
    .select()
    .single()
  return { data, error }
}

/** Update the org name (owners or super-admins). */
export async function updateOrganizationName(orgId, name) {
  const { data, error } = await supabase
    .from('organizations')
    .update({ name })
    .eq('id', orgId)
    .select()
    .single()
  return { data, error }
}

/**
 * Update the org's daily goal configuration. Called from manager Settings.
 *  type         : 'revenue' | 'count'
 *  value        : numeric target (dollars if revenue, count if count)
 *  countLabel   : 'estimates' | 'appointments' — verbiage shown to reps
 *
 * RLS: only the org owner or a super-admin can update this row.
 */
export async function updateOrganizationGoal(orgId, { type, value, countLabel }) {
  const patch = {}
  if (type       !== undefined) patch.daily_goal_type  = type
  if (value      !== undefined) patch.daily_goal_value = value
  if (countLabel !== undefined) patch.count_goal_label = countLabel
  const { data, error } = await supabase
    .from('organizations')
    .update(patch)
    .eq('id', orgId)
    .select()
    .single()
  return { data, error }
}

/** Count users in each org — for the super-admin dashboard. */
export async function getOrganizationMemberCounts() {
  const { data } = await supabase
    .from('users')
    .select('organization_id')
  const counts = {}
  for (const u of data || []) {
    if (!u.organization_id) continue
    counts[u.organization_id] = (counts[u.organization_id] || 0) + 1
  }
  return counts
}

/**
 * Thin wrapper around fetch() for our manage-team edge function. Using fetch
 * directly (instead of supabase.functions.invoke) lets us read the real JSON
 * error body on non-2xx responses — invoke() just surfaces "non-2xx status
 * code" and swallows the specific reason.
 */
async function callManageTeam(body) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return { error: new Error('Not signed in') }

    const url = `${supabaseUrl}/functions/v1/manage-team`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey':        supabaseKey,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    })

    let payload = null
    try { payload = await res.json() } catch { /* not JSON */ }

    if (!res.ok) {
      // Different sources use different field names:
      //   our function          → { error: "..."    }
      //   Supabase gateway 401  → { code, message }
      //   Postgres errors       → { message, hint  }
      const msg =
        payload?.error ||
        payload?.message ||
        payload?.msg ||
        `Request failed (${res.status})`
      return { error: new Error(msg) }
    }
    if (payload?.error) return { error: new Error(payload.error) }
    return { data: payload, error: null }
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) }
  }
}

/**
 * Create a new rep under this manager.
 * Calls the manage-team Edge Function (service role required).
 */
export async function createRep({ fullName, email, password }) {
  const { data, error } = await callManageTeam({
    action: 'create', fullName, email, password,
  })
  if (error) return { error }
  return { user: data?.user, error: null }
}

/**
 * Delete a rep account (manager only).
 * Calls the manage-team Edge Function.
 */
export async function deleteRep(repId) {
  const { error } = await callManageTeam({ action: 'delete', repId })
  return { error: error || null }
}

// ── Territory helpers ─────────────────────────────────────────────────────────

export async function getTerritories() {
  const { data } = await supabase
    .from('territories')
    .select(`*, territory_assignments ( id, rep_id, users ( id, full_name, email ) )`)
    .order('created_at', { ascending: true })
  return data || []
}

export async function createTerritory({ name, color, polygon, createdBy }) {
  const { data, error } = await supabase
    .from('territories')
    .insert({ name, color, polygon, created_by: createdBy })
    .select()
    .single()
  return { data, error }
}

export async function updateTerritory(id, updates) {
  const { data, error } = await supabase
    .from('territories')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  return { data, error }
}

export async function deleteTerritory(id) {
  return supabase.from('territories').delete().eq('id', id)
}

/** Replace all rep assignments for a territory. Pass repIds=[] to clear. */
export async function setTerritoryAssignments(territoryId, repIds, assignedBy) {
  await supabase.from('territory_assignments').delete().eq('territory_id', territoryId)
  if (!repIds.length) return
  return supabase.from('territory_assignments').insert(
    repIds.map((repId) => ({ territory_id: territoryId, rep_id: repId, assigned_by: assignedBy }))
  )
}

/** Get territories assigned to a specific rep */
export async function getRepTerritories(repId) {
  const { data } = await supabase
    .from('territory_assignments')
    .select(`territories ( * )`)
    .eq('rep_id', repId)
  return (data || []).map((row) => row.territories).filter(Boolean)
}

/** All interactions ever (no date filter) for territory door-history overlay */
export async function getAllDoorHistory() {
  const { data } = await supabase
    .from('interactions')
    .select('id, lat, lng, outcome, address, created_at, rep_id, users ( full_name )')
    .not('lat', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000)
  return data || []
}

// ── Do Not Knock helpers ──────────────────────────────────────────────────────

export async function getDoNotKnockList() {
  const { data } = await supabase
    .from('do_not_knock')
    .select('*')
    .order('added_at', { ascending: false })
  return data || []
}

export async function addDoNotKnock({ address, lat, lng, reason, addedBy }) {
  const { data, error } = await supabase
    .from('do_not_knock')
    .insert({ address, lat, lng, reason, added_by: addedBy })
    .select()
    .single()
  return { data, error }
}

export async function removeDoNotKnock(id) {
  return supabase.from('do_not_knock').delete().eq('id', id)
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

// ── Live visibility helpers ───────────────────────────────────────────────────

/** Upsert a rep's current GPS position (called every 30s during active session) */
export async function upsertRepLocation(repId, sessionId, lat, lng) {
  return supabase.from('rep_locations').upsert({
    rep_id:     repId,
    session_id: sessionId,
    lat,
    lng,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'rep_id' })
}

/** Remove a rep's location row when their session ends */
export async function clearRepLocation(repId) {
  return supabase.from('rep_locations').delete().eq('rep_id', repId)
}

/**
 * Get all reps with a location update in the last 5 minutes (active)
 * Returns: [{ rep_id, lat, lng, updated_at, session_id, user, session }]
 */
export async function getActiveRepLocations() {
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data: locations } = await supabase
    .from('rep_locations')
    .select('rep_id, lat, lng, updated_at, session_id')
    .gte('updated_at', since)

  if (!locations?.length) return []

  const repIds    = locations.map((l) => l.rep_id)
  const sessionIds = locations.map((l) => l.session_id).filter(Boolean)

  const [{ data: users }, { data: sessions }] = await Promise.all([
    supabase.from('users').select('id, full_name').in('id', repIds),
    sessionIds.length
      ? supabase
          .from('canvassing_sessions')
          .select('id, doors_knocked, conversations, bookings, revenue_booked, started_at')
          .in('id', sessionIds)
      : Promise.resolve({ data: [] }),
  ])

  const userMap    = Object.fromEntries((users    || []).map((u) => [u.id, u]))
  const sessionMap = Object.fromEntries((sessions || []).map((s) => [s.id, s]))

  return locations.map((l) => ({
    ...l,
    user:    userMap[l.rep_id]     || null,
    session: sessionMap[l.session_id] || null,
  }))
}

/**
 * Aggregate session stats by rep for a given period.
 * period: 'today' | 'week' | 'month'
 */
export async function getLeaderboardData(period = 'today') {
  const now  = new Date()
  let dateFrom
  if (period === 'today') {
    dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  } else if (period === 'week') {
    dateFrom = new Date(Date.now() - 7  * 86400000).toISOString()
  } else {
    dateFrom = new Date(Date.now() - 30 * 86400000).toISOString()
  }

  const { data } = await supabase
    .from('canvassing_sessions')
    .select('rep_id, doors_knocked, conversations, estimates, bookings, revenue_booked, users(full_name)')
    .gte('started_at', dateFrom)

  const repMap = {}
  for (const s of data || []) {
    if (!repMap[s.rep_id]) {
      repMap[s.rep_id] = {
        id:            s.rep_id,
        name:          s.users?.full_name || 'Unknown',
        doors:         0,
        conversations: 0,
        estimates:     0,
        bookings:      0,
        revenue:       0,
      }
    }
    const r = repMap[s.rep_id]
    r.doors         += s.doors_knocked  || 0
    r.conversations += s.conversations  || 0
    r.estimates     += s.estimates      || 0
    r.bookings      += s.bookings       || 0
    r.revenue       += s.revenue_booked || 0
  }

  return Object.values(repMap)
}

// ── Session Detail + Editing ──────────────────────────────────────────────────

/** Get a single session with all its interactions */
export async function getSessionWithInteractions(sessionId) {
  const [{ data: session }, { data: interactions }] = await Promise.all([
    supabase
      .from('canvassing_sessions')
      .select('*, users(full_name, email)')
      .eq('id', sessionId)
      .single(),
    supabase
      .from('interactions')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
  ])
  return { session, interactions: interactions || [] }
}

/** Update fields on a single interaction (outcome, address, notes, revenue) */
export async function updateInteraction(interactionId, updates) {
  const { data, error } = await supabase
    .from('interactions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', interactionId)
    .select()
    .single()
  return { data, error }
}

/** Update editable fields on a session */
export async function updateSession(sessionId, updates) {
  const { data, error } = await supabase
    .from('canvassing_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select()
    .single()
  return { data, error }
}

// ── Webhook / CRM Integration ─────────────────────────────────────────────────

/** Save a Zapier webhook URL to the current user's auth metadata */
export async function saveWebhookUrl(url) {
  const { data, error } = await supabase.auth.updateUser({
    data: { zapier_webhook_url: url || null }
  })
  return { data, error }
}

/** Read the Zapier webhook URL from the current user's auth metadata */
export async function getWebhookUrl() {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.user_metadata?.zapier_webhook_url || null
}

// ── Photo helpers ─────────────────────────────────────────────────────────────

/**
 * Upload a photo file for an interaction to Supabase Storage.
 * Requires a public bucket named "interaction-photos" (see migration notes).
 * Returns the public URL, or null on failure.
 */
export async function uploadInteractionPhoto(interactionId, file) {
  const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${interactionId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage
    .from('interaction-photos')
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) {
    console.warn('[Storage] Photo upload failed:', error.message)
    return null
  }
  const { data: { publicUrl } } = supabase.storage
    .from('interaction-photos')
    .getPublicUrl(path)
  return publicUrl
}

/** Persist photo_urls array back to the interaction record */
export async function updateInteractionPhotos(interactionId, photoUrls) {
  return supabase
    .from('interactions')
    .update({ photo_urls: photoUrls })
    .eq('id', interactionId)
}

// ── Follow-up helpers ─────────────────────────────────────────────────────────

/** Mark an interaction as flagged for follow-up */
export async function flagInteractionFollowUp(interactionId, notes = null) {
  const updates = { follow_up: true }
  if (notes) updates.follow_up_notes = notes
  return supabase.from('interactions').update(updates).eq('id', interactionId)
}

// ── Booking query helpers ─────────────────────────────────────────────────────

/**
 * Get all bookings for the manager view.
 *
 * Source of truth is `interactions` (outcome='booked') — every booking comes in
 * through the rep's interaction modal and already carries address, contact
 * info, photos, follow-up flag, estimated value, and organization_id. The
 * separate `bookings` pipeline table (for future CRM status tracking) is not
 * queried here because it's optional and historically under-populated — reading
 * straight from interactions guarantees the tab always shows every booked job.
 *
 * Returns rows shaped to match the existing BookingsTab contract: photo_urls
 * and follow_up live under a nested `interactions` object so the view layer
 * doesn't need to change.
 */
export async function getAllBookings(filters = {}) {
  let query = supabase
    .from('interactions')
    .select('*, users(full_name)')
    .eq('outcome', 'booked')
    .order('created_at', { ascending: false })
    .limit(100)

  if (filters.repId)    query = query.eq('rep_id', filters.repId)
  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters.dateTo)   query = query.lte('created_at', filters.dateTo)

  const { data } = await query
  return (data || []).map((row) => ({
    ...row,
    // Nest the photo / follow-up fields under `interactions` so the BookingsTab
    // UI (which used to read from a joined bookings→interactions row) still works.
    interactions: {
      photo_urls:      row.photo_urls,
      follow_up:       row.follow_up,
      follow_up_notes: row.follow_up_notes,
      notes:           row.notes,
    },
  }))
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fire a Zapier (or generic) webhook with the given payload.
 * Returns true on success, false on failure.
 */
export async function fireZapierWebhook(webhookUrl, payload) {
  if (!webhookUrl) return false
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'no-cors', // Zapier webhooks don't need CORS
    })
    return true
  } catch (err) {
    console.warn('[Webhook] Failed to fire:', err)
    return false
  }
}
