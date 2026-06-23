import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'

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

export async function signInWithEmail(email, password, { captchaToken } = {}) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    // Only sent when Turnstile is configured (VITE_TURNSTILE_SITE_KEY). Supabase
    // verifies it server-side via the secret key set under Auth → Attack
    // Protection; harmless to omit when captcha isn't enabled.
    ...(captchaToken ? { options: { captchaToken } } : {}),
  })
  return { data, error }
}

export async function signUpWithEmail(email, password, fullName, { captchaToken } = {}) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      ...(captchaToken ? { captchaToken } : {}),
    },
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
    // On native iOS/Android, redirecting to the marketing site would
    // either fail (no http origin) or kick the user out of the app into
    // mobile Safari. Instead, hop to the in-app /login route — the
    // AuthProvider has already cleared the session above, so the React
    // tree re-renders into the unauthenticated routes branch.
    if (Capacitor.isNativePlatform()) {
      window.location.replace('/login')
      return
    }
    // Web: use replace() so the back button can't bounce the user back
    // into an authenticated route after they've signed out. Send signed-
    // out users to the public marketing welcome page rather than the
    // bare login screen. We point at the site root (not /welcome.html)
    // so the address bar shows a clean "www.getknockiq.com" — the
    // vercel.json rewrite { "src": "/", "dest": "/welcome.html" } serves
    // the welcome content there.
    window.location.replace('https://www.getknockiq.com/')
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

/**
 * Send a password-reset email to the given address.
 *
 * redirectTo points at the dedicated /reset-password screen (NOT "/").
 * GoTrue mints a one-time recovery link; after the user taps it, GoTrue
 * verifies and lands them on `/reset-password#access_token=…&type=recovery`,
 * where detectSessionInUrl establishes a (recovery) session and the
 * ResetPassword screen prompts them to choose a new password. Redirecting
 * to "/" instead would silently sign them in and never let them set one —
 * defeating the whole point of the reset.
 *
 * Supabase deliberately returns no error for unknown emails (anti-
 * enumeration), so callers should always show the same "check your inbox"
 * confirmation regardless of the result.
 */
export async function sendPasswordReset(email) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
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
  // A door logged as a hot lead / booked enters a notifiable phase on insert
  // (a DB trigger maps outcome→stage), so fan out to any subscribed managers.
  // Best-effort; never blocks or fails the door log.
  if (!error && data) notifySubscribedManagers(data.id, data.stage)
  return { data, error }
}

/**
 * Delete a single interaction row. Used by the "Undo" action on an
 * auto-detected knock — the detector optimistically writes a no_answer
 * row (so the gray pin drops instantly), and Undo removes that row when
 * the rep flags the detection as a false positive.
 */
export async function deleteInteraction(interactionId) {
  if (!interactionId) return { error: null }
  const { error } = await supabase
    .from('interactions')
    .delete()
    .eq('id', interactionId)
  return { error }
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
 * Itemized commission inputs for one rep: their booked jobs (which actually
 * drive commission) plus still-open estimate requests (unbooked) within a
 * window. Powers the Commission breakdown drawer on the rep dashboard and the
 * manager's rep-detail screen.
 *
 * Source of truth is `interactions` (same as the bookings/pipeline views). We
 * scope by organization_id as well as rep_id so the planner index-scans
 * straight to the rep's rows instead of scanning then RLS-filtering. RLS still
 * applies: a rep reads their own rows; a manager/owner reads same-org reps.
 *
 * `days` = number → only rows created in the last N days (matches the
 * dashboard's rolling Week/Month windows). Pass null for lifetime.
 */
export async function getRepCommissionItems(repId, { days = null } = {}) {
  const empty = { booked: [], pending: [] }
  if (!repId) return empty
  const orgId = await getMyOrgId()
  if (!orgId) return empty

  const cols = 'id, outcome, stage, address, contact_name, estimated_value, service_line_items, created_at, booked_at, appointment_at'

  // Booked jobs — the payroll basis. A job counts in the period it became
  // booked (booked_at), NOT when the door was first knocked. `stage='booked'`
  // is the universal "is booked" signal: door bookings set it at the door,
  // pipeline conversions set it when advanced. booked_at is stamped by the
  // set_interaction_booked_at trigger either way.
  let bq = supabase
    .from('interactions')
    .select(cols)
    .eq('organization_id', orgId)
    .eq('rep_id', repId)
    .eq('stage', 'booked')
    .order('booked_at', { ascending: false })
    .limit(500)
  if (days != null) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
    bq = bq.gte('booked_at', since)
  }

  // Open estimates — money still on the table RIGHT NOW (not period-bound):
  // an estimate/appointment was requested and the deal is still in an active,
  // not-yet-booked pipeline stage. This is the "pending, unbooked" callout.
  const pq = supabase
    .from('interactions')
    .select(cols)
    .eq('organization_id', orgId)
    .eq('rep_id', repId)
    .eq('outcome', 'estimate_requested')
    .in('stage', ['hot_lead', 'appt_scheduled', 'estimate_sent'])
    .order('created_at', { ascending: false })
    .limit(500)

  const [bRes, pRes] = await Promise.all([bq, pq])
  if (bRes.error) console.warn('[Commission] booked fetch failed', bRes.error.message)
  if (pRes.error) console.warn('[Commission] pending fetch failed', pRes.error.message)
  return { booked: bRes.data || [], pending: pRes.data || [] }
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
 * Wraps the `provision_new_organization(business_name, selected_plan)` SECURITY
 * DEFINER RPC which (1) inserts the org row on the Pro tier (reverse trial)
 * with status='trial' + a 14-day trial window and the caller's selected_plan,
 * and (2) stamps the caller's public.users row with the new org id + role='manager'.
 * Idempotent: if the caller already has an org, returns the existing id.
 */
export async function provisionNewOrganization(businessName, selectedPlan = 'standard') {
  const { data, error } = await supabase.rpc('provision_new_organization', {
    business_name: businessName,
    selected_plan: selectedPlan === 'pro' ? 'pro' : 'standard',
  })
  return { data, error }
}

/**
 * Credit a growth-manager referral (and apply any offer) for the org the
 * caller just provisioned. Server-side (SECURITY DEFINER): it derives the
 * org from the authenticated owner, matches `ref` to an active growth
 * manager's referral_code (idempotent — one attribution per org), and if a
 * valid `offer` slug is supplied, stamps the org's trial_days_override so
 * checkout grants the longer free trial. Best-effort: a missing/unknown code
 * is a no-op and must never block signup. Returns the RPC payload or {error}.
 */
export async function applyGrowthReferral(ref, offer = null) {
  if (!ref) return { skipped: true }
  try {
    const { data, error } = await supabase.rpc('growth_apply_referral', {
      p_ref: ref, p_offer: offer || null,
    })
    if (error) return { error }
    return data || {}
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) }
  }
}

