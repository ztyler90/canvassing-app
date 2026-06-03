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

/**
 * Sign the current user out.
 *
 * Two failure modes used to make this button "do nothing":
 *   1. Default scope is 'global', which makes a network call to revoke the
 *      refresh token. Offline or on a flaky network, that call hangs
 *      forever — the local session is never cleared, onAuthStateChange
 *      never fires SIGNED_OUT, and the UI stays put.
 *   2. supabase-js holds a Web Lock around auth operations (same lock
 *      that wedged Save/Upload — see updateUserProfile docs). If a token
 *      refresh or a queued onAuthStateChange handler is mid-flight,
 *      signOut blocks waiting for the lock and the click looks dead.
 *
 * Fix: scope:'local' so we tear down the local session immediately with
 * no network round-trip, swallow any error (we don't want the click to
 * throw uncaught into React), and hard-redirect the page as a belt-and-
 * suspenders fallback in case onAuthStateChange doesn't re-render us out.
 * The hard redirect is gated on `window` so SSR-style callers don't crash.
 *
 * Accepts no args on purpose — callers used to wire this directly to an
 * onClick, which passed a React SyntheticEvent in as the first argument.
 * That's harmless today but we keep the signature explicit so a future
 * supabase-js that interprets the first arg as options can't surprise us.
 */
export async function signOut() {
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch (err) {
    console.warn('[Auth] signOut failed (continuing):', err?.message || err)
  }
  if (typeof window !== 'undefined') {
    // Use replace() so the back button can't bounce the user back into
    // an authenticated route after they've signed out.
    window.location.replace('/login')
  }
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
 * Upload a profile picture for the current user to the (now-private)
 * "avatars" bucket and return the storage **path** (e.g. "<user-id>/123.jpg")
 * to persist in users.avatar_url. Display sites resolve paths to signed
 * URLs via lib/photos.js → usePhotoUrl(value, 'avatars').
 *
 * Returns null on failure. Uses getSession() (local-storage read, no
 * network, no lock) instead of getUser() to avoid the Web Locks deadlock
 * that hangs the upload spinner forever.
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
    // Return the storage path — the bucket is private, so a "public URL"
    // wouldn't work anyway. usePhotoUrl() mints signed URLs on demand.
    return path
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

/**
 * Fetch this rep's lat/lng/created_at trail for the last `days` days —
 * just what the coverage-heatmap needs to bucket into blocks. Small
 * columns list keeps the payload tiny (a busy rep hits ~400 interactions
 * over 30 days, so under 30 KB over the wire).
 *
 * Capped at 3000 rows defensively in case a rep logged an abnormal
 * number of doors — the heatmap rounds into ~30m cells, so the extra
 * rows don't buy fidelity, they just burn bandwidth.
 */
export async function getRepRecentInteractions(repId, days = 30) {
  if (!repId) return []
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
  const { data } = await supabase
    .from('interactions')
    .select('lat, lng, created_at')
    .eq('rep_id', repId)
    .gte('created_at', since)
    .not('lat', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3000)
  return data || []
}

/**
 * Org-wide coverage — returns lat/lng/created_at for every interaction
 * logged by ANY rep in the caller's organization in the last `days` days.
 * Powers the team-coverage heatmap so reps can see where their colleagues
 * have recently been (and avoid re-knocking a block a teammate just hit).
 *
 * Payload stays lean: only the three columns the heatmap needs, so an
 * org with 20 reps logging ~50 doors/day stays under ~400 KB even at the
 * 30-day window. Cap is 10,000 rows for the same reason the single-rep
 * query is capped at 3,000 — the heatmap rounds into ~30m cells and more
 * rows don't add fidelity.
 *
 * Depends on an RLS policy that lets any authenticated user in an org
 * read `interactions` rows whose rep sits in the same `organization_id`
 * (see `supabase/migrations/2026_team_coverage_rls.sql`).
 */
export async function getOrgRecentInteractions(days = 30) {
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
  // `interactions.organization_id` is denormalized from `users.organization_id`
  // at insert time (and enforced consistent by the `tenant_isolation`
  // RESTRICTIVE policy on the table), so we can filter the column directly
  // instead of joining through users. Row-level access is still gated by
  // RLS: the tenant policy requires org match, and the
  // "Reps can read same-org interactions" permissive policy unlocks
  // teammate rows for SELECT.
  const { data, error } = await supabase
    .from('interactions')
    .select('lat, lng, created_at')
    .eq('organization_id', orgId)
    .gte('created_at', since)
    .not('lat', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10000)
  if (error) {
    console.warn('[Coverage] org fetch failed', error.message)
    return []
  }
  return data || []
}

/**
 * Fetch this rep's outcome distribution by hour of day across the last
 * `days` days. Used by the "best time of day" nudge on RepHome. We only
 * need the minimal cols to bucket — created_at for the hour and outcome
 * for the conversion numerator.
 *
 * Capped at 5000 rows so a prolific rep's analysis still finishes
 * quickly; hour buckets stabilize well before that sample size.
 */
export async function getRepOutcomesForHour(repId, days = 60) {
  if (!repId) return []
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
  const { data } = await supabase
    .from('interactions')
    .select('created_at, outcome')
    .eq('rep_id', repId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000)
  return data || []
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
  // Explicit org scope so super-admin managers see only their own org here.
  const orgId = await getMyOrgId()
  if (!orgId) return []
  let query = supabase
    .from('canvassing_sessions')
    .select(`*, users(full_name, email)`)
    .eq('status', 'submitted')
    .eq('organization_id', orgId)
    .order('started_at', { ascending: false })

  if (filters.repId)    query = query.eq('rep_id', filters.repId)
  if (filters.dateFrom) query = query.gte('started_at', filters.dateFrom)
  if (filters.dateTo)   query = query.lte('started_at', filters.dateTo)

  const { data } = await query
  return data || []
}

/**
 * Look up the caller's own organization_id from public.users.
 * Used to scope manager-facing queries explicitly, so super-admins (whose
 * RLS policies return ALL rows via `auth_is_super_admin()`) still only see
 * their own org in manager views like Settings / Rep Dashboard.
 */
async function getMyOrgId() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: row } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  return row?.organization_id || null
}

export async function getAllReps() {
  // Explicitly scope to the caller's own org. RLS would also filter here,
  // but super-admins bypass tenant RLS — without this filter, super-admin
  // managers would see every rep across every org on the Settings page.
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const { data } = await supabase
    .from('users')
    .select('id, full_name, email, role, organization_id, commission_config')
    .eq('role', 'rep')
    .eq('organization_id', orgId)
    .order('full_name')
  return data || []
}

/**
 * Fetch a single rep's profile + commission config. Used by the manager
 * Rep Detail screen to render an individual rep's home-page metrics.
 * Explicitly scoped to the caller's org so super-admins don't accidentally
 * drill into a rep in another org from a manager-context link.
 */
export async function getRepById(repId) {
  const orgId = await getMyOrgId()
  if (!orgId) return null
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, avatar_url, commission_config, organization_id')
    .eq('id', repId)
    .eq('organization_id', orgId)
    .single()
  if (error) return null
  return data
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
 * 20260418_commission migration). Also scoped explicitly here so super-admin
 * managers can't accidentally edit a rep in another org.
 */