/**
 * Fire the send-welcome edge function for the just-provisioned owner.
 * Best-effort: a missed welcome email must never block signup, so this
 * swallows every failure and returns it for optional logging. Call it
 * AFTER provisionNewOrganization succeeds and a session exists.
 */
export async function sendWelcomeEmail() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return { sent: false, error: 'no session' }
    const res = await fetch(`${supabaseUrl}/functions/v1/send-welcome`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({}),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return { sent: false, error: data?.error || `HTTP ${res.status}` }
    return data
  } catch (err) {
    return { sent: false, error: err?.message || String(err) }
  }
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
 * Toggle the Pro-only commission tracking add-on for an org. When false,
 * reps don't see commission/total-pay and the manager can't edit rates.
 */
export async function setOrgCommissionEnabled(orgId, enabled) {
  const { data, error } = await supabase
    .from('organizations')
    .update({ commission_enabled: !!enabled })
    .eq('id', orgId)
    .select()
    .single()
  return { data, error }
}

/**
 * Toggle whether individual reps can see the team leaderboard bar-chart on
 * their dashboard. Manager opt-in, off by default. The leaderboard data is
 * already same-org readable; this only governs the rep-facing UI.
 */
export async function setOrgShareLeaderboard(orgId, enabled) {
  const { data, error } = await supabase
    .from('organizations')
    .update({ share_leaderboard: !!enabled })
    .eq('id', orgId)
    .select()
    .single()
  return { data, error }
}

/**
 * Toggle whether the shared leaderboard hides the Revenue ($) metric from reps.
 * Only meaningful when share_leaderboard is on. Off by default (revenue shown).
 */
export async function setOrgLeaderboardHideRevenue(orgId, hidden) {
  const { data, error } = await supabase
    .from('organizations')
    .update({ leaderboard_hide_revenue: !!hidden })
    .eq('id', orgId)
    .select()
    .single()
  return { data, error }
}

/**
 * Toggle the Pro-only Roof Insights (Google Solar) add-on for an org. Off by
 * default so no billable Solar lookup happens unless a manager opts in.
 */
export async function setOrgRoofInsightsEnabled(orgId, enabled) {
  const { data, error } = await supabase
    .from('organizations')
    .update({ roof_insights_enabled: !!enabled })
    .eq('id', orgId)
    .select()
    .single()
  return { data, error }
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
export async function updateOrganizationGoal(orgId, { type, value, countLabel, monthlyGoal, closeRateGoal }) {
  const patch = {}
  if (type        !== undefined) patch.daily_goal_type    = type
  if (value       !== undefined) patch.daily_goal_value   = value
  if (countLabel  !== undefined) patch.count_goal_label   = countLabel
  // Manager-declared Close Rate target (percent). Close rate is measured as
  // conversation → booked job (bookings ÷ conversations). Pass null to clear
  // and fall back to the 5.0% client default on the Close Rate gauge.
  if (closeRateGoal !== undefined) {
    patch.close_rate_goal =
      closeRateGoal === null || closeRateGoal === '' ? null : Number(closeRateGoal)
  }
  // Optional manager-set monthly team target. Independent of the daily
  // goal — the daily goal is a per-rep yardstick, while monthly_goal_value
  // is the team-wide number to hit. Pass null to clear and fall back to
  // the auto-calculated (daily × periodDays) heuristic. Why we added this:
  // multiplying the per-rep daily goal by 30 over-counts for solo orgs or
  // teams that don't canvass every day — the manager knows the right
  // monthly number better than any extrapolation we can do.
  if (monthlyGoal !== undefined) {
    patch.monthly_goal_value =
      monthlyGoal === null || monthlyGoal === '' ? null : Number(monthlyGoal)
  }
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
 * Platform engagement metrics for the super-admin dashboard.
 *
 * Two things product owners actually care about:
 *   1. Are reps showing up?  → DAU / WAU / MAU + stickiness (DAU÷MAU).
 *   2. Are they doing the work well?  → the canvassing funnel
 *      (doors → conversations → estimates → bookings → revenue).
 *
 * "Active" = a rep who started ≥1 canvassing session in the window.
 * Stickiness is the classic "do they come back daily" ratio: of the reps
 * active in the last 30 days, what share were active today. Both the funnel
 * and the active-rep counts reuse `canvassing_sessions` — the same table the
 * org-insights summary already reads — so no new tables or columns needed.
 *
 * Returns {
 *   dau, wau, mau,            // distinct active reps in 1 / 7 / 30 days
 *   stickiness,               // 0–100 %, dau ÷ mau
 *   dauByDay: [{date, count}] // 30 daily points, oldest → newest (sparkline)
 *   funnel: {
 *     doors, conversations, estimates, bookings, revenue,
 *     rates: { convFromDoors, estFromConv, bookFromEst }  // 0–100 %
 *   },
 *   windowDays                // funnel/active window (30)
 * }
 */
export async function getPlatformEngagement() {
  const now     = Date.now()
  const DAY     = 86400000
  const since30 = new Date(now - 30 * DAY).toISOString()

  const { data: sessions } = await supabase
    .from('canvassing_sessions')
    .select('rep_id, started_at, doors_knocked, conversations, estimates, bookings, revenue_booked')
    .gte('started_at', since30)

  const rows = sessions || []

  // ── Active reps by window (distinct rep_id) ──────────────────────────────
  const dayKey   = (t) => new Date(t).toISOString().slice(0, 10)
  const todayKey = dayKey(now)
  const sevenAgo = now - 7 * DAY

  const dauSet = new Set()   // active today
  const wauSet = new Set()   // active last 7 days
  const mauSet = new Set()   // active last 30 days
  const byDay  = {}          // dateKey → Set(rep_id)

  for (const s of rows) {
    if (!s.rep_id) continue
    const t = new Date(s.started_at).getTime()
    mauSet.add(s.rep_id)
    if (t >= sevenAgo) wauSet.add(s.rep_id)
    const k = dayKey(t)
    if (k === todayKey) dauSet.add(s.rep_id)
    ;(byDay[k] ||= new Set()).add(s.rep_id)
  }

  const dau = dauSet.size
  const wau = wauSet.size
  const mau = mauSet.size
  const stickiness = mau ? Math.round((dau / mau) * 100) : 0

  // 30-day daily-active series, gaps filled with 0 (oldest → newest).
  const dauByDay = []
  for (let i = 29; i >= 0; i--) {
    const k = dayKey(now - i * DAY)
    dauByDay.push({ date: k, count: byDay[k] ? byDay[k].size : 0 })
  }

  // ── Canvassing funnel (summed over the 30-day window) ────────────────────
  let doors = 0, conversations = 0, estimates = 0, bookings = 0, revenue = 0
  for (const s of rows) {
    doors         += s.doors_knocked || 0
    conversations += s.conversations || 0
    estimates     += s.estimates     || 0
    bookings      += s.bookings      || 0
    revenue       += Number(s.revenue_booked) || 0
  }
  const rate = (num, den) => den ? Math.round((num / den) * 100) : 0

  return {
    dau, wau, mau, stickiness,
    dauByDay,
    funnel: {
      doors, conversations, estimates, bookings, revenue,
      rates: {
        convFromDoors: rate(conversations, doors),
        estFromConv:   rate(estimates, conversations),
        bookFromEst:   rate(bookings, estimates),
      },
    },
    windowDays: 30,
  }
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
      service_types, estimated_value, service_line_items, notes, appointment_at,
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
// MANAGER PHASE NOTIFICATIONS (Phase 6)
//
// Maps a pipeline stage to the notification "phase" managers subscribe to.
// 'appointment' deliberately spans both appt_scheduled and estimate_sent —
// the Managers UI offers them as one combined toggle. Non-notifiable stages
// (closed_*, null) map to null and never dispatch.
// ──────────────────────────────────────────────────────────────────────────────
export const PHASE_FOR_STAGE = {
  hot_lead:       'hot_lead',
  appt_scheduled: 'appointment',
  estimate_sent:  'appointment',
  booked:         'booked',
}

/**
 * Fire the notify-managers edge function for a lead that just entered a
 * notifiable phase. Best-effort and fire-and-forget: a missed manager email
 * must never roll back the lead change that triggered it. No-ops silently
 * when the stage isn't notifiable or there's no session.
 *
 * Centralized here (not in components) and called from the data-layer
 * chokepoints — logInteraction, updateLeadStage, updateLeadAppointment — so
 * every path that moves a lead notifies subscribers. This structural
 * placement is the fix for the "missed notify hook in one UI path" bug.
 */
export async function notifySubscribedManagers(interactionId, stage) {
  const phase = PHASE_FOR_STAGE[stage]
  if (!interactionId || !phase) return { delivered: false, reason: 'not-a-notifiable-phase' }
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return { delivered: false, error: 'no session' }
    const res = await fetch(`${supabaseUrl}/functions/v1/notify-managers`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ interactionId, phase }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return { delivered: false, error: data?.error || `HTTP ${res.status}` }
    return data
  } catch (err) {
    return { delivered: false, error: err?.message || String(err) }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// MANAGER ROSTER (Phase 6) — owner manages the manager team + their
// pipeline-phase email subscriptions. Two tiers mirror the closer model:
//   • platform (public.users role='manager')  — dashboard login + seat
//   • email-only (manager_contacts)            — notifications only, no seat
// All of these are owner-gated (RLS on manager_contacts; manage-team owner
// check for platform managers).
// ──────────────────────────────────────────────────────────────────────────────

// The three subscribable phases. 'appointment' = appt_scheduled OR
// estimate_sent (combined toggle). Keep in sync with PHASE_FOR_STAGE and the
// migration CHECK constraints.
export const MANAGER_NOTIFY_PHASES = ['hot_lead', 'appointment', 'booked']

function sanitizePhases(arr) {
  if (!Array.isArray(arr)) return []
  return [...new Set(arr.filter((p) => MANAGER_NOTIFY_PHASES.includes(p)))]
}

/**
 * List every manager in the caller's org as one unified array with a `tier`
 * discriminator and an `is_owner` flag (the owner row can't be deleted).
 * Owner is sorted first, then alphabetical. Promoted email-only managers are
 * excluded (parity with getAllClosersUnified).
 */
export async function getAllManagersUnified() {
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const [orgRes, platformRes, contactRes] = await Promise.all([
    supabase.from('organizations').select('owner_user_id').eq('id', orgId).maybeSingle(),
    supabase
      .from('users')
      .select('id, full_name, email, phone, manager_notify_phases, commission_config')
      .eq('role', 'manager')
      .eq('organization_id', orgId)
      .order('full_name'),
    supabase
      .from('manager_contacts')
      .select('id, full_name, email, phone, notify_phases')
      .eq('organization_id', orgId)
      .is('promoted_to_user_id', null)
      .order('full_name'),
  ])
  const ownerId = orgRes?.data?.owner_user_id || null
  const platformRows = (platformRes.data || []).map((u) => ({
    tier:              'platform',
    id:                u.id,
    full_name:         u.full_name,
    email:             u.email,
    phone:             u.phone,
    notify_phases:     u.manager_notify_phases || [],
    // Surfaced so the owner can set a knocking manager's pay rule right from
    // the Managers screen. Email-only managers never canvass, so they don't
    // carry one.
    commission_config: u.commission_config || null,
    is_owner:          u.id === ownerId,
  }))
  const contactRows = (contactRes.data || []).map((c) => ({
    tier:          'contact',
    id:            c.id,
    full_name:     c.full_name,
    email:         c.email,
    phone:         c.phone,
    notify_phases: c.notify_phases || [],
    is_owner:      false,
  }))
  return [...platformRows, ...contactRows].sort((a, b) => {
    if (a.is_owner !== b.is_owner) return a.is_owner ? -1 : 1
    return (a.full_name || '').localeCompare(b.full_name || '')
  })
}

/**
 * Create a platform manager (full dashboard login, consumes a seat). Same
 * manage-team endpoint as reps/closers, role hard-coded. The endpoint gates
 * this to the org owner — a non-owner caller gets a 403.
 */
export async function createManager({ fullName, email, phone, mode = 'invite', password }) {
  return createRep({ fullName, email, phone, mode, password, role: 'manager' })
}

/**
 * Create an email-only manager (manager_contacts row). No auth user, no
 * seat — they only receive the pipeline-phase emails they're subscribed to.
 */
export async function createManagerContact({ fullName, email, phone, notifyPhases = [] }) {
  const orgId = await getMyOrgId()
  if (!orgId) return { data: null, error: new Error('No organization') }
  if (!fullName || !email) return { data: null, error: new Error('Name + email required') }
  const { data, error } = await supabase
    .from('manager_contacts')
    .insert({
      organization_id: orgId,
      full_name:       fullName.trim(),
      email:           email.trim(),
      phone:           phone?.trim() || null,
      notify_phases:   sanitizePhases(notifyPhases),
    })
    .select()
    .single()
  return { data, error }
}

/** Patch an email-only manager. Accepts fullName, email, phone, notifyPhases. */
export async function updateManagerContact(contactId, patch = {}) {
  const upd = {}
  if (patch.fullName     !== undefined) upd.full_name     = patch.fullName?.trim()
  if (patch.email        !== undefined) upd.email         = patch.email?.trim()
  if (patch.phone        !== undefined) upd.phone         = patch.phone?.trim() || null
  if (patch.notifyPhases !== undefined) upd.notify_phases = sanitizePhases(patch.notifyPhases)
  const { data, error } = await supabase
    .from('manager_contacts')
    .update(upd)
    .eq('id', contactId)
    .select()
    .single()
  return { data, error }
}

/** Remove an email-only manager. */
export async function deleteManagerContact(contactId) {
  const { error } = await supabase.from('manager_contacts').delete().eq('id', contactId)
  return { error: error || null }
}

/**
 * Remove a platform manager (owner-only, enforced in manage-team; the owner
 * themselves can't be removed this way).
 */
export async function deleteManagerUser(userId) {
  const { error } = await callManageTeam({ action: 'delete', repId: userId })
  return { error: error || null }
}

/**
 * Update a platform manager's phase subscriptions. RLS lets a manager update
 * users in their own org (and their own row), so the owner can toggle any
 * manager's subscriptions and a manager can toggle their own.
 *
 *   phases : array subset of MANAGER_NOTIFY_PHASES
 */
export async function updateManagerNotifyPhases(userId, phases) {
  const { data, error } = await supabase
    .from('users')
    .update({ manager_notify_phases: sanitizePhases(phases) })
    .eq('id', userId)
    .select('id, manager_notify_phases')
    .single()
  return { data, error }
}

/**
 * List reps in the caller's org that the owner could promote to
 * manager. Same shape as getAllReps but only what the picker needs.
 * Server-side RLS already scopes to the caller's org; we still
 * .eq('organization_id', orgId) so super-admin sessions don't pull
 * a cross-org roster.
 */
export async function getPromotableReps() {
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, phone')
    .eq('role', 'rep')
    .eq('organization_id', orgId)
    .order('full_name')
  if (error) {
    console.warn('[getPromotableReps] query failed:', error)
    return []
  }
  return data || []
}

/**
 * Promote an existing rep to platform manager. Owner-only — the RPC
 * enforces this server-side, so a non-owner caller gets a clear
 * error back instead of a silently-failed write.
 */
export async function promoteRepToManager(userId) {
  const { error } = await supabase.rpc('change_user_role', {
    target_user_id: userId,
    new_role:       'manager',
  })
  return { error: error || null }
}

/**
 * Demote a platform manager back to rep. Same RPC, opposite
 * direction. Owner protected server-side — calling on the owner
 * raises. Caller can't demote themselves.
 */
export async function demoteManagerToRep(userId) {
  const { error } = await supabase.rpc('change_user_role', {
    target_user_id: userId,
    new_role:       'rep',
  })
  return { error: error || null }
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
  // Best-effort onboarding email so the contact knows leads will arrive by
  // email before the first one lands. Never blocks or fails the create — a
  // missed email shouldn't stop the manager from adding the closer.
  let emailSent = false
  let emailError = null
  if (!error && data?.id) {
    const r = await sendCloserOnboarding({ tier: 'contact', id: data.id })
    emailSent  = !!r?.sent
    emailError = r?.sent ? null : (r?.email_error || r?.error || null)
  }
  return { data, error, emailSent, emailError }
}

/**
 * Fire the send-closer-onboarding edge function for a newly added closer.
 * `tier` is 'contact' (email-only closer_contacts row) or 'platform'
 * (public.users role='closer'). Best-effort: swallows failures and returns
 * them for optional toasting.
 */
export async function sendCloserOnboarding({ tier, id }) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return { sent: false, error: 'no session' }
    const payload = tier === 'platform'
      ? { closerUserId: id }
      : { closerContactId: id }
    const res = await fetch(`${supabaseUrl}/functions/v1/send-closer-onboarding`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return { sent: false, error: data?.error || `HTTP ${res.status}` }
    return data
  } catch (err) {
    return { sent: false, error: err?.message || String(err) }
  }
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
 * estimated_value is the single source of truth for "the price" — the
 * Pipeline kanban, calendar, KPIs, forecast, Overview, and Bookings list
 * all read it. A lead may ALSO carry an itemized per-service breakdown
 * (service_line_items) that is supposed to sum to estimated_value. When a
 * manager overrides the lump-sum total here, that breakdown no longer
 * matches the new number, so leaving it in place makes the itemized "Total"
 * shown in the lead pop-up, the closer inbox, and the Bookings list keep
 * adding up to the OLD price — the "edited price didn't carry over to other
 * pages" bug. We therefore clear service_line_items on a lump-sum override
 * so every surface falls back to the one authoritative total. (Callers that
 * want to keep a breakdown should edit it via the interaction modal, which
 * writes estimated_value and service_line_items together.)
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
    .update({ estimated_value: v, service_line_items: null })
    .eq('id', leadId)
    .select()
    .single()
  return { data, error }
}

/**
 * Update a lead's ITEMIZED per-service breakdown and re-derive the headline
 * total from it in the same write — the keep-the-breakdown counterpart to
 * updateLeadPrice's lump-sum override.
 *
 * Managers edit per-service prices in the Pipeline drill-down; we recompute
 * estimated_value = sum(line item prices) so the authoritative total that
 * every other surface reads (kanban, KPIs, forecast, Overview, Bookings)
 * stays in lock-step with the breakdown. Writing both columns together is
 * what guarantees the edited price carries over to all pages.
 *
 *   leadId    : interactions.id
 *   lineItems : array of { service, price } — non-numeric prices coerce to 0,
 *               negatives are rejected. An empty array clears the breakdown
 *               and nulls the total (same shape as "no estimate yet").
 */
export async function updateLeadLineItems(leadId, lineItems) {
  if (!Array.isArray(lineItems)) {
    return { data: null, error: new Error('Invalid line items') }
  }
  const items = []
  for (const li of lineItems) {
    if (!li || li.service == null || String(li.service).trim() === '') continue
    const price = Number(li.price)
    if (Number.isNaN(price) || price < 0) {
      return { data: null, error: new Error(`Invalid price for "${li.service}"`) }
    }
    items.push({ service: String(li.service).trim(), price })
  }
  const total = items.reduce((sum, li) => sum + li.price, 0)
  const { data, error } = await supabase
    .from('interactions')
    .update({
      service_line_items: items.length ? items : null,
      estimated_value:    items.length ? total : null,
    })
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
  const promotedToApptScheduled = Boolean(isoOrNull && current?.stage === 'hot_lead')
  if (promotedToApptScheduled) {
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
  // Only notify when this edit actually promoted the lead into a new phase
  // (Hot Lead → Appt Scheduled). Editing the time on an already-scheduled
  // lead must not re-fire the email.
  if (!error && data && promotedToApptScheduled) notifySubscribedManagers(data.id, data.stage)
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
  // The lead just changed stage — notify any managers subscribed to the new
  // phase. notifySubscribedManagers no-ops for non-notifiable stages
  // (closed_lost, etc.), so this is safe to call unconditionally on success.
  if (!error && data) notifySubscribedManagers(data.id, data.stage)
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

// ── Organization lifecycle (pause / resume / cancel / delete) ─────────────────
//
// Owner-only account controls surfaced in Settings → Account. All four run
// through the same manage-team edge function as rep management (it already
// owns the manager-auth gate + service-role client); the function enforces
// that the caller is the org OWNER, not just any manager. See the
// 20260604_org_lifecycle migration for the data model.
//
// State machine:
//   active/trial ──pause──▶ paused ──(resume | auto-resume@resume_at)──▶ active
//   active/trial ──cancel─▶ cancelled ──(reactivate within 90d | purge@purge_at)
//   any ──delete──▶ (gone)   ← irreversible, typed-confirm in the UI

/**
 * Pause the org for the off-season. Billing drops to the keep-warm fee
 * (stored on the org; not auto-charged until Stripe is wired) and all data
 * is retained. Auto-resumes on `resumeAt` if provided.
 *
 *   pauseOrganization({ resumeAt: '2026-09-01', reason: 'seasonal' })
 *
 * @param {{ resumeAt?: string|Date|null, reason?: string|null }} opts
 * @returns {Promise<{ organization?: object, error: Error|null }>}
 */
export async function pauseOrganization({ resumeAt = null, reason = null } = {}) {
  const { data, error } = await callManageTeam({
    action:   'pause_org',
    resumeAt: resumeAt ? new Date(resumeAt).toISOString() : null,
    reason,
  })
  return { organization: data?.organization || null, error: error || null }
}

/**
 * Manually un-pause (owner came back early). Flips straight to active.
 * @returns {Promise<{ organization?: object, error: Error|null }>}
 */
export async function resumeOrganization() {
  const { data, error } = await callManageTeam({ action: 'resume_org' })
  return { organization: data?.organization || null, error: error || null }
}

/**
 * Cancel the subscription. Billing stops and the org is soft-deleted, but
 * data is kept for a 90-day grace window so a seasonal owner can reactivate
 * before anything is purged. Reversible until purge_at.
 *
 * @param {{ reason?: string|null }} opts
 * @returns {Promise<{ organization?: object, error: Error|null }>}
 */
export async function cancelOrganization({ reason = null } = {}) {
  const { data, error } = await callManageTeam({ action: 'cancel_org', reason })
  return { organization: data?.organization || null, error: error || null }
}

/**
 * Permanently delete the organization and every member account. Irreversible
 * — destroys auth users and cascading data immediately, no grace window.
 * The caller's own session dies with it, so the UI should sign out / redirect
 * after a success.
 *
 * @returns {Promise<{ error: Error|null }>}
 */
export async function deleteOrganization() {
  const { error } = await callManageTeam({ action: 'delete_org' })
  return { error: error || null }
}

/**
 * Permanently delete the caller's own account and personal data. Required by
 * Apple Guideline 4 (apps that support account creation must offer in-app
 * account deletion) and Google Play's User Data Deletion policy.
 *
 * Behaviour:
 *  - For a non-owner (rep / closer / non-owner manager): deletes their
 *    public.users row and auth.users row. The org and other teammates are
 *    untouched. Sessions / interactions they own are kept on the org but
 *    detached (rep_id nulled) so historical stats survive.
 *  - For an org OWNER: same as deleteOrganization() — the org is destroyed
 *    along with the owner's account. There can only be one owner; the owner
 *    leaving means the business is gone. The UI should explain this clearly
 *    before calling.
 *
 * The caller's session terminates immediately on success — the calling code
 * should signOut() right after and redirect to /login (or just the welcome
 * page on web).
 *
 * Backed by the manage-team edge function ('delete_self' action). The edge
 * function does both the public.users / public.organizations cleanup AND the
 * auth.users delete via the service-role admin API (regular auth users
 * cannot delete themselves from auth.users — that requires the admin key).
 *
 * @returns {Promise<{ error: Error|null }>}
 */
export async function deleteMyAccount() {
  const { error } = await callManageTeam({ action: 'delete_self' })
  return { error: error || null }
}

// ── Checkout / billing (hosted Stripe Checkout + Customer Portal) ─────────────

/**
 * Start a hosted Stripe Checkout session for the current org and return the
 * redirect URL. plan ('standard'|'pro') and interval ('month'|'year') default
 * to the org's selected_plan / monthly when omitted.
 *
 * @returns {Promise<{ url: string|null, error: Error|null }>}
 */
export async function createCheckoutSession({ plan, interval, promo } = {}) {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', {
    body: { plan, interval, promo: promo || null },
  })
  if (error) return { url: null, error }
  if (data?.error) return { url: null, error: new Error(data.error) }
  return { url: data?.url || null, error: null }
}

/**
 * Open the Stripe Billing Portal for the org (manage card, invoices, plan).
 * @returns {Promise<{ url: string|null, error: Error|null }>}
 */
export async function createPortalSession() {
  const { data, error } = await supabase.functions.invoke('create-portal-session', { body: {} })
  if (error) return { url: null, error }
  if (data?.error) return { url: null, error: new Error(data.error) }
  return { url: data?.url || null, error: null }
}

/**
 * Switch the org's plan between 'standard' and 'pro' on its existing Stripe
 * subscription (owner-only; enforced server-side in the change-plan function).
 *
 * Behavior is decided server-side, not here:
 *   • Upgrade standard→pro: immediate, prorated difference on next invoice.
 *   • Downgrade pro→standard: keeps Pro features until the next renewal, then
 *     drops to Standard (no proration/credit).
 *   • During a trial: only changes the post-trial plan.
 *   • Orgs without a subscription (demo/grandfathered): DB-only tier flip.
 *
 * Returns { data, error } where data.applied describes what happened
 * ('upgrade_immediate' | 'downgrade_scheduled' | 'downgrade_cancelled' |
 *  'trial' | 'db_only' | 'noop') and data.effective_at (ISO) is set for a
 * scheduled downgrade so the UI can tell the owner when it takes effect.
 */
export async function changePlan(plan) {
  const target = plan === 'pro' ? 'pro' : 'standard'
  const { data, error } = await supabase.functions.invoke('change-plan', { body: { plan: target } })
  if (error) return { data: null, error }
  if (data?.error) return { data: null, error: new Error(data.error) }
  return { data, error: null }
}

/**
 * Recompute billable seats and push the quantity to the org's Stripe
 * subscription. Call after team changes that don't run through manage-team
 * (invite-link approve / reject). No-op until the org has a subscription.
 * @returns {Promise<{ error: Error|null }>}
 */
export async function syncSeats() {
  const { error } = await callManageTeam({ action: 'sync_seats' })
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

/**
 * Normalize a stored polygon into the simple `[[lat, lng], ...]` shape the
 * UI (TerritoryMap, per-zone metrics, rep map overlays) expects.
 *
 * The territories.polygon column is jsonb, so different seed paths have
 * historically dropped in three shapes:
 *   1. `[[lat, lng], ...]`             — what the in-app draw flow writes.
 *   2. `[[lng, lat], ...]`             — older seeds + anything GeoJSON-ish.
 *   3. `{type:'Polygon', coordinates:[[[lng, lat], ...]]}` — full GeoJSON
 *                                        (the current demo seed).
 *
 * Without this normalizer, shapes #2 and #3 render either nowhere (the
 * Leaflet polygon goes to lat=-82 which is off-globe) or in the wrong
 * hemisphere — which is exactly the "I don't see any drawn zones" report
 * the user hit. We do the conversion once at the data boundary so every
 * caller downstream can assume the simple shape.
 */
function normalizePolygon(raw) {
  if (!raw) return null
  // Shape #3: GeoJSON Polygon — pull the outer ring then fall through to
  // the per-point order check below.
  let ring = raw
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.coordinates)) {
    ring = raw.coordinates[0]
  }
  if (!Array.isArray(ring) || ring.length === 0) return null
  const out = []
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2) continue
    const [a, b] = p
    if (typeof a !== 'number' || typeof b !== 'number') continue
    // Latitude is bounded to ±90, longitude to ±180 — use that to detect
    // which order the seed used. If both numbers fit a valid lat, we
    // trust the in-app convention (`[lat, lng]`).
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      out.push([a, b])
    } else if (Math.abs(b) <= 90 && Math.abs(a) <= 180) {
      out.push([b, a])
    }
  }
  return out.length >= 3 ? out : null
}