export async function updateRepCommissionConfig(repId, config) {
  const orgId = await getMyOrgId()
  if (!orgId) return { data: null, error: new Error('No organization') }
  const { data, error } = await supabase
    .from('users')
    .update({ commission_config: config })
    .eq('id', repId)
    .eq('organization_id', orgId)
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

/**
 * Update the org's pipeline configuration — sales cycle, lead routing,
 * hot-lead stale window, and quote follow-up SLA. Called from manager
 * Pipeline Settings.
 *
 *   salesCycle       : 'appointment_based' | 'quick_quote' | 'mixed'
 *   leadRoutingMode  : 'setter_picks' | 'round_robin' | 'manager_assigns'
 *                    | 'territory_based'
 *   quoteFollowupHrs : integer 1–240
 *   hotLeadStaleDays : integer 1–90
 *
 * Any subset of fields may be passed; only those provided are patched.
 * RLS: only org owners/managers can update — enforced at the DB level.
 */
export async function updateOrganizationPipelineConfig(orgId, {
  salesCycle, leadRoutingMode, quoteFollowupHrs, hotLeadStaleDays,
} = {}) {
  const patch = {}
  if (salesCycle       !== undefined) patch.sales_cycle          = salesCycle
  if (leadRoutingMode  !== undefined) patch.lead_routing_mode    = leadRoutingMode
  if (quoteFollowupHrs !== undefined) patch.quote_followup_hours = quoteFollowupHrs
  if (hotLeadStaleDays !== undefined) patch.hot_lead_stale_days  = hotLeadStaleDays
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
 * Platform-wide engagement + activity insights, keyed by organization_id.
 * Super-admin use only — assumes the RLS policies added in
 * `20260418_super_admin_insights.sql` are in place (they grant super-admins
 * cross-org read on users + canvassing_sessions).
 *
 * Returns an object: { [org_id]: { last_activity_at, active_reps_7d,
 *   total_reps, doors_7d, conversations_7d, estimates_7d, bookings_7d,
 *   revenue_7d, sessions_7d, doors_prev_7d, revenue_prev_7d,
 *   doors_trend_pct, revenue_trend_pct, health } }.
 *
 * `health` is a string: 'healthy' | 'at-risk' | 'churning' derived from
 * last_activity_at + trends. Used for the inline status chip on each org card.
 */
export async function getOrganizationInsightsSummary() {
  const now     = Date.now()
  const since7  = new Date(now -  7 * 86400000).toISOString()
  const since14 = new Date(now - 14 * 86400000).toISOString()

  // Map every user to their organization_id (and count total reps per org).
  const { data: allUsers } = await supabase
    .from('users')
    .select('id, organization_id, role')
  const repToOrg  = {}
  const totalReps = {}
  for (const u of allUsers || []) {
    if (!u.organization_id) continue
    repToOrg[u.id] = u.organization_id
    if (u.role === 'rep' || u.role === 'manager') {
      totalReps[u.organization_id] = (totalReps[u.organization_id] || 0) + 1
    }
  }

  // Pull 14 days of sessions so we can compute week-over-week trends.
  const { data: sessions } = await supabase
    .from('canvassing_sessions')
    .select('rep_id, started_at, doors_knocked, conversations, estimates, bookings, revenue_booked, status')
    .gte('started_at', since14)

  const blank = (orgId) => ({
    org_id: orgId,
    last_activity_at: null,
    active_reps_7d: new Set(),
    total_reps: totalReps[orgId] || 0,
    doors_7d: 0, conversations_7d: 0, estimates_7d: 0,
    bookings_7d: 0, revenue_7d: 0, sessions_7d: 0,
    doors_prev_7d: 0, revenue_prev_7d: 0,
  })

  const byOrg = {}
  for (const s of sessions || []) {
    const orgId = repToOrg[s.rep_id]
    if (!orgId) continue
    if (!byOrg[orgId]) byOrg[orgId] = blank(orgId)
    const stats = byOrg[orgId]

    if (!stats.last_activity_at || s.started_at > stats.last_activity_at) {
      stats.last_activity_at = s.started_at
    }

    if (s.started_at >= since7) {
      stats.active_reps_7d.add(s.rep_id)
      stats.doors_7d         += s.doors_knocked  || 0
      stats.conversations_7d += s.conversations  || 0
      stats.estimates_7d     += s.estimates      || 0
      stats.bookings_7d      += s.bookings       || 0
      stats.revenue_7d       += Number(s.revenue_booked) || 0
      stats.sessions_7d      += 1
    } else {
      stats.doors_prev_7d    += s.doors_knocked   || 0
      stats.revenue_prev_7d  += Number(s.revenue_booked) || 0
    }
  }

  // Make sure every known org shows up even if it had zero sessions this period.
  for (const orgId of Object.values(repToOrg)) {
    if (!byOrg[orgId]) byOrg[orgId] = blank(orgId)
  }

  const pctChange = (curr, prev) => {
    if (!prev) return curr > 0 ? 100 : 0
    return Math.round(((curr - prev) / prev) * 100)
  }
  const hoursSince = (iso) => iso ? (now - new Date(iso).getTime()) / 3600000 : Infinity

  const result = {}
  for (const [orgId, s] of Object.entries(byOrg)) {
    const doorsTrend   = pctChange(s.doors_7d,   s.doors_prev_7d)
    const revenueTrend = pctChange(s.revenue_7d, s.revenue_prev_7d)
    const hoursStale   = hoursSince(s.last_activity_at)

    let health = 'healthy'
    if (hoursStale > 7 * 24 || (s.active_reps_7d.size === 0 && s.total_reps > 0)) {
      health = 'churning'
    } else if (hoursStale > 3 * 24 || doorsTrend < -20 || revenueTrend < -20) {
      health = 'at-risk'
    }

    result[orgId] = {
      ...s,
      active_reps_7d: s.active_reps_7d.size,
      doors_trend_pct: doorsTrend,
      revenue_trend_pct: revenueTrend,
      health,
    }
  }
  return result
}

/**
 * Platform-wide metrics for the super-admin dashboard.
 *
 * Returns {
 *   totalReps, currentMrr, projectedArr, churnPct,
 *   mrrByDay: [{date, mrr}, ...]   (90 daily points, oldest → newest),
 *   growth: { daily, weekly, monthly, annual }  (% change in MRR),
 * }.
 *
 * Historical MRR is reconstructed client-side from:
 *   - organizations.created_at     (when the org joined the platform)
 *   - organization_tier_history    (tier changes over time)
 *   - users.created_at             (approximated seat-count-over-time)
 * Orgs currently flagged `cancelled`/`churned`/`paused`/`inactive` are
 * excluded from past MRR too — we don't have a cancellation date, so this
 * errs on the side of not inflating the trend. Good enough for a KPI strip.
 */
export async function getPlatformMetrics() {
  const SEAT_PRICE = { standard: 20, pro: 50 }
  const DEAD_STATUSES = new Set(['cancelled', 'churned', 'paused', 'inactive'])
  const now = Date.now()

  const [
    { data: orgs },
    { data: tierHistory },
    { data: users },
  ] = await Promise.all([
    supabase.from('organizations').select('id, tier, status, created_at'),
    supabase.from('organization_tier_history').select('organization_id, old_tier, new_tier, changed_at'),
    supabase.from('users').select('id, organization_id, role, created_at'),
  ])

  // ── Rep roster by org, with sorted join timestamps for fast seat-at-time ──
  const reps = (users || []).filter(u =>
    u.organization_id && (u.role === 'rep' || u.role === 'manager'))
  const totalReps = reps.length

  const repJoinsByOrg = {}
  for (const u of reps) {
    const t = new Date(u.created_at).getTime()
    if (!repJoinsByOrg[u.organization_id]) repJoinsByOrg[u.organization_id] = []
    repJoinsByOrg[u.organization_id].push(t)
  }
  for (const list of Object.values(repJoinsByOrg)) list.sort((a, b) => a - b)

  // ── Tier-history events by org, oldest-first ─────────────────────────────
  const historyByOrg = {}
  for (const h of tierHistory || []) {
    if (!historyByOrg[h.organization_id]) historyByOrg[h.organization_id] = []
    historyByOrg[h.organization_id].push({
      ...h,
      _ts: new Date(h.changed_at).getTime(),
    })
  }
  for (const list of Object.values(historyByOrg)) list.sort((a, b) => a._ts - b._ts)

  const seatsAt = (orgId, t) => {
    const list = repJoinsByOrg[orgId] || []
    let n = 0
    for (const j of list) {
      if (j <= t) n++
      else break
    }
    return n
  }

  const tierAt = (org, t) => {
    const list = historyByOrg[org.id] || []
    // Seed with the earliest-known prior tier, else current.
    let tier = list.length ? list[0].old_tier : org.tier
    for (const h of list) {
      if (h._ts <= t) tier = h.new_tier
      else break
    }
    return tier
  }

  const mrrAt = (t) => {
    let sum = 0
    for (const org of orgs || []) {
      if (DEAD_STATUSES.has(org.status)) continue
      const createdAt = new Date(org.created_at).getTime()
      if (createdAt > t) continue
      const tier  = tierAt(org, t)
      const seats = seatsAt(org.id, t)
      sum += seats * (SEAT_PRICE[tier] || 0)
    }
    return sum
  }

  // ── 90-day MRR series ────────────────────────────────────────────────────
  const mrrByDay = []
  for (let i = 89; i >= 0; i--) {
    const t = now - i * 86400000
    mrrByDay.push({
      date: new Date(t).toISOString().slice(0, 10),
      mrr: mrrAt(t),
    })
  }

  const currentMrr   = mrrAt(now)
  const projectedArr = currentMrr * 12

  // ── Growth deltas ────────────────────────────────────────────────────────
  const pct = (curr, prev) => !prev ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 100)
  const growth = {
    daily:   pct(currentMrr, mrrAt(now - 1   * 86400000)),
    weekly:  pct(currentMrr, mrrAt(now - 7   * 86400000)),
    monthly: pct(currentMrr, mrrAt(now - 30  * 86400000)),
    annual:  pct(currentMrr, mrrAt(now - 365 * 86400000)),
  }

  // ── Churn % — share of all-time orgs currently in a dead state ───────────
  const totalOrgs = (orgs || []).length
  const churned   = (orgs || []).filter(o => DEAD_STATUSES.has(o.status)).length
  const churnPct  = totalOrgs === 0 ? 0 : Math.round((churned / totalOrgs) * 100)

  return { totalReps, currentMrr, projectedArr, churnPct, mrrByDay, growth }
}

/**
 * Rich detail for a single organization — used by the OrganizationDetail
 * drill-in screen. Returns { org, users, sessions30d, recentInteractions,
 * billing }. Super-admin only.
 */
export async function getOrganizationDetail(orgId) {
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString()

  const [
    { data: org },
    { data: users },
    { data: billingRow },
  ] = await Promise.all([
    supabase.from('organizations').select('*').eq('id', orgId).single(),
    supabase
      .from('users')
      .select('id, full_name, email, role, avatar_url, created_at, commission_config')
      .eq('organization_id', orgId)
      .order('full_name', { ascending: true }),
    supabase.from('organization_billing').select('*').eq('id', orgId).maybeSingle(),
  ])

  const repIds = (users || []).map((u) => u.id)
  if (!repIds.length) {
    return { org, users: [], sessions: [], recentInteractions: [], billing: billingRow }
  }

  const [{ data: sessions }, { data: interactions }] = await Promise.all([
    supabase
      .from('canvassing_sessions')
      .select('id, rep_id, started_at, ended_at, doors_knocked, conversations, estimates, bookings, revenue_booked, status, neighborhood')
      .in('rep_id', repIds)
      .gte('started_at', since30)
      .order('started_at', { ascending: false }),
    supabase
      .from('interactions')
      .select('id, rep_id, outcome, address, estimated_value, created_at')
      .in('rep_id', repIds)
      .gte('created_at', since30)
      .order('created_at', { ascending: false })
      .limit(40),
  ])

  return {
    org,
    users: users || [],
    sessions: sessions || [],
    recentInteractions: interactions || [],
    billing: billingRow || null,
  }
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

// Voice-note transcription (transcribeVoiceNote / transcribe-voice edge fn /
// VoiceNoteButton component) was removed for legal reasons: BIPA voiceprint
// exposure in Illinois, all-party-consent recording risk in 12+ states, and
// the OpenAI Whisper sub-processor it required. If voice dictation is ever
// brought back, it must be post-doorstep only (no homeowner voice capture),
// re-evaluated against the privacy policy, and the OpenAI relationship must
// be on enterprise/zero-retention terms before any audio is transmitted.

/**
 * Create a new rep under this manager. Two onboarding modes:
 *
 *   mode: 'invite' (default)
 *     The edge function calls supabase.auth.admin.generateLink({
 *     type: 'invite' }) and emails the one-time link via Resend.
 *     Manager never sees credentials. Requires Resend to be configured.
 *
 *   mode: 'temp_password'
 *     Caller passes a `password`; the edge function creates the auth
 *     user with that password and stamps force_password_change=true on
 *     public.users so first login is intercepted by SetPassword.jsx.
 *     No email is sent — the manager delivers the credentials out of
 *     band (typically by texting the rep using `phone`).
 *
 * `phone` is optional and persisted on public.users for both modes.
 *
 * Returns { user, mode, emailSent, emailError, loginUrl } — the UI
 * uses `mode` to decide whether to show the credentials panel and
 * `loginUrl` to build a pre-filled SMS body.
 */
export async function createRep({ fullName, email, phone, mode = 'invite', password, role = 'rep' }) {
  const { data, error } = await callManageTeam({
    action: 'create', fullName, email, phone, mode, password, role,
  })
  if (error) return { error }
  return {
    user:       data?.user,
    mode:       data?.mode || mode,
    emailSent:  Boolean(data?.email_sent),
    emailError: data?.email_error || null,
    loginUrl:   data?.login_url || null,
    error:      null,
  }
}

/**
 * Convenience wrapper around createRep for closers. Same endpoint, same
 * shape — just hard-codes role='closer' so callers in the Closer section
 * of Settings don't accidentally invite a rep.
 */
export async function createCloser({ fullName, email, phone, mode = 'invite', password }) {
  return createRep({ fullName, email, phone, mode, password, role: 'closer' })
}

/**
 * List all closers in the caller's org. Mirrors getAllReps but filters to
 * role='closer'. Returns notification pref so the Closers settings page
 * can render each closer's chosen channel.
 */
export async function getAllClosers() {
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const { data } = await supabase
    .from('users')
    .select('id, full_name, email, role, organization_id, closer_notification_pref')
    .eq('role', 'closer')
    .eq('organization_id', orgId)
    .order('full_name')
  return data || []
}

/**
 * Update a closer's notification preference. Closers update their own
 * pref; managers may also update a closer's pref in their org. RLS
 * enforces this (users can update own row, managers can update users in
 * their org via the existing Managers-update-users policy).
 *
 *   pref : 'app' | 'email' | 'sms' | 'both'
 */
export async function updateCloserNotificationPref(userId, pref) {
  if (!['app', 'email', 'sms', 'both'].includes(pref)) {
    return { error: new Error(`Invalid notification pref: ${pref}`) }
  }
  const { data, error } = await supabase
    .from('users')
    .update({ closer_notification_pref: pref })
    .eq('id', userId)
    .select('id, closer_notification_pref')
    .single()
  return { data, error }
}

/**
 * Fetch the leads (interactions) currently assigned to the caller as a
 * closer. Used by the Closer Inbox screen. RLS allows closers to read
 * rows where closer_id = auth.uid() (policy added in 20260602 phase-1
 * migration). Returns the same shape Pipeline tab will use, so the two
 * screens can share rendering code later.
 */
export async function getMyAssignedLeads() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase
    .from('interactions')
    .select(`
      id, stage, address, contact_name, contact_phone, contact_email,
      service_types, estimated_value, notes, appointment_at,
      estimate_sent_at, hot_lead_started_at, lost_reason, lost_at,
      created_at, rep_id, closer_id,
      users:rep_id ( full_name )
    `)
    .eq('closer_id', user.id)
    .in('stage', ['hot_lead', 'appt_scheduled', 'estimate_sent', 'booked'])
    .order('appointment_at', { ascending: true, nullsFirst: false })
  return data || []
}

/**
 * Fire the notify-closer edge function for a freshly-assigned lead.
 * Called from the canvassing flow right after the insert succeeds.
 * Best-effort: failures are returned but never thrown — a missed
 * notification shouldn't roll back a lead the rep just captured.
 */
export async function notifyAssignedCloser(interactionId) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return { delivered: false, error: 'no session' }
    const url = `${supabaseUrl}/functions/v1/notify-closer`
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ interactionId }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { delivered: false, error: data?.error || `HTTP ${res.status}` }
    }
    return data
  } catch (err) {
    return { delivered: false, error: err?.message || String(err) }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CLOSER CONTACTS (Phase 5) — email-only closer tier.
// These contacts don't have an auth user / platform seat. They just
// receive the lead-assigned email notification.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * List every closer in the caller's org as one unified array, with a
 * `tier` discriminator on each row so the UI can render badges and the
 * routing dropdown can treat both kinds uniformly.
 *
 * Returned shape:
 *   { tier: 'platform' | 'contact',
 *     id, full_name, email, phone,
 *     notification_pref,    // only meaningful for platform users
 *     contact_pref }        // only meaningful for email-only contacts
 *
 * Promoted contacts (those that have been upgraded to platform users) are
 * filtered out — they live on as audit history but shouldn't appear in
 * the active closer list.
 */
export async function getAllClosersUnified() {
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const [platform, contacts] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, phone, closer_notification_pref')
      .eq('role', 'closer')
      .eq('organization_id', orgId)
      .order('full_name'),
    supabase
      .from('closer_contacts')
      .select('id, full_name, email, phone, notification_pref')
      .eq('organization_id', orgId)
      .is('promoted_to_user_id', null)
      .order('full_name'),
  ])
  const platformRows = (platform.data || []).map((u) => ({
    tier:              'platform',
    id:                u.id,
    full_name:         u.full_name,
    email:             u.email,
    phone:             u.phone,
    notification_pref: u.closer_notification_pref || 'email',
  }))
  const contactRows = (contacts.data || []).map((c) => ({
    tier:              'contact',
    id:                c.id,
    full_name:         c.full_name,
    email:             c.email,
    phone:             c.phone,
    notification_pref: c.notification_pref || 'email',
  }))
  // Sort alphabetically across both tiers.
  return [...platformRows, ...contactRows].sort((a, b) =>
    (a.full_name || '').localeCompare(b.full_name || '')
  )
}

/**
 * Create a new email-only closer contact. The default tier for new
 * closers — most setups don't need a platform login.
 */
export async function createCloserContact({ fullName, email, phone, notificationPref = 'email' }) {
  const orgId = await getMyOrgId()
  if (!orgId) return { data: null, error: new Error('No organization') }
  if (!fullName || !email) return { data: null, error: new Error('Name + email required') }
  const { data, error } = await supabase
    .from('closer_contacts')
    .insert({
      organization_id:   orgId,
      full_name:         fullName.trim(),
      email:             email.trim(),
      phone:             phone?.trim() || null,
      notification_pref: notificationPref,
    })
    .select()
    .single()
  return { data, error }
}

/**
 * Patch an existing email-only closer contact. Same field set as create.
 */
export async function updateCloserContact(contactId, patch = {}) {
  const cleaned = {}
  for (const [src, dst] of [
    ['fullName', 'full_name'],
    ['email',    'email'],
    ['phone',    'phone'],
    ['notificationPref', 'notification_pref'],
  ]) {
    if (src in patch) {
      const v = patch[src]
      cleaned[dst] = (typeof v === 'string' && v.trim() === '') ? null : (v?.trim?.() ?? v)
    }
  }
  if (Object.keys(cleaned).length === 0) return { data: null, error: new Error('No fields') }
  const { data, error } = await supabase
    .from('closer_contacts')
    .update(cleaned)
    .eq('id', contactId)
    .select()
    .single()
  return { data, error }
}

/**
 * Remove an email-only contact. Any leads assigned to them are left with
 * a NULL closer reference (ON DELETE SET NULL on the FK).
 */
export async function deleteCloserContact(contactId) {
  const { error } = await supabase
    .from('closer_contacts')
    .delete()
    .eq('id', contactId)
  return { error }
}

/**
 * Promote an email-only contact to a platform user. Re-uses the existing
 * manage-team edge function to spawn the auth account, then re-points
 * any active leads from closer_contact_id to the new closer_id and stamps
 * the contact row with promoted_to_user_id (audit trail).
 *
 * Returns { newUserId, emailSent } on success.
 */
export async function promoteCloserContactToPlatform(contactId) {
  // 1. Pull the contact so we have name/email/phone.
  const { data: contact, error: readErr } = await supabase
    .from('closer_contacts')
    .select('id, full_name, email, phone')
    .eq('id', contactId)
    .single()
  if (readErr || !contact) return { error: readErr || new Error('Contact not found') }

  // 2. Spawn the platform user via the existing closer-invite flow.
  const { user, emailSent, emailError, error: createErr } = await createCloser({
    fullName: contact.full_name,
    email:    contact.email,
    phone:    contact.phone,
    mode:     'invite',
  })
  if (createErr || !user?.id) return { error: createErr || new Error('Could not create user') }

  // 3. Re-point active leads from closer_contact_id → closer_id.
  await supabase
    .from('interactions')
    .update({ closer_contact_id: null, closer_id: user.id })
    .eq('closer_contact_id', contactId)

  // 4. Stamp the contact row as promoted so it drops out of the active list.
  await supabase
    .from('closer_contacts')
    .update({ promoted_to_user_id: user.id, promoted_at: new Date().toISOString() })
    .eq('id', contactId)

  return { newUserId: user.id, emailSent, emailError }
}

/**
 * Pick the next closer in round-robin rotation. Used by the canvassing
 * flow when a setter books a Hot Lead and the org's lead_routing_mode
 * is 'round_robin'. Picks the closer with the oldest most-recent
 * assignment so leads spread evenly across the team.
 *
 * Returns the chosen closer's user id, or null if the org has no closers.
 * Computed client-side from a one-shot query so we don't need to ship
 * an RPC for it — performance is fine while teams stay small.
 */
export async function pickRoundRobinCloser() {
  // Phase 5: round-robin now considers BOTH platform users and email-
  // only contacts. Returns { tier, id } so the caller can write the
  // right FK column (closer_id vs closer_contact_id). Returns null if
  // the org has no closers of either tier.
  const closers = await getAllClosersUnified()
  if (closers.length === 0) return null

  const platformIds = closers.filter((c) => c.tier === 'platform').map((c) => c.id)
  const contactIds  = closers.filter((c) => c.tier === 'contact' ).map((c) => c.id)

  // Pull the most-recent assignment timestamp from BOTH FK columns in a
  // single round-trip per side. RLS lets a manager / rep read interactions
  // in their org — which is exactly the rows we need.
  const [{ data: byUser }, { data: byContact }] = await Promise.all([
    platformIds.length > 0
      ? supabase
          .from('interactions')
          .select('closer_id, created_at')
          .in('closer_id', platformIds)
          .order('created_at', { ascending: false })
      : { data: [] },
    contactIds.length > 0
      ? supabase
          .from('interactions')
          .select('closer_contact_id, created_at')
          .in('closer_contact_id', contactIds)
          .order('created_at', { ascending: false })
      : { data: [] },
  ])

  // Most-recent per-closer timestamp. Closers with no prior assignment
  // sort to the front so brand-new hires get their first lead before
  // busy veterans get their next.
  const lastAt = {}
  for (const c of closers) lastAt[c.id] = Number.NEGATIVE_INFINITY
  for (const row of byUser || []) {
    const t = new Date(row.created_at).getTime()
    if (t > lastAt[row.closer_id]) lastAt[row.closer_id] = t
  }
  for (const row of byContact || []) {
    const t = new Date(row.created_at).getTime()
    if (t > lastAt[row.closer_contact_id]) lastAt[row.closer_contact_id] = t
  }
  let pick = closers[0]
  for (const c of closers) {
    if (lastAt[c.id] < lastAt[pick.id]) pick = c
  }
  return { tier: pick.tier, id: pick.id }
}

/**
 * Set / clear a lead's closer reference. Handles the two-tier model by
 * writing to either closer_id or closer_contact_id and clearing the
 * other, enforcing the XOR constraint at the application level on top
 * of the DB CHECK. Called from LeadDetailModal's reassign dropdown and
 * from the canvassing flow after a round-robin pick.
 *
 *   leadId : interactions.id
 *   pick   : null (to unassign) OR { tier: 'platform' | 'contact', id }
 */