function normalizeTerritoryRow(t) {
  if (!t) return t
  const polygon = normalizePolygon(t.polygon)
  // Keep the original key shape — components read `t.polygon` directly.
  return polygon ? { ...t, polygon } : t
}

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
  return (data || []).map(normalizeTerritoryRow)
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
    ...normalizeTerritoryRow(t),
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
    // Slimmer query: only lat/lng/created_at, last 90 days, capped at
    // 1000 rows. Cuts wire payload and parse time roughly 5–10×
    // compared with the legacy getAllDoorHistory().
    getDoorHistoryForTerritories({ windowDays: 90, limit: 1000 }),
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

  return rows.map((raw) => {
    // Normalize the polygon first so the same point-in-polygon math works
    // regardless of whether the row was seeded as GeoJSON, [lng,lat], or
    // the in-app [lat,lng] shape.
    const t    = normalizeTerritoryRow(raw)
    const poly = Array.isArray(t.polygon) ? t.polygon : null
    let lastKnockAt = null
    let interactionCount = 0
    if (poly && poly.length >= 3) {
      // Bounding-box pre-filter. A neighborhood polygon covers a tiny
      // fraction of the city — for every door outside the bbox we can
      // skip the (cheap but not free) ray-cast loop. For a 10-zone
      // org this turns ~10,000 polygon tests into ~10×(zone-area
      // fraction × N), typically 50–200 tests instead of thousands.
      let minLat =  Infinity, maxLat = -Infinity
      let minLng =  Infinity, maxLng = -Infinity
      for (const p of poly) {
        if (p[0] < minLat) minLat = p[0]
        if (p[0] > maxLat) maxLat = p[0]
        if (p[1] < minLng) minLng = p[1]
        if (p[1] > maxLng) maxLng = p[1]
      }
      for (const h of history) {
        if (h.lat == null || h.lng == null) continue
        if (h.lat < minLat || h.lat > maxLat || h.lng < minLng || h.lng > maxLng) continue
        if (!pip(h.lat, h.lng, poly)) continue
        interactionCount += 1
        // history is already ordered DESC by created_at, so the first
        // match is the latest. Skip the Date constructions and just
        // remember the first hit.
        if (!lastKnockAt) lastKnockAt = h.created_at
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

/**
 * Compute the org's "home region" for use as a map fallback when the active
 * date-filter returns no markers (e.g., a fresh demo open on the manager's
 * Map tab). RLS scopes both reads to the caller's org, so no explicit
 * organization_id filter is needed here.
 *
 * Resolution order:
 *   1. Bounding box of the most recent 200 interactions ever (no date
 *      filter). This is the strongest signal — wherever the org has
 *      actually canvassed. Returns { bounds: [[swLat,swLng],[neLat,neLng]] }.
 *   2. Centroid + bounding box of all territory polygons.
 *   3. null — caller falls back to a wide continental-US view.
 */
export async function getOrgRegionFallback() {
  // 1. Recent interactions with lat/lng
  const { data: ints } = await supabase
    .from('interactions')
    .select('lat, lng')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (ints && ints.length > 0) {
    const bb = boundsOfPoints(ints.map((i) => [i.lat, i.lng]))
    if (bb) return { bounds: bb }
  }
  // 2. Territory polygons — fall back to the union of every drawn zone.
  const { data: terrs } = await supabase
    .from('territories')
    .select('polygon')
  if (terrs && terrs.length > 0) {
    const flat = []
    for (const t of terrs) {
      // Polygon shape in this app is [[lat,lng], ...]. Some legacy rows may
      // store [[lng,lat], ...]; guard against that by clamping to plausible
      // lat/lng ranges before accepting a point.
      if (!Array.isArray(t.polygon)) continue
      for (const p of t.polygon) {
        if (!Array.isArray(p) || p.length < 2) continue
        const [a, b] = p
        if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
          flat.push([a, b])
        } else if (Math.abs(b) <= 90 && Math.abs(a) <= 180) {
          flat.push([b, a])
        }
      }
    }
    const bb = boundsOfPoints(flat)
    if (bb) return { bounds: bb }
  }
  return null
}

// Tiny shared helper — sweep a list of [lat,lng] points and return a
// [[swLat,swLng],[neLat,neLng]] pair, or null if the list was empty.
function boundsOfPoints(pts) {
  if (!pts || pts.length === 0) return null
  let minLat =  Infinity, maxLat = -Infinity
  let minLng =  Infinity, maxLng = -Infinity
  for (const [lat, lng] of pts) {
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null
  return [[minLat, minLng], [maxLat, maxLng]]
}

/**
 * Super-admin-only: Google geocoding spend for the current month, plus cache
 * stats. Returns null if the caller isn't a super-admin (RPC raises) or the
 * function isn't deployed yet. See geocode_spend_summary().
 */
export async function getGeocodeSpendSummary() {
  const { data, error } = await supabase.rpc('geocode_spend_summary')
  if (error) return null
  return data
}

/** All interactions ever (no date filter) for territory door-history overlay */
export async function getAllDoorHistory() {
  // Explicit org scope. Without it, RLS forces a full sequential scan of
  // every org's geocoded interactions (~32k rows → filter down to ours),
  // which was the multi-second hang on the manager Territories tab
  // (~6.4s → ~50ms once the org index can be used).
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const { data } = await supabase
    .from('interactions')
    // Same FK-ambiguity fix as getManagerMapData — pin to rep_id.
    .select('id, lat, lng, outcome, address, created_at, rep_id, users!rep_id ( full_name )')
    .eq('organization_id', orgId)
    .not('lat', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000)
  return data || []
}

/**
 * Slim door-history pull for the Territories screens: only the three
 * fields the per-zone rollup actually reads (lat, lng, created_at),
 * scoped to a recent time window, no joins. The previous
 * getAllDoorHistory query pulled 2000 rows × 7+ joined columns just
 * to compute "how many knocks landed in this polygon and when was
 * the most recent one" — a lot of payload to throw away.
 *
 *   windowDays — how far back to look. 90 days covers the recency
 *                signal the UI sorts on; older knocks barely affect
 *                "stalest first" because they're already buried.
 *   limit      — hard cap. 1000 recent rows is plenty for the rep
 *                inbox UX; if an org overflows it we still get a
 *                correct (just truncated-at-the-tail) signal.
 */
export async function getDoorHistoryForTerritories({ windowDays = 90, limit = 1000 } = {}) {
  // Org-scoped so the planner uses idx_interactions_organization instead
  // of seq-scanning the whole table behind RLS (same fix as
  // getAllDoorHistory above).
  const orgId = await getMyOrgId()
  if (!orgId) return []
  const since = new Date()
  since.setDate(since.getDate() - windowDays)
  const { data } = await supabase
    .from('interactions')
    .select('lat, lng, created_at')
    .eq('organization_id', orgId)
    .not('lat', 'is', null)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(limit)
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
    // PostgREST disambiguation: interactions has TWO foreign keys into
    // users (rep_id AND closer_id, the latter added by the pipeline
    // migration). A bare `users(...)` embed makes PostgREST return
    // HTTP 300 / PGRST201 ("more than one relationship") and this
    // helper silently returns `[]` — which manifested as a totally
    // blank Map tab even when the org had thousands of interactions.
    // Pin the embed to the rep_id FK, which is the relationship the
    // Map popup actually needs ("who knocked this door").
    .select(`*, canvassing_sessions(neighborhood), users!rep_id(full_name)`)
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
  'd2d2d2d2-0000-4000-a000-000000000001', // Summit Exteriors (demo)
  'd3d3d3d3-0000-4000-a000-000000000001', // Saguaro Pest Defense (demo)
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

/**
 * Permanently delete a canvassing session the caller owns.
 *
 * RLS ("Reps can manage own sessions": rep_id = auth.uid()) already scopes
 * the delete to the row's owner, so callers must additionally gate the UI
 * (we only surface this to managers on their OWN sessions). Child rows in
 * `interactions` and `gps_points` are removed automatically via ON DELETE
 * CASCADE.
 *
 * `bookings`, however, reference the session with a NOT-NULL, NO-ACTION FK —
 * so a session that produced booked jobs can't be deleted without destroying
 * revenue/commission records. Rather than letting that surface as an opaque
 * FK violation (or silently wiping money), we detect bookings up front and
 * return a friendly blocked error. Callers can show error.message directly.
 *
 * Returns { error } — error.code === 'has_bookings' when blocked.
 */
export async function deleteSession(sessionId) {
  const { count, error: countErr } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
  if (countErr) return { error: countErr }
  if ((count || 0) > 0) {
    const plural = count === 1 ? '' : 's'
    return {
      error: {
        code: 'has_bookings',
        message: `This session has ${count} booked job${plural} attached, so it can't be deleted. Remove the booking${plural} first.`,
      },
    }
  }
  const { error } = await supabase
    .from('canvassing_sessions')
    .delete()
    .eq('id', sessionId)
  return { error }
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

// Default per-event toggles — mirrors the DB column default. Estimate is the
// noisiest event so it's off by default.
export const DEFAULT_WEBHOOK_EVENTS = {
  session_ended: true,
  booking:       true,
  appointment:   true,
  estimate:      false,
}

/**
 * Read the org-level Zapier config (URL + per-event toggles). Readable by any
 * org member (reps included) via the organizations_select RLS policy, which is
 * what lets rep-driven booking/appointment events fire. Falls back to the
 * current user's legacy auth-metadata URL so existing setups keep working.
 */
export async function getOrgWebhookConfig() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { url: null, events: { ...DEFAULT_WEBHOOK_EVENTS } }
  const { data: row } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  let url = null
  let events = { ...DEFAULT_WEBHOOK_EVENTS }
  if (row?.organization_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('zapier_webhook_url, zapier_events')
      .eq('id', row.organization_id)
      .single()
    url = org?.zapier_webhook_url || null
    if (org?.zapier_events) events = { ...DEFAULT_WEBHOOK_EVENTS, ...org.zapier_events }
  }
  // Legacy fallback: an older per-user URL still drives the webhook if the org
  // hasn't been configured yet.
  if (!url) url = user.user_metadata?.zapier_webhook_url || null
  return { url, events }
}

/** Save the org-level Zapier config. Only the org owner can update (RLS). */
export async function saveOrgWebhookConfig(orgId, { url, events }) {
  const patch = {}
  if (url !== undefined)    patch.zapier_webhook_url = url || null
  if (events !== undefined) patch.zapier_events      = events
  const { data, error } = await supabase
    .from('organizations')
    .update(patch)
    .eq('id', orgId)
    .select('zapier_webhook_url, zapier_events')
    .single()
  return { data, error }
}

/**
 * Fire a named webhook event if the org has that event enabled and a URL set.
 * Fire-and-forget by design — callers should not await UI-blocking on this.
 * `payload` should already include the event-specific fields; we stamp
 * `event`, `source`, and `timestamp` consistently.
 */
export async function fireWebhookEvent(eventKey, payload = {}) {
  try {
    const { url, events } = await getOrgWebhookConfig()
    if (!url || !events?.[eventKey]) return false
    return await fireZapierWebhook(url, {
      event:     eventKey,
      source:    'knockiq',
      timestamp: new Date().toISOString(),
      ...payload,
    })
  } catch (err) {
    console.warn('[Webhook] fireWebhookEvent failed:', err)
    return false
  }
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
  // Explicit org scope. RLS already isolates by org, but the interactions
  // table has several OR'd permissive policies (incl. a correlated
  // subquery), so without an org predicate the planner can't use
  // idx_interactions_organization and falls back to scanning every org's
  // active-stage rows before RLS-filtering down to ours. Passing
  // organization_id lets it index-scan straight to our rows (~440ms → ~10ms).
  const orgId = await getMyOrgId()
  if (!orgId) return []
  let query = supabase
    .from('interactions')
    .select(`
      id, stage, outcome, address, lat, lng, contact_name, contact_phone, contact_email,
      service_types, estimated_value, service_line_items, notes, follow_up,
      appointment_at, estimate_sent_at, hot_lead_started_at,
      closer_id, closer_contact_id, rep_id, created_at, lost_reason, lost_at,
      setter:rep_id                  ( id, full_name ),
      closer:closer_id               ( id, full_name ),
      closer_contact:closer_contact_id ( id, full_name )
    `)
    .eq('organization_id', orgId)
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
 * Fetch a single pipeline lead by id with the same joined shape as
 * getPipelineLeads, so LeadDetailModal renders without follow-up queries.
 *
 * Used by the email deep-link path (PipelineTab opening ?lead=<id>): a lead
 * in any notifiable phase is normally already in getPipelineLeads()'s active
 * set, but if it advanced to a closed stage between the email send and the
 * click, it falls out of that set — this by-id fetch still resolves it.
 * RLS scopes to the caller's org, so a bad/cross-org id returns null.
 */
export async function getPipelineLeadById(id) {
  if (!id) return null
  // Org-scoped like getPipelineLeads. RLS still gates cross-org ids to
  // null; the explicit filter keeps the single-row lookup on the org
  // index path and consistent with the list query above.
  const orgId = await getMyOrgId()
  if (!orgId) return null
  const { data } = await supabase
    .from('interactions')
    .select(`
      id, stage, outcome, address, lat, lng, contact_name, contact_phone, contact_email,
      service_types, estimated_value, service_line_items, notes, follow_up,
      appointment_at, estimate_sent_at, hot_lead_started_at,
      closer_id, closer_contact_id, rep_id, created_at, lost_reason, lost_at,
      setter:rep_id                  ( id, full_name ),
      closer:closer_id               ( id, full_name ),
      closer_contact:closer_contact_id ( id, full_name )
    `)
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle()
  return data || null
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
/**
 * Compute the action queue. Accepts an already-loaded leads array so
 * the Pipeline tab can pass the leads it already fetched for the
 * kanban — historically this helper re-fetched the same 500-row,
 * 3-join query, doubling Pipeline load time. Callers that don't have
 * leads in hand (none currently, but kept for safety) still get a
 * working fetch path.
 */
export async function getActionQueue(preloadedLeads = null, salesCycle = 'mixed') {
  const leads = Array.isArray(preloadedLeads) ? preloadedLeads : await getPipelineLeads({})
  const now = Date.now()
  const queue = []
  const seen  = new Set()
  // Quick-quote orgs price at the door — they don't schedule appointments or
  // dispatch closers, so the appointment-timing (Rule 1) and unassigned-
  // closer (Rule 2) rules don't apply. Skipping them also keeps any legacy
  // appt_scheduled rows (logged before those controls were removed) out of
  // the queue instead of flagging them "needs closer" forever.
  const isQuickQuote = salesCycle === 'quick_quote'

  function add(reason, urgency, lead) {
    if (seen.has(lead.id)) return
    seen.add(lead.id)
    queue.push({ reason, urgency, lead })
  }

  // Rule 1: appt in next 4 hours
  if (!isQuickQuote) for (const l of leads) {
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
  // day for an appt logged previously, it's at risk. A lead counts as
  // assigned if EITHER a platform closer (closer_id) OR an email-only
  // closer contact (closer_contact_id) is set — checking only closer_id
  // previously flagged contact-assigned leads as "needs closer" forever.
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  if (!isQuickQuote) for (const l of leads) {
    if (l.closer_id || l.closer_contact_id) continue
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
  const orgId = await getMyOrgId()
  if (!orgId) return []
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
    .eq('organization_id', orgId)
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
  const orgId = await getMyOrgId()
  if (!orgId) return { avgTimeToBookDays: null, estimateToBookRate: null, pipelineAtRisk: 0, forecast14d: 0, sampleSize: 0 }
  const windowStart = new Date(); windowStart.setDate(windowStart.getDate() - windowDays)
  const { data } = await supabase
    .from('interactions')
    .select('id, stage, estimated_value, hot_lead_started_at, estimate_sent_at, created_at, appointment_at')
    .eq('organization_id', orgId)
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
  const orgId = await getMyOrgId()
  if (!orgId) return { notInterested: 0, lost: 0, stale: 0, topReasons: [], total: 0 }
  const windowStart = new Date(); windowStart.setDate(windowStart.getDate() - windowDays)
  const { data } = await supabase
    .from('interactions')
    .select('stage, lost_reason')
    .eq('organization_id', orgId)
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
    // Same FK-ambiguity fix as getManagerMapData — pin to rep_id.
    .select('*, users!rep_id(full_name)')
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
  // Routed through a SECURITY DEFINER RPC instead of a direct users read.
  // Plain reps have no same-org SELECT on `users` (tenant_isolation is a
  // RESTRICTIVE policy; only select_own + the manager read policy grant
  // rows), so the old direct query returned [] for reps and the DM picker
  // was silently manager-only. The RPC returns just the roster columns the
  // picker needs (id, full_name, email, role, avatar_url) — no
  // commission_config or phone — so reps can DM teammates by name without
  // exposing pay or contact details.
  const { data, error } = await supabase.rpc('chat_list_org_teammates')
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[chat] chat_list_org_teammates failed', error)
    return []
  }
  return data || []
}