export async function setLeadCloser(leadId, pick) {
  const patch =
    !pick ? { closer_id: null, closer_contact_id: null }
    : pick.tier === 'platform'
      ? { closer_id: pick.id, closer_contact_id: null }
      : { closer_id: null,    closer_contact_id: pick.id }
  const { data, error } = await supabase
    .from('interactions')
    .update(patch)
    .eq('id', leadId)
    .select()
    .single()
  return { data, error }
}

/**
 * Update the quoted price (estimated_value) on a single lead. Called from
 * the Pipeline tab's drill-down modal when a manager revises the number
 * after a closer's actual quote comes back. Manager RLS allows this in
 * their own org; closers can only update via updateLeadStage above.
 *
 *   leadId : interactions.id
 *   value  : numeric dollar amount, or null to clear
 */
export async function updateLeadPrice(leadId, value) {
  const v = value === null || value === '' ? null : Number(value)
  if (v !== null && (Number.isNaN(v) || v < 0)) {
    return { data: null, error: new Error('Invalid price') }
  }
  const { data, error } = await supabase
    .from('interactions')
    .update({ estimated_value: v })
    .eq('id', leadId)
    .select()
    .single()
  return { data, error }
}

/**
 * Patch contact info fields on a single lead. Used by the Pipeline tab's
 * drill-down modal so a manager can fix a typo in the customer's name,
 * address, phone, email, or services without bouncing through a separate
 * edit screen. Accepts any subset of the editable fields; values not in
 * the patch are left untouched. Empty string → null for nicer DB hygiene
 * (so a cleared field doesn't read as "" in downstream queries).
 *
 *   patch keys: contact_name | address | contact_phone |
 *               contact_email | service_types (string[] OR null)
 */
export async function updateLeadContact(leadId, patch = {}) {
  const cleaned = {}
  for (const k of ['contact_name', 'address', 'contact_phone', 'contact_email']) {
    if (k in patch) {
      const v = patch[k]
      cleaned[k] = (typeof v === 'string' && v.trim() === '') ? null : (v ?? null)
    }
  }
  if ('service_types' in patch) {
    const v = patch.service_types
    cleaned.service_types = Array.isArray(v) && v.length > 0 ? v : null
  }
  if (Object.keys(cleaned).length === 0) {
    return { data: null, error: new Error('No fields to update') }
  }
  const { data, error } = await supabase
    .from('interactions')
    .update(cleaned)
    .eq('id', leadId)
    .select()
    .single()
  return { data, error }
}

/**
 * Update the appointment date/time on a single lead. Called from the
 * Pipeline tab's drill-down modal when a manager reschedules.
 *
 * If the lead is currently a Hot Lead and we're SETTING an appointment
 * (not clearing it), also promote stage → 'appt_scheduled' so the kanban
 * reflects the change in the same write. Other stages keep their
 * current stage — a manager editing the time on an already-booked deal
 * shouldn't unbook it.
 *
 *   leadId  : interactions.id
 *   isoOrNull : ISO timestamp string, or null to clear the appointment
 */
export async function updateLeadAppointment(leadId, isoOrNull) {
  // Fetch the current stage to decide whether to auto-promote.
  // maybeSingle so a deleted/RLS-hidden row doesn't throw — we just
  // skip the auto-promotion in that case.
  const { data: current } = await supabase
    .from('interactions')
    .select('stage')
    .eq('id', leadId)
    .maybeSingle()
  const patch = { appointment_at: isoOrNull || null }
  if (isoOrNull && current?.stage === 'hot_lead') {
    patch.stage = 'appt_scheduled'
  }
  // maybeSingle on the return: if RLS hides the post-update row we get
  // { data: null, error: null } instead of a "Cannot coerce…" throw, so
  // callers can detect the silent-zero-rows case and show a clearer
  // message.
  const { data, error } = await supabase
    .from('interactions')
    .update(patch)
    .eq('id', leadId)
    .select()
    .maybeSingle()
  if (!error && !data) {
    return { data: null, error: new Error('No rows updated — check your permissions and refresh.') }
  }
  return { data, error }
}

/**
 * Closer-facing helper to advance a lead through the pipeline. Used by
 * the Closer Inbox to mark "estimate sent" / "booked" / "lost". RLS lets
 * closers update only rows where closer_id = auth.uid().
 *
 *   stage : 'hot_lead' | 'appt_scheduled' | 'estimate_sent' | 'booked'
 *         | 'closed_stale' | 'closed_lost' | 'closed_not_interested'
 *   extras: { appointment_at?, estimate_sent_at?, lost_reason?,
 *             lost_reason_notes?, lost_at? }
 */
export async function updateLeadStage(leadId, stage, extras = {}) {
  const patch = { stage }
  for (const k of [
    'appointment_at', 'estimate_sent_at',
    'lost_reason', 'lost_reason_notes', 'lost_at',
  ]) {
    if (extras[k] !== undefined) patch[k] = extras[k]
  }
  // maybeSingle so a hidden-by-RLS post-update SELECT returns
  // { data: null, error: null } instead of throwing "Cannot coerce
  // the result to a single JSON object" — see updateLeadAppointment.
  const { data, error } = await supabase
    .from('interactions')
    .update(patch)
    .eq('id', leadId)
    .select()
    .maybeSingle()
  if (!error && !data) {
    return { data: null, error: new Error('No rows updated — check your permissions and refresh.') }
  }
  return { data, error }
}

/**
 * Re-send the onboarding invite email to an existing rep. Used when the
 * original email didn't arrive, bounced, or the rep lost the link before
 * setting a password. The edge function uses type='magiclink' here (not
 * 'invite') because Supabase's invite generator errors on users that are
 * already registered.
 */
export async function resendRepInvite(repId) {
  const { data, error } = await callManageTeam({ action: 'resend_invite', repId })
  if (error) return { error }
  return {
    emailSent:  Boolean(data?.email_sent),
    emailError: data?.email_error || null,
    error:      null,
  }
}

/**
 * Delete a rep account (manager only).
 * Calls the manage-team Edge Function.
 */
export async function deleteRep(repId) {
  const { error } = await callManageTeam({ action: 'delete', repId })
  return { error: error || null }
}

// ── Invite-code (shareable rep sign-up link) helpers ──────────────────────────
//
// The "Add Rep" form is fine when an owner has a handful of new hires, but it
// gets brutal at scale (think a roofing company onboarding 100+ door-to-door
// reps before a busy season). The invite-code flow lets the owner generate one
// URL — https://app.knockiq.com/join/<code> — that any number of reps can
// self-onboard through. Joiners land in `status='pending'` and the owner taps
// Approve in Settings before they can canvass. All of the actual code +
// approval state lives on the server (organizations.invite_code* and
// users.status) and is exposed through the RPCs added in 20260528_invite_codes.

/**
 * Build the shareable URL for a given invite code. Mirrors the App.jsx route
 * shape (/join/:code) and uses window.location.origin so the same code
 * formats correctly on localhost, preview deploys, and production.
 *
 *   buildInviteUrl('K7P29W4Q')  // → 'https://app.knockiq.com/join/K7P29W4Q'
 */
export function buildInviteUrl(code) {
  if (!code) return ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/join/${encodeURIComponent(code)}`
}

/**
 * Public lookup — used by the /join/:code screen to show "You're joining
 * Acme Solar" BEFORE the rep types anything. Returns null if the code is
 * unknown or has been disabled by the owner; the caller treats null as
 * "this link is dead" and renders an error state. Safe for unauthenticated
 * callers (the RPC is granted to anon).
 */
export async function lookupInviteCode(code) {
  if (!code) return null
  const { data, error } = await supabase.rpc('lookup_invite_code', { p_code: code })
  if (error) return null
  // RPC returns SETOF — the first row (or undefined if no match).
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  return {
    organizationId:   row.organization_id,
    organizationName: row.organization_name,
    tier:             row.tier,
  }
}

/**
 * Called by the freshly-signed-up rep AFTER supabase.auth.signUp returns a
 * session. The RPC reads auth.uid() server-side and stamps the rep's
 * public.users row with the right organization_id + status='pending'.
 *
 * Throws are surfaced as { error }; we never want a thrown exception here
 * because the rep is already authenticated and the UI needs to recover
 * gracefully (e.g. show "couldn't attach you to the org — contact your
 * manager" rather than a generic crash).
 */
export async function consumeInviteCode({ code, fullName, phone }) {
  const { data, error } = await supabase.rpc('consume_invite_code', {
    p_code:      code,
    p_full_name: fullName || null,
    p_phone:     phone    || null,
  })
  if (error) return { error }
  const row = Array.isArray(data) ? data[0] : data
  return {
    organizationId:   row?.organization_id || null,
    organizationName: row?.organization_name || null,
    status:           row?.status || 'pending',
    error:            null,
  }
}

/**
 * Owner-side: read the current invite code + enabled state for the caller's
 * org. Returns null if the caller isn't a manager — the Settings UI uses
 * that to skip rendering the section entirely (defensive; the section is
 * already gated to managers up the tree).
 */
export async function getMyInviteCode() {
  const { data, error } = await supabase.rpc('get_my_invite_code')
  if (error) {
    console.warn('[getMyInviteCode]', error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  return {
    code:    row.invite_code,
    enabled: row.invite_code_enabled,
    orgId:   row.organization_id,
    orgName: row.organization_name,
  }
}

/**
 * Rotate the invite code. Any previously-distributed URL stops resolving
 * the moment this returns — the old code is overwritten in place, so the
 * existing partial unique index guarantees no collisions on the new value.
 * Returns the new code string so the caller can refresh its local state
 * without an extra round-trip.
 */
export async function regenerateInviteCode() {
  const { data, error } = await supabase.rpc('regenerate_invite_code')
  if (error) return { error }
  return { code: data, error: null }
}

/** Enable / disable the invite link without rotating the code. */
export async function setInviteCodeEnabled(enabled) {
  const { data, error } = await supabase.rpc('set_invite_code_enabled', {
    p_enabled: Boolean(enabled),
  })
  if (error) return { error }
  return { enabled: data, error: null }
}

/**
 * List reps in the caller's org who have signed up via an invite link and
 * are waiting for approval. Returns [] for non-managers or empty orgs.
 *
 * Sorted oldest-first so the owner sees "this person has been waiting the
 * longest" at the top of the list — matches the mental model of an inbox.
 */
export async function getPendingReps() {
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, phone, created_at')
    .eq('organization_id', orgId)
    .eq('role',            'rep')
    .eq('status',          'pending')
    .order('created_at', { ascending: true })
  if (error) {
    console.warn('[getPendingReps]', error.message)
    return []
  }
  return data || []
}

/** Approve a pending rep (flips users.status → 'active'). Owner-only. */
export async function approveRep(repId) {
  const { error } = await supabase.rpc('approve_rep', { p_rep_id: repId })
  return { error: error || null }
}

/**
 * Reject a pending rep. Owner-only. The auth user is preserved so the
 * person can re-join later via a fresh code — to permanently remove,
 * use deleteRep().
 */
export async function rejectRep(repId) {
  const { error } = await supabase.rpc('reject_rep', { p_rep_id: repId })
  return { error: error || null }
}

// ── Territory helpers ─────────────────────────────────────────────────────────

export async function getTerritories() {
  // Explicit org filter mirrors the pattern used by other manager
  // queries (see getAllReps / getAllSessions). Without this, super-
  // admins see every org's territories and — more importantly — if the
  // territories table's RLS policy grew to require org scoping, a stale
  // client-side query could silently return 0 rows even though the
  // manager had created zones. Scoping to getMyOrgId() locks the read
  // to the caller's own organization regardless of RLS.
  const orgId = await getMyOrgId()
  if (!orgId) return []
  // PostgREST disambiguation: `territory_assignments` has TWO foreign keys
  // into `users` (rep_id AND assigned_by, added when assignments gained
  // an auditor column). A bare `users(...)` embed made PostgREST return
  // HTTP 300 / PGRST201 ("more than one relationship") and this helper
  // silently returned `[]` — the root cause of "I saved a territory but
  // the list is empty." The `users!rep_id(...)` form pins the embed to
  // the rep_id FK, which is the one the UI needs (who is this zone
  // assigned to).
  const { data, error } = await supabase
    .from('territories')
    .select(`*, territory_assignments ( id, rep_id, users!rep_id ( id, full_name, email ) )`)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })
  if (error) {
    // Previously this error was thrown on the floor, so a broken embed
    // looked identical to an empty org. Log it loudly so the next
    // regression surfaces in the console.
    console.warn('[getTerritories] query failed:', error)
    return []
  }
  return data || []
}

export async function createTerritory({ name, color, polygon, createdBy, category = null }) {
  // Stamp the row with the caller's organization_id so it shows up for
  // every manager/rep in the same org. Without this, the insert either
  // fails RLS or creates an orphan row that nobody can read back — this
  // was the root cause of "I created territories but see 0 listed".
  //
  // If the caller has no organization_id we refuse the insert up-front
  // rather than writing an orphan row that no later SELECT can see. The
  // previous behavior was the direct cause of the "I drew a territory
  // but the list still says 'No territories yet'" report — the insert
  // silently succeeded with organization_id=null, but the list query
  // filters by the manager's own org so nothing came back.
  const orgId = await getMyOrgId()
  if (!orgId) {
    return {
      data:  null,
      error: new Error('Your account has no organization. Ask an admin to re-invite you.'),
    }
  }
  const { data, error } = await supabase
    .from('territories')
    .insert({
      name, color, polygon, category,
      created_by: createdBy,
      organization_id: orgId,
    })
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

/**
 * Territories visible to a rep.
 *
 * Changed from assignment-gated → org-wide in 20260419. Rationale: when a
 * manager draws a zone they almost always want every rep in the org to
 * see it on the map; assignments became a *priority flag* (the rep's
 * territory inbox highlights "Assigned to you" entries first), not an
 * access gate. This function now returns every zone in the rep's org and
 * stamps each row with `assigned_to_me` so the UI can style / sort.
 *
 * Callers that want ONLY the assigned subset can filter on the flag.
 */
export async function getRepTerritories(repId) {
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const { data } = await supabase
    .from('territories')
    .select(`*, territory_assignments ( rep_id )`)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })
  return (data || []).map((t) => ({
    ...t,
    assigned_to_me: (t.territory_assignments || []).some((a) => a.rep_id === repId),
  }))
}

/**
 * Rich territory feed for the rep's "Next Stops" inbox on RepHome:
 * every org zone, each with the assigned-to-me flag, the count of
 * interactions that have ever landed inside it, and the most recent
 * knock date. Used to render recency/assignment badges without the
 * client having to join door-history arrays client-side.
 */
export async function getOrgTerritoriesForRep(repId) {
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const [{ data: terrs }, history, completions] = await Promise.all([
    supabase
      .from('territories')
      // Same FK-ambiguity fix as getTerritories — pin the `users` embed
      // to the rep_id foreign key so PostgREST doesn't 300 over the two
      // FKs (rep_id + assigned_by) landing on public.users.
      .select(`*, territory_assignments ( rep_id, users!rep_id ( id, full_name ) )`)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true }),
    getAllDoorHistory(),
    // Per-rep completion state. RLS already limits the rows to this
    // rep's completions, but we still scope by rep_id explicitly so a
    // future policy change (e.g. exposing manager completions to reps)
    // doesn't accidentally annotate the inbox with someone else's
    // "done" flags.
    supabase
      .from('territory_completions')
      .select('territory_id, completed_at')
      .eq('rep_id', repId),
  ])
  const rows = terrs || []
  const completionByTerritory = new Map(
    (completions?.data || []).map((c) => [c.territory_id, c.completed_at])
  )

  // Inline ray-cast — matches TerritoryMap.pip. Keeps this file free of a
  // circular dep on components/.
  const pip = (lat, lng, polygon) => {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [yi, xi] = polygon[i]
      const [yj, xj] = polygon[j]
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside
      }
    }
    return inside
  }

  return rows.map((t) => {
    const poly = Array.isArray(t.polygon) ? t.polygon : null
    let lastKnockAt = null
    let interactionCount = 0
    if (poly && poly.length >= 3) {
      for (const h of history) {
        if (h.lat == null || h.lng == null) continue
        if (!pip(h.lat, h.lng, poly)) continue
        interactionCount += 1
        if (!lastKnockAt || new Date(h.created_at) > new Date(lastKnockAt)) {
          lastKnockAt = h.created_at
        }
      }
    }
    return {
      ...t,
      assigned_to_me:    (t.territory_assignments || []).some((a) => a.rep_id === repId),
      assigned_rep_names: (t.territory_assignments || [])
        .map((a) => a.users?.full_name)
        .filter(Boolean),
      interaction_count: interactionCount,
      last_knock_at:     lastKnockAt,
      // null if the rep hasn't marked this zone done yet. The rep
      // territories screen uses the presence of this value to float the
      // row to the bottom and style it as resolved.
      completed_at:      completionByTerritory.get(t.id) || null,
    }
  })
}

// ── Territory completion (rep-scoped) ─────────────────────────────────────
// Each row is a rep's assertion that they've finished canvassing a zone.
// Completion is per-rep — rep A marking "done" doesn't hide the zone for
// rep B — and reversible via unmarkTerritoryCompleted. The unique
// (territory_id, rep_id) constraint means a second mark on the same zone
// is a no-op instead of creating a duplicate row.

export async function markTerritoryCompleted(territoryId, repId) {
  const orgId = await getMyOrgId()
  if (!orgId) return { error: new Error('No organization on account.') }
  const { data, error } = await supabase
    .from('territory_completions')
    .upsert(
      {
        territory_id:    territoryId,
        rep_id:          repId,
        organization_id: orgId,
        completed_at:    new Date().toISOString(),
      },
      { onConflict: 'territory_id,rep_id' }
    )
    .select()
    .single()
  return { data, error }
}

export async function unmarkTerritoryCompleted(territoryId, repId) {
  const { error } = await supabase
    .from('territory_completions')
    .delete()
    .eq('territory_id', territoryId)
    .eq('rep_id', repId)
  return { error }
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
  // Explicit org scope so super-admin managers see only their own org here.
  const orgId = await getMyOrgId()
  if (!orgId) return []
  let query = supabase
    .from('interactions')
    .select(`*, canvassing_sessions(neighborhood), users(full_name)`)
    .eq('organization_id', orgId)
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
 * Org IDs that should bypass the 5-minute live-freshness filter. Used for
 * sales-demo accounts where the seed timestamps would otherwise go stale
 * between sessions and the Live tab would look empty. Real-customer orgs
 * still honor the freshness check.
 */
const DEMO_ORG_IDS = new Set([
  'd0d0d0d0-0000-4000-a000-000000000001', // Sunburst Solar
  'e1e1e1e1-0000-4000-a000-000000000001', // Apex Pest Defense
])

/**
 * Get all reps with a location update in the last 5 minutes (active).
 * Returns: [{ rep_id, lat, lng, updated_at, session_id, user, session }]
 *
 * Demo orgs (see DEMO_ORG_IDS) skip the freshness filter so the Live tab
 * is always populated regardless of when the seed last ran. Since RLS
 * scopes rep_locations to the caller's organization, this only affects
 * the demo orgs themselves — real-customer queries still require recent
 * updates.
 */
export async function getActiveRepLocations() {
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  let query = supabase
    .from('rep_locations')
    .select('rep_id, lat, lng, updated_at, session_id, organization_id')
  const { data: locations } = await query
  if (!locations?.length) return []

  const filtered = locations.filter((l) =>
    DEMO_ORG_IDS.has(l.organization_id) || l.updated_at >= since,
  )
  if (!filtered.length) return []

  const repIds    = filtered.map((l) => l.rep_id)
  const sessionIds = filtered.map((l) => l.session_id).filter(Boolean)

  const [{ data: users }, { data: sessions }] = await Promise.all([
    supabase.from('users').select('id, full_name').in('id', repIds),
    sessionIds.length
      ? supabase
          .from('canvassing_sessions')
          .select('id, doors_knocked, conversations, estimates, bookings, revenue_booked, started_at')
          .in('id', sessionIds)
      : Promise.resolve({ data: [] }),
  ])

  const userMap    = Object.fromEntries((users    || []).map((u) => [u.id, u]))
  const sessionMap = Object.fromEntries((sessions || []).map((s) => [s.id, s]))

  return filtered.map((l) => ({
    ...l,
    user:    userMap[l.rep_id]     || null,
    session: sessionMap[l.session_id] || null,
  }))
}

/**
 * Aggregate session stats by rep for a given period, enriched with the
 * fields the manager Leaderboard needs to feel "alive": prior-period rank
 * (for movement chips), a rolling daily-booking streak, and the rep's
 * personal best revenue over a comparable historical window (for PR
 * badges). Done in one trip so the UI doesn't need N+1 round-trips.
 *
 * period: 'today' | 'week' | 'month'
 *
 * Returned shape per rep:
 *   { id, name, doors, conversations, estimates, bookings, revenue,
 *     prior:        { rank, revenue, bookings, ... } | null,
 *     streakDays:   number,   // consecutive days ending today with bookings > 0
 *     personalBest: number,   // max revenue across prior matching periods
 *     isPR:         boolean   // current revenue strictly exceeds personalBest
 *   }
 */
export async function getLeaderboardData(period = 'today') {
  // ── 1. Resolve current + prior windows ─────────────────────────────────────
  // We pull a 60-day lookback in one query and bucket rows in JS so we can
  // compute current / prior / personal-best from a single network trip.
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let windowMs, periodLabel
  if (period === 'today') {
    windowMs    = 86400000          // 1 day
    periodLabel = 'today'
  } else if (period === 'week') {
    windowMs    = 7 * 86400000      // 7 days
    periodLabel = 'week'
  } else {
    windowMs    = 30 * 86400000     // 30 days
    periodLabel = 'month'
  }

  const currentFrom = (period === 'today')
    ? startOfToday.getTime()
    : Date.now() - windowMs
  const priorFrom   = currentFrom - windowMs
  // 60 days back is enough for ~8 weekly windows or 2 monthly windows worth
  // of personal-best comparison without paying for a full-org historical scan.
  const lookbackFrom = Math.min(priorFrom, Date.now() - 60 * 86400000)

  const { data } = await supabase
    .from('canvassing_sessions')
    .select('rep_id, started_at, doors_knocked, conversations, estimates, bookings, revenue_booked, users(full_name)')
    .gte('started_at', new Date(lookbackFrom).toISOString())

  const sessions = data || []

  // ── 2. Bucket sessions into current + prior + collect by-day for streak ────
  const blank = (s) => ({
    id:            s.rep_id,
    name:          s.users?.full_name || 'Unknown',
    doors:         0,
    conversations: 0,
    estimates:     0,
    bookings:      0,
    revenue:       0,
  })
  const accumulate = (target, s) => {
    target.doors         += s.doors_knocked  || 0
    target.conversations += s.conversations  || 0
    target.estimates     += s.estimates      || 0
    target.bookings      += s.bookings       || 0
    target.revenue       += Number(s.revenue_booked) || 0
  }

  const current = {}                  // rep_id → stats for the active window
  const prior   = {}                  // rep_id → stats for the prior window
  // For PR: bucket each rep's revenue per fixed-length window the same size
  // as `windowMs`, anchored to the current window's start. Buckets older
  // than the current window become PR candidates.
  const buckets = {}                  // rep_id → { bucketIdx → revenue }
  // For streak: rep_id → Set<YYYY-MM-DD> of days that had at least 1 booking.
  const bookingDays = {}

  for (const s of sessions) {
    const ts = new Date(s.started_at).getTime()
    if (ts >= currentFrom) {
      current[s.rep_id] ??= blank(s); accumulate(current[s.rep_id], s)
    }
    if (ts >= priorFrom && ts < currentFrom) {
      prior[s.rep_id]   ??= blank(s); accumulate(prior[s.rep_id], s)
    }
    // PR buckets: how many `windowMs` units before currentFrom did this fall?
    // bucketIdx 0 == current, 1 == prior, 2+ == older history.
    const bucketIdx = Math.floor((currentFrom - ts) / windowMs) + (ts >= currentFrom ? 0 : 1)
    if (bucketIdx >= 1) {
      buckets[s.rep_id] ??= {}
      buckets[s.rep_id][bucketIdx] = (buckets[s.rep_id][bucketIdx] || 0) + (Number(s.revenue_booked) || 0)
    }
    // Streak tracking (only counts days that had at least one booking)
    if ((s.bookings || 0) > 0) {
      const d = new Date(ts)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      bookingDays[s.rep_id] ??= new Set()
      bookingDays[s.rep_id].add(key)
    }
  }

  // ── 3. Rank prior window so we can compute movement ────────────────────────
  const priorRanked = Object.values(prior).sort((a, b) => b.revenue - a.revenue)
  const priorRankById = {}
  priorRanked.forEach((r, i) => { priorRankById[r.id] = i + 1 })

  // ── 4. Streak: walk backward day-by-day until we hit a gap ─────────────────
  function streakFor(repId) {
    const set = bookingDays[repId]
    if (!set || set.size === 0) return 0
    let n = 0
    const cursor = new Date(startOfToday)
    // Allow today OR yesterday to start a streak (a rep checking the board
    // in the morning shouldn't see their streak reset before they go out).
    const todayKey = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`
    if (!set.has(todayKey)) {
      cursor.setDate(cursor.getDate() - 1)
      const y = cursor
      const yKey = `${y.getFullYear()}-${y.getMonth()}-${y.getDate()}`
      if (!set.has(yKey)) return 0
    }
    while (true) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`
      if (set.has(key)) { n++; cursor.setDate(cursor.getDate() - 1) }
      else break
    }
    return n
  }

  // ── 5. Stitch enriched rows ────────────────────────────────────────────────
  // Roster = union of reps active in either window so a rep who fell off
  // still shows up with their movement chip.
  const allRepIds = new Set([...Object.keys(current), ...Object.keys(prior)])
  const out = []
  for (const id of allRepIds) {
    const cur = current[id] || blank({ rep_id: id, users: { full_name: prior[id]?.name } })
    cur.id   = id
    cur.name = cur.name || prior[id]?.name || 'Unknown'

    const priorStats = prior[id] || null
    const priorRank  = priorRankById[id] || null

    // Personal best across historical buckets that have ≥ 60% of the current
    // window's coverage worth of data (cheap heuristic to skip partial buckets
    // at the lookback edge).
    const myBuckets = buckets[id] || {}
    const personalBest = Math.max(0, ...Object.entries(myBuckets)
      .filter(([idx]) => Number(idx) >= 1)
      .map(([, rev]) => rev))

    out.push({
      ...cur,
      prior: priorStats ? { ...priorStats, rank: priorRank } : null,
      streakDays:    streakFor(id),
      personalBest,
      isPR:          cur.revenue > 0 && cur.revenue > personalBest,
      periodLabel,
    })
  }

  return out
}

/**
 * Same shape as getLeaderboardData but over an arbitrary ISO date range.
 * Used by the RepHome callouts to compare this-week vs last-week ranks
 * for the "you moved up / down" nudge. RLS keeps rows scoped to the
 * caller's org.
 */
export async function getLeaderboardRange(dateFromISO, dateToISO) {
  const { data } = await supabase
    .from('canvassing_sessions')
    .select('rep_id, doors_knocked, conversations, estimates, bookings, revenue_booked, users(full_name)')
    .gte('started_at', dateFromISO)
    .lt('started_at',  dateToISO)

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
    r.revenue       += Number(s.revenue_booked) || 0
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

/** Update fields on a single interaction (outcome, address, notes, revenue).
 *
 *  We DON'T include updated_at in the payload anymore — the
 *  interactions_bump_updated_at_trg trigger in
 *  20260603_interactions_updated_at_and_manager_update_rls bumps it
 *  automatically on every update. Sending the column from the client
 *  was redundant *and* was the cause of the "Could not find the
 *  'updated_at' column of 'interactions' in the schema cache" error
 *  back when the column didn't exist.
 *
 *  maybeSingle on the return so a row hidden by RLS post-update fails
 *  loud-and-clear instead of throwing the cryptic single() error. */
export async function updateInteraction(interactionId, updates) {
  const { data, error } = await supabase
    .from('interactions')
    .update(updates)
    .eq('id', interactionId)
    .select()
    .maybeSingle()
  if (!error && !data) {
    return { data: null, error: new Error('No rows updated — check your permissions and refresh.') }
  }
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
 * Upload a photo file for an interaction to the (now-private)
 * "interaction-photos" bucket. Returns the storage **path** (e.g.
 * "<interaction-id>/<timestamp>_<rand>.jpg") to persist in
 * interactions.photo_urls. Display sites resolve paths to signed URLs via
 * lib/photos.js → usePhotoUrl(value, 'interaction-photos').
 *
 * Returns null on failure.
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
  // Return the storage path — the bucket is private, so a "public URL"
  // wouldn't work anyway. usePhotoUrl() mints signed URLs on demand.
  return path
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
 * Get bookings (or unbooked estimates) for the manager view.
 *
 * Source of truth is `interactions` — every booking/estimate comes in
 * through the rep's interaction modal and already carries address, contact
 * info, photos, follow-up flag, estimated value, and organization_id. The
 * separate `bookings` pipeline table (for future CRM status tracking) is not
 * queried here because it's optional and historically under-populated — reading
 * straight from interactions guarantees the tab always shows every job.
 *
 * filters.outcome can be:
 *   'booked'             → only booked jobs (default, matches the old behavior)
 *   'estimate_requested' → only unbooked estimate requests
 *   'all'                → both booked + estimate_requested (merged list)
 *
 * Returns rows shaped to match the existing BookingsTab contract: photo_urls
 * and follow_up live under a nested `interactions` object so the view layer
 * doesn't need to change.
 */
// ──────────────────────────────────────────────────────────────────────────────
// PIPELINE (Phase 4) — replaces the legacy bookings list with a stage-aware
// view that powers the manager's Pipeline tab. All helpers in this block
// operate off interactions.stage rather than interactions.outcome.
// ──────────────────────────────────────────────────────────────────────────────

// The four "active pipeline" stages, in funnel order. Used as the default
// filter for the kanban + most action-queue rules. Centralized so the new
// Pipeline tab and the Closer Inbox use the same vocabulary.
export const ACTIVE_PIPELINE_STAGES = [
  'hot_lead', 'appt_scheduled', 'estimate_sent', 'booked',
]
export const CLOSED_PIPELINE_STAGES = [
  'closed_stale', 'closed_lost', 'closed_not_interested',
]

/**
 * Fetch every interaction in an active pipeline stage. Returns rows with
 * the setter (rep) and closer joined in so the manager can render assignee
 * names on each card without follow-up queries. RLS filters to the
 * caller's org automatically.
 *
 *   filters.repId    — restrict to one rep (setter)
 *   filters.closerId — restrict to one closer
 *   filters.dateFrom / dateTo — restrict by created_at
 */
export async function getPipelineLeads(filters = {}) {
  let query = supabase
    .from('interactions')
    .select(`
      id, stage, outcome, address, contact_name, contact_phone, contact_email,
      service_types, estimated_value, notes, follow_up,
      appointment_at, estimate_sent_at, hot_lead_started_at,
      closer_id, closer_contact_id, rep_id, created_at, lost_reason, lost_at,
      setter:rep_id                  ( id, full_name ),
      closer:closer_id               ( id, full_name ),
      closer_contact:closer_contact_id ( id, full_name )
    `)
    .in('stage', ACTIVE_PIPELINE_STAGES)
    .order('created_at', { ascending: false })
    .limit(500)

  if (filters.repId)    query = query.eq('rep_id', filters.repId)
  if (filters.closerId) query = query.eq('closer_id', filters.closerId)
  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters.dateTo)   query = query.lte('created_at', filters.dateTo)

  const { data } = await query
  return data || []
}

/**
 * Surface at-risk leads for the action queue. Each helper rule returns
 * `{ reason, urgency, lead }` tuples; we combine, dedupe by lead id (so a
 * single lead doesn't appear twice with two reasons), and rank
 * red-before-amber.
 *
 * The detection rules:
 *   • Appt in next 4 hours      → red
 *   • Unassigned appt scheduled previous day or older → red (per design)
 *   • Estimate sent > 5 days ago, still in estimate_sent → red
 *   • Hot Lead aging > 7 days   → amber
 *   • Follow-up flag set + no activity 3d in active stage → amber
 *   • High-$ lead aging > 5d (top 3 by estimated_value)  → amber
 */
export async function getActionQueue() {
  const leads = await getPipelineLeads({})
  const now = Date.now()
  const queue = []
  const seen  = new Set()

  function add(reason, urgency, lead) {
    if (seen.has(lead.id)) return
    seen.add(lead.id)
    queue.push({ reason, urgency, lead })
  }

  // Rule 1: appt in next 4 hours
  for (const l of leads) {
    if (l.stage !== 'appt_scheduled' || !l.appointment_at) continue
    const t = new Date(l.appointment_at).getTime()
    const hoursAway = (t - now) / 3_600_000
    if (hoursAway >= 0 && hoursAway <= 4) {
      add(`Appt in ${Math.max(1, Math.round(hoursAway))} hr${Math.round(hoursAway) === 1 ? '' : 's'}`, 'red', l)
    }
  }

  // Rule 2: unassigned appt from previous day or older.
  // Per design conversation: this is the deadline trigger for manager-
  // dispatch routing — if a manager hasn't assigned a closer by end-of-
  // day for an appt logged previously, it's at risk.
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  for (const l of leads) {
    if (l.closer_id) continue
    if (l.stage !== 'appt_scheduled') continue
    const created = new Date(l.created_at).getTime()
    if (created < todayStart.getTime()) {
      add('Unassigned · needs closer', 'red', l)
    }
  }

  // Rule 3: estimate stale > 5 days
  for (const l of leads) {
    if (l.stage !== 'estimate_sent' || !l.estimate_sent_at) continue
    const days = (now - new Date(l.estimate_sent_at).getTime()) / 86_400_000
    if (days > 5) {
      add(`Estimate stale ${Math.round(days)}d`, 'red', l)
    }
  }

  // Rule 4: Hot Lead aging > 7 days
  for (const l of leads) {
    if (l.stage !== 'hot_lead') continue
    const start = l.hot_lead_started_at || l.created_at
    const days = (now - new Date(start).getTime()) / 86_400_000
    if (days > 7) {
      add(`Hot Lead aging ${Math.round(days)}d`, 'amber', l)
    }
  }

  // Rule 5: follow-up flag set + no activity 3+ days
  for (const l of leads) {
    if (!l.follow_up) continue
    const days = (now - new Date(l.created_at).getTime()) / 86_400_000
    if (days > 3) {
      add('Follow-up overdue', 'amber', l)
    }
  }

  // Rule 6: high-value aging — top 3 by estimated_value in any active
  // stage with >5d age. Pulled last so dedupe doesn't crowd out the
  // explicit-urgency rules above.
  const highValueCandidates = leads
    .filter((l) => Number(l.estimated_value) > 0)
    .filter((l) => (now - new Date(l.created_at).getTime()) / 86_400_000 > 5)
    .sort((a, b) => Number(b.estimated_value) - Number(a.estimated_value))
    .slice(0, 3)
  for (const l of highValueCandidates) {
    const days = Math.round((now - new Date(l.created_at).getTime()) / 86_400_000)
    add(`High $ aging ${days}d`, 'amber', l)
  }

  // Red urgency floats to top; otherwise preserve insertion order.
  queue.sort((a, b) => {
    if (a.urgency === b.urgency) return 0
    return a.urgency === 'red' ? -1 : 1
  })
  return queue
}

/**
 * Appointments scheduled in the next N days, grouped by day. Used by the
 * 10-day calendar strip at the top of the Pipeline tab. Returns an array
 * of { date (Date), appts ([{id, time, customer, value, ...}]), totalValue }.
 */
export async function getUpcomingAppointments(daysAhead = 10) {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end   = new Date(start); end.setDate(end.getDate() + daysAhead)
  const { data } = await supabase
    .from('interactions')
    .select(`
      id, stage, contact_name, address, estimated_value, closer_id, closer_contact_id,
      appointment_at, rep_id, created_at,
      setter:rep_id                  ( id, full_name ),
      closer:closer_id               ( id, full_name ),
      closer_contact:closer_contact_id ( id, full_name )
    `)
    .gte('appointment_at', start.toISOString())
    .lt('appointment_at',  end.toISOString())
    .in('stage', ['appt_scheduled', 'estimate_sent', 'booked'])
    .order('appointment_at', { ascending: true })

  // Bucket per calendar day so the strip can render fixed-width columns.
  const days = []
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i)
    days.push({ date: d, appts: [], totalValue: 0 })
  }
  for (const a of data || []) {
    const t = new Date(a.appointment_at)
    const dayIdx = Math.floor((t.getTime() - start.getTime()) / 86_400_000)
    if (dayIdx < 0 || dayIdx >= daysAhead) continue
    days[dayIdx].appts.push(a)
    days[dayIdx].totalValue += Number(a.estimated_value || 0)
  }
  return days
}

/**
 * Pipeline health KPIs for the last N days. Returns:
 *   avgTimeToBookDays    — booked leads, hot_lead_started_at → booked
 *   estimateToBookRate   — % of estimate_sent that became booked
 *   pipelineAtRisk       — $ sum of stale leads (>7d in any active stage)
 *   forecast14d          — weighted $ forecast for next 14 days
 *
 * All numbers are computed client-side from a single interactions pull.
 * Cheap for orgs <10k active leads; would warrant a DB view at scale.
 */
export async function getPipelineHealth(windowDays = 30) {
  const windowStart = new Date(); windowStart.setDate(windowStart.getDate() - windowDays)
  const { data } = await supabase
    .from('interactions')
    .select('id, stage, estimated_value, hot_lead_started_at, estimate_sent_at, created_at, appointment_at')
    .gte('created_at', windowStart.toISOString())
    .not('stage', 'is', null)

  const rows = data || []
  const now  = Date.now()

  // Time-to-book: leads in 'booked' stage with a hot_lead_started_at
  // anchor. We average days from first interest to booked.
  const booked = rows.filter((r) => r.stage === 'booked' && r.hot_lead_started_at)
  const avgTimeToBookDays = booked.length === 0 ? null :
    booked.reduce((acc, r) => acc + (new Date(r.created_at).getTime() - new Date(r.hot_lead_started_at).getTime()), 0)
    / booked.length / 86_400_000

  // Conversion: estimate_sent → booked. Counts within the window.
  const totalEstimates = rows.filter((r) => r.stage === 'estimate_sent' || r.stage === 'booked').length
  const totalBooked    = rows.filter((r) => r.stage === 'booked').length
  const estimateToBookRate = totalEstimates === 0 ? null : (totalBooked / totalEstimates) * 100

  // At-risk $: active stages aged >7d (any anchor — fall back to created_at).
  const pipelineAtRisk = rows
    .filter((r) => ACTIVE_PIPELINE_STAGES.includes(r.stage))
    .filter((r) => {
      const anchor = r.estimate_sent_at || r.hot_lead_started_at || r.created_at
      return (now - new Date(anchor).getTime()) / 86_400_000 > 7
    })
    .reduce((acc, r) => acc + Number(r.estimated_value || 0), 0)

  // 14-day forecast: weighted by stage.
  // booked × 1.0, estimate_sent × 0.5, appt_scheduled × 0.3, hot_lead × 0.1.
  // Coarse but useful — managers care about direction, not 2-decimal accuracy.
  const stageWeights = { booked: 1.0, estimate_sent: 0.5, appt_scheduled: 0.3, hot_lead: 0.1 }
  const forecast14d = rows
    .filter((r) => ACTIVE_PIPELINE_STAGES.includes(r.stage))
    .reduce((acc, r) => acc + Number(r.estimated_value || 0) * (stageWeights[r.stage] || 0), 0)

  return {
    avgTimeToBookDays,
    estimateToBookRate,
    pipelineAtRisk,
    forecast14d,
    sampleSize: rows.length,
  }
}

/**
 * Closed/lost rollup for the collapsed section at the bottom of the
 * Pipeline tab. Returns counts by stage + top 3 lost reasons across the
 * window. Designed to give the manager just enough signal to decide
 * whether to expand into a full closed-deals view (which we'll build
 * when the data justifies it).
 */
export async function getClosedSummary(windowDays = 30) {
  const windowStart = new Date(); windowStart.setDate(windowStart.getDate() - windowDays)
  const { data } = await supabase
    .from('interactions')
    .select('stage, lost_reason')
    .in('stage', CLOSED_PIPELINE_STAGES)
    .gte('created_at', windowStart.toISOString())

  const rows = data || []
  const byStage  = {}
  const byReason = {}
  for (const r of rows) {
    byStage[r.stage]   = (byStage[r.stage]   || 0) + 1
    if (r.lost_reason) {
      byReason[r.lost_reason] = (byReason[r.lost_reason] || 0) + 1
    }
  }
  const topReasons = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => ({ reason, count }))
  return {
    notInterested: byStage.closed_not_interested || 0,
    lost:          byStage.closed_lost           || 0,
    stale:         byStage.closed_stale          || 0,
    topReasons,
    total: rows.length,
  }
}

// ──────────────────────────────────────────────────────────────────────────────

export async function getAllBookings(filters = {}) {
  const outcome = filters.outcome || 'booked'

  let query = supabase
    .from('interactions')
    .select('*, users(full_name)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (outcome === 'all') {
    query = query.in('outcome', ['booked', 'estimate_requested'])
  } else {
    query = query.eq('outcome', outcome)
  }

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

// ── Organization services ───────────────────────────────────────────────────
//
// The list of offerings a company sells (e.g. "Window Cleaning", "HVAC
// Tune-Up", "Solar Consultation"). Managers manage this list from
// Settings; reps see it as the chip selector in InteractionModal when
// booking a job. Org-scoped via RLS + an explicit org filter on reads
// (same belt-and-suspenders pattern as getTerritories).

/** Fetch all services for the caller's org, ordered for display. */
export async function getOrgServices() {
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const { data, error } = await supabase
    .from('organization_services')
    .select('id, label, sort_order')
    .eq('organization_id', orgId)
    .order('sort_order', { ascending: true })
    .order('label',      { ascending: true })
  if (error) {
    console.warn('[getOrgServices] query failed:', error)
    return []
  }
  return data || []
}

/**
 * Add a service. Returns { data, error } so callers can surface a
 * friendly inline message for the case-insensitive unique-violation
 * (Postgres error code 23505) — that's the "you already added this"
 * path the Settings UI needs to render gracefully.
 */
export async function createOrgService(label) {
  const orgId = await getMyOrgId()
  if (!orgId) return { data: null, error: new Error('No organization') }
  const trimmed = (label || '').trim()
  if (!trimmed) return { data: null, error: new Error('Service name is required') }
  // Place new services at the end of the list. We could compute max+1
  // server-side via an RPC but a tiny client-side read keeps this
  // simple and the race (two managers adding at once) just produces
  // equal sort_orders, which fall back to alphabetical at query time.
  const existing = await getOrgServices()
  const nextSort = existing.length > 0
    ? Math.max(...existing.map((s) => s.sort_order || 0)) + 1
    : 0
  const { data, error } = await supabase
    .from('organization_services')
    .insert({ organization_id: orgId, label: trimmed, sort_order: nextSort })
    .select('id, label, sort_order')
    .single()
  return { data, error }
}

export async function updateOrgService(id, { label, sortOrder } = {}) {
  const updates = {}
  if (label !== undefined)     updates.label      = (label || '').trim()
  if (sortOrder !== undefined) updates.sort_order = sortOrder
  if (Object.keys(updates).length === 0) return { data: null, error: null }
  if (updates.label === '') return { data: null, error: new Error('Service name is required') }
  const { data, error } = await supabase
    .from('organization_services')
    .update(updates)
    .eq('id', id)
    .select('id, label, sort_order')
    .single()
  return { data, error }
}

export async function deleteOrgService(id) {
  const { error } = await supabase
    .from('organization_services')
    .delete()
    .eq('id', id)
  return { error }
}

// ─── Team Chat ───────────────────────────────────────────────────────────────
//
// All chat reads/writes go through the public.chat_* tables (see
// 20260603_team_chat.sql). RLS handles org/participant scoping — the
// helpers below never need to filter by organization themselves.
//
// Three tables:
//   chat_conversations  — one row per thread (team channel + each DM)
//   chat_participants   — who's in a thread + per-user last_read_at
//   chat_messages       — message rows; realtime publication is on this one
//
// Inbox-style reads (listMyConversations) intentionally fan out into a few
// small client-side queries instead of an RPC, so the surface stays
// readable. Org sizes are small (typically < 50 users) so the round-trip
// math holds; revisit when a team starts pushing 500+ conversations.

/**
 * Compute the deterministic DM dedupe key for a pair of user ids.
 * Mirrors the partial unique index on chat_conversations.dm_key —
 * if both clients try to create the same DM at the same time, one
 * write wins and the loser falls through to the SELECT below.
 */
function dmKeyFor(a, b) {
  return [String(a), String(b)].sort().join('|')
}

/**
 * Resolve the org's team conversation id, creating it if missing.
 * The DB trigger seeds one on org insert, but we keep the lazy path
 * here in case an older org somehow slipped through the backfill.
 */
export async function ensureTeamConversation() {
  const orgId = await getMyOrgId()
  if (!orgId) return null
  const { data: existing } = await supabase
    .from('chat_conversations')
    .select('id')
    .eq('organization_id', orgId)
    .eq('type', 'team')
    .maybeSingle()
  if (existing?.id) return existing.id
  // Lazy bootstrap — call the DB function so the team-channel + members
  // get seeded atomically. Returns the conversation id.
  const { data, error } = await supabase
    .rpc('chat_ensure_team_conversation_for_org', { p_org: orgId })
  if (error) return null
  return data
}

/**
 * Get or create a 1:1 DM conversation with another user in the same org.
 *
 * Delegates to the chat_get_or_create_dm RPC so the conversation row +
 * both participant rows are created in one transaction. We tried doing
 * this client-side (insert → select-back → upsert participants) but ran
 * into a chicken-and-egg with RLS: the post-insert SELECT couldn't see
 * the new conversation because no participants existed yet, so the call
 * silently returned null. The RPC is SECURITY DEFINER and atomic, so the
 * caller just gets the conversation id back.
 *
 * Returns { id, error } so callers can surface the failure mode instead
 * of swallowing it silently — the "nothing happens when I tap a name"
 * bug was caused by us discarding the error on the client.
 */
export async function getOrCreateDM(otherUserId) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { id: null, error: new Error('Not signed in') }
  }
  if (!otherUserId || user.id === otherUserId) {
    return { id: null, error: new Error('Invalid recipient') }
  }
  const { data, error } = await supabase
    .rpc('chat_get_or_create_dm', { p_other: otherUserId })
  if (error) {
    // Useful breadcrumb for DevTools. Without this the failure mode was
    // invisible — startDM would early-return and the picker would do
    // nothing on tap.
    // eslint-disable-next-line no-console
    console.error('[chat] chat_get_or_create_dm failed', error)
    return { id: null, error }
  }
  if (!data) {
    return { id: null, error: new Error('No conversation id returned') }
  }
  return { id: data, error: null }
}

/**
 * Inbox: every conversation the user is in, with last-message preview,
 * unread count, and (for DMs) the other participant's profile.
 *
 * Shape:
 *   [{
 *     id, type, name, last_message_at,
 *     last_message: { body, sender_id, created_at } | null,
 *     unread,                         // integer
 *     other_user: { id, full_name, email } | null,   // DMs only
 *     participant_count,
 *   }]
 *
 * Sorted by last_message_at desc so the inbox reads as a recency feed.
 */
export async function listMyConversations() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  // My participation rows + the conversation columns we need.
  const { data: myParts } = await supabase
    .from('chat_participants')
    .select('conversation_id, last_read_at, chat_conversations ( id, type, name, last_message_at, organization_id )')
    .eq('user_id', user.id)
  const rows = (myParts || [])
    .map((p) => ({
      conversation_id: p.conversation_id,
      last_read_at:    p.last_read_at,
      conv:            p.chat_conversations,
    }))
    .filter((r) => r.conv)
  if (rows.length === 0) return []

  const convIds = rows.map((r) => r.conversation_id)

  // All participant rows for those conversations — we need them for DM
  // "other user" + member counts. One read, then group in JS.
  const { data: allParts } = await supabase
    .from('chat_participants')
    .select('conversation_id, user_id, users ( id, full_name, email )')
    .in('conversation_id', convIds)
  const partsByConv = {}
  for (const p of allParts || []) {
    if (!partsByConv[p.conversation_id]) partsByConv[p.conversation_id] = []
    partsByConv[p.conversation_id].push(p)
  }

  // Last-message preview for each conversation. We pull the most recent
  // ~120 messages across the user's conversations in one read and pick
  // the head per conversation in JS. Beats a per-conversation request
  // and still costs one round-trip.
  const { data: recentMsgs } = await supabase
    .from('chat_messages')
    .select('id, conversation_id, sender_id, body, created_at')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: false })
    .limit(Math.max(120, convIds.length * 3))
  const lastByConv = {}
  for (const m of recentMsgs || []) {
    if (!lastByConv[m.conversation_id]) lastByConv[m.conversation_id] = m
  }

  // Unread counts — one read per conversation but parallelized. We use
  // head:true so the request only returns the count, not rows. This
  // could be batched with a SQL function later; for now it stays simple.
  const unreadByConv = {}
  await Promise.all(rows.map(async (r) => {
    let q = supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', r.conversation_id)
      // Don't count my own messages as "unread" — that's annoying when I
      // just sent something.
      .neq('sender_id', user.id)
    if (r.last_read_at) q = q.gt('created_at', r.last_read_at)
    const { count } = await q
    unreadByConv[r.conversation_id] = count || 0
  }))

  return rows
    .map((r) => {
      const allFor = partsByConv[r.conversation_id] || []
      const others = allFor.filter((p) => p.user_id !== user.id)
      return {
        id:              r.conv.id,
        type:            r.conv.type,
        name:            r.conv.name,
        last_message_at: r.conv.last_message_at,
        last_message:    lastByConv[r.conversation_id] || null,
        unread:          unreadByConv[r.conversation_id] || 0,
        other_user:      r.conv.type === 'dm' && others[0] ? others[0].users : null,
        participant_count: allFor.length,
      }
    })
    .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
}

/**
 * Fetch messages in a conversation, newest-first, paginated.
 * Caller can page back by passing `before` (created_at ISO) to load older.
 */
export async function getChatMessages(conversationId, { limit = 50, before = null } = {}) {
  if (!conversationId) return []
  let q = supabase
    .from('chat_messages')
    .select('id, conversation_id, sender_id, body, created_at, users:sender_id ( full_name, email )')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (before) q = q.lt('created_at', before)
  const { data } = await q
  // UI rendering is easier oldest→newest, so reverse before returning.
  return (data || []).reverse()
}

/**
 * Send a message. Body is trimmed; empty/whitespace-only sends are a no-op.
 * Returns the inserted row so the client can echo without waiting for the
 * realtime broadcast to fan out.
 */
export async function sendChatMessage(conversationId, body) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('Not signed in') }
  const trimmed = (body || '').trim()
  if (!trimmed) return { data: null, error: new Error('Message is empty') }
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ conversation_id: conversationId, sender_id: user.id, body: trimmed })
    .select('id, conversation_id, sender_id, body, created_at, users:sender_id ( full_name, email )')
    .single()
  return { data, error }
}

/**
 * Bump the user's last_read_at to now() for a conversation. Drives the
 * unread badge on next inbox refresh / realtime tick.
 */
export async function markChatRead(conversationId) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !conversationId) return
  await supabase
    .from('chat_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)
}

/**
 * Realtime subscription to new messages in a single conversation.
 * Returns the channel — caller MUST call supabase.removeChannel(channel)
 * on unmount or the connection leaks.
 *
 * Filter is server-side (conversation_id = ?) so other conversations'
 * traffic never touches this socket.
 */
export function subscribeToChatMessages(conversationId, onInsert) {
  if (!conversationId) return null
  const channel = supabase
    .channel(`chat:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onInsert?.(payload.new)
    )
    .subscribe()
  return channel
}

/**
 * Realtime subscription that fires when a message lands in ANY
 * conversation the user is in. Used by the header chat icon to update
 * the unread badge without a poll. Server-side filter on the table is
 * impossible (we don't know the participant set at filter time), so
 * the callback receives every new message and the caller decides
 * whether it affects them — cheap because chat traffic is low volume.
 */
export function subscribeToChatInbox(onChange) {
  const channel = supabase
    .channel('chat:inbox')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages' },
      (payload) => onChange?.(payload.new)
    )
    .subscribe()
  return channel
}

/**
 * Roster for the "new DM" picker — everyone in the user's org except
 * themselves. Sorted by name. Returns minimal columns.
 */
export async function listOrgTeammates() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const { data } = await supabase
    .from('users')
    .select('id, full_name, email, role')
    .eq('organization_id', orgId)
    .neq('id', user.id)
    .order('full_name', { ascending: true, nullsFirst: false })
  return data || []
}
