/**
 * callouts.js — pure helpers that turn raw rep data into the structured
 * payloads rendered by <RepCallouts>.
 *
 * Every helper is defensive about input and returns `null` when the data
 * can't credibly support the callout. That's on purpose — the RepHome
 * screen omits null callouts entirely rather than showing a "not enough
 * data" stub, because low-signal prompts erode trust in every other
 * prompt on the page.
 */
import { format } from 'date-fns'

const DAY_MS = 86_400_000

// ── Rank Movement ────────────────────────────────────────────────────────────

/**
 * Rank this rep on the current leaderboard and compare to the prior period.
 * Both inputs are arrays returned by getLeaderboardData/Range.
 *
 * Ranking is by revenue then bookings then doors — same tiebreakers
 * ManagerDashboard uses. We only return a payload when the delta is
 * non-trivial and the team has enough reps for rank to mean anything.
 *
 * @param {Array} current   leaderboard rows for "now" period
 * @param {Array} prior     leaderboard rows for the equivalent prior period
 * @param {string} repId    the rep we're computing for
 */
export function computeRankMovement(current, prior, repId) {
  if (!Array.isArray(current) || !repId) return null
  if (current.length < 3) return null  // rank is noise on a tiny team

  const sorter = (a, b) => {
    const ar = Number(a.revenue || 0),  br = Number(b.revenue || 0)
    if (ar !== br) return br - ar
    const ab = Number(a.bookings || 0), bb = Number(b.bookings || 0)
    if (ab !== bb) return bb - ab
    return (Number(b.doors || 0)) - (Number(a.doors || 0))
  }

  const currentSorted = [...current].sort(sorter)
  const currRankIdx   = currentSorted.findIndex((r) => r.id === repId)
  if (currRankIdx < 0) return null

  const currentRank = currRankIdx + 1
  const total       = currentSorted.length

  const priorSorted = Array.isArray(prior) ? [...prior].sort(sorter) : []
  const priorIdx    = priorSorted.findIndex((r) => r.id === repId)

  // No prior data at all — skip. Saying "newly ranked" is cute but noisy
  // for reps who just joined and haven't stabilized yet.
  if (priorIdx < 0) return null

  const priorRank = priorIdx + 1
  const delta     = priorRank - currentRank   // positive = moved up

  if (delta === 0) return null  // no movement — nothing to celebrate

  return {
    currentRank,
    priorRank,
    delta,
    total,
    direction: delta > 0 ? 'up' : 'down',
  }
}

// ── Dry-Spell Recovery ───────────────────────────────────────────────────────

/**
 * Detect a zero-booking streak (≥ 2 worked days with 0 bookings each,
 * immediately preceding today). If present, also look back through
 * history for comparable slumps and return how the rep typically
 * bounced back — so we can frame the callout as empowerment ("you've
 * broken past slumps with X bookings the next day") rather than guilt.
 *
 * Only considers DAYS THE REP WORKED. A rep on vacation isn't in a
 * "slump", they're just off.
 */
export function computeDrySpell(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null

  // Build day → bookings map, only for days with at least one session.
  const byDay = new Map()
  for (const s of sessions) {
    if (!s.started_at) continue
    const key = s.started_at.slice(0, 10)   // yyyy-mm-dd
    byDay.set(key, (byDay.get(key) || 0) + (s.bookings || 0))
  }

  // Current streak: how many worked days BEFORE today (so we don't
  // guilt-trip a rep who hasn't finished the day yet) have 0 bookings?
  const sortedDays = [...byDay.keys()].sort()  // ascending
  const todayKey   = format(new Date(), 'yyyy-MM-dd')

  // Strip today — we're evaluating how they ended yesterday and before.
  const pastDays = sortedDays.filter((d) => d < todayKey)
  if (pastDays.length === 0) return null

  // Count trailing zero-booking days (most recent working days with 0 bookings).
  let dryDays = 0
  for (let i = pastDays.length - 1; i >= 0; i--) {
    if ((byDay.get(pastDays[i]) || 0) === 0) dryDays++
    else break
  }
  if (dryDays < 2) return null  // not a "spell" yet, just a quiet day

  // Historical comebacks: any day with > 0 bookings that was immediately
  // preceded (in the rep's working-day sequence) by a 0-booking day.
  // We only average *non-zero* bounce-back days to produce a motivating
  // number, not one dragged down by further quiet days.
  let comebackCount = 0
  let comebackSum   = 0
  for (let i = 1; i < pastDays.length; i++) {
    const prev = byDay.get(pastDays[i - 1]) || 0
    const curr = byDay.get(pastDays[i])     || 0
    if (prev === 0 && curr > 0) {
      comebackCount++
      comebackSum += curr
    }
  }

  return {
    dryDays,
    comebackCount,
    avgComebackBookings: comebackCount > 0 ? comebackSum / comebackCount : 0,
  }
}

// ── Personal Best Close Rate ─────────────────────────────────────────────────

/** ISO-ish week key ("yyyy-Www"). Pure JS so we avoid a date-fns iso import. */
function weekKey(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = dt.getUTCDay() || 7
  dt.setUTCDate(dt.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((dt - yearStart) / DAY_MS + 1) / 7)
  return `${dt.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

/**
 * Find the rep's best single-week close rate (bookings / estimates),
 * comparing their current week's pace. A close rate is only considered
 * if the week had enough estimates to be meaningful (≥ 5).
 *
 * @returns null | {
 *   bestRate:       0..1
 *   bestWeek:       'yyyy-Www'
 *   currentRate:    0..1 | null
 *   isBeating:      boolean   // current > best (with ≥ 2 estimates this week)
 * }
 */
export function computePersonalBestCloseRate(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null

  const byWeek = new Map()
  for (const s of sessions) {
    if (!s.started_at) continue
    const wk = weekKey(new Date(s.started_at))
    const w  = byWeek.get(wk) || { est: 0, bk: 0 }
    // Mirror computePeriodStats normalization: a booking always counts as an estimate.
    w.est += Math.max(s.estimates || 0, s.bookings || 0)
    w.bk  += s.bookings || 0
    byWeek.set(wk, w)
  }

  const thisWk = weekKey(new Date())
  let bestRate = null
  let bestWeek = null
  for (const [wk, v] of byWeek) {
    if (wk === thisWk) continue  // don't compete against an in-progress week
    if (v.est < 5) continue
    const rate = v.bk / v.est
    if (bestRate == null || rate > bestRate) {
      bestRate = rate
      bestWeek = wk
    }
  }
  if (bestRate == null) return null

  const cur = byWeek.get(thisWk)
  const currentRate = cur && cur.est >= 2 ? cur.bk / cur.est : null

  return {
    bestRate,
    bestWeek,
    currentRate,
    isBeating: currentRate != null && currentRate > bestRate,
  }
}

// ── Close-Rate Diagnostic ────────────────────────────────────────────────────

/**
 * Compare the rep's last-7-days close rate to their trailing 30-day rate.
 * Only fires when there's enough sample and the drop is materially bad
 * — otherwise this would nag on healthy weeks.
 *
 * @param {object} periodStats   output of computePeriodStats(sessions)
 * @returns null | {
 *   weekRate: 0..1, monthRate: 0..1, dropPct: 0..100
 * }
 */
export function computeCloseRateDiagnostic(periodStats) {
  if (!periodStats) return null
  const w = periodStats.week  || {}
  const m = periodStats.month || {}

  if ((w.estimates || 0) < 5)  return null   // too few estimates this week
  if ((m.estimates || 0) < 15) return null   // not enough baseline yet

  const weekRate  = w.estimates > 0 ? (w.bookings || 0) / w.estimates : 0
  const monthRate = m.estimates > 0 ? (m.bookings || 0) / m.estimates : 0
  if (monthRate <= 0) return null

  const relativeDrop = (monthRate - weekRate) / monthRate
  if (relativeDrop < 0.25) return null   // < 25% drop → still in normal range

  return {
    weekRate,
    monthRate,
    dropPct: relativeDrop * 100,
  }
}

// ── Level-Up Proximity ───────────────────────────────────────────────────────

/**
 * Fires when the rep is within striking distance of the next level.
 * Threshold is 85% — close enough that one good session tips it over,
 * which is the psychological sweet spot for this kind of nudge.
 */
export function computeLevelUpProximity(levelInfo) {
  if (!levelInfo || typeof levelInfo.progress !== 'number') return null
  if (levelInfo.progress < 0.85) return null
  const xpRemaining = Math.max(0, (levelInfo.xpForNext || 0) - (levelInfo.xpIntoLevel || 0))
  if (xpRemaining <= 0) return null
  return {
    currentLevel: levelInfo.level,
    nextLevel:    levelInfo.level + 1,
    nextTitle:    levelInfo.nextTitle || null,
    xpRemaining,
    pctDone:      Math.round(levelInfo.progress * 100),
  }
}

// ── Team Pulse ───────────────────────────────────────────────────────────────

/**
 * Snapshot of today's team activity from the "today" leaderboard.
 * Only returns a payload when the team has ≥ 2 reps and some activity
 * has actually happened today.
 */
export function computeTeamPulse(todayBoard, repId) {
  if (!Array.isArray(todayBoard)) return null
  if (todayBoard.length < 2) return null

  let totalDoors    = 0
  let totalBookings = 0
  let totalRevenue  = 0
  let myBookings    = 0
  let myDoors       = 0
  let activeReps    = 0

  for (const r of todayBoard) {
    const doors    = Number(r.doors    || 0)
    const bookings = Number(r.bookings || 0)
    const revenue  = Number(r.revenue  || 0)
    totalDoors    += doors
    totalBookings += bookings
    totalRevenue  += revenue
    if (doors > 0 || bookings > 0) activeReps++
    if (r.id === repId) {
      myBookings = bookings
      myDoors    = doors
    }
  }

  if (totalDoors === 0 && totalBookings === 0) return null

  return {
    totalDoors,
    totalBookings,
    totalRevenue,
    myBookings,
    myDoors,
    activeReps,
    teamSize: todayBoard.length,
  }
}

// ── Goal Pace ────────────────────────────────────────────────────────────────

/**
 * How close the rep is to today's manager-set daily goal. Fires once they've
 * made real progress (≥ 60%) so it reads as an encouraging "almost there"
 * nudge rather than a 9am "you've done nothing" scold, and switches to a
 * celebratory variant once the goal is hit.
 *
 * @param {object} opts
 * @param {number}  opts.target        the daily goal value (revenue $ or count)
 * @param {number}  opts.current       today's progress in the same unit
 * @param {boolean} opts.isRevenue     true → revenue goal, false → count goal
 * @param {string}  opts.countNoun     'estimates' | 'appointments' (count goals)
 * @returns null | {
 *   hit:        boolean,   // goal already met or beaten today
 *   pctDone:    number,    // 0..100 (capped)
 *   remaining:  number,    // units left to hit goal (0 when hit)
 *   isRevenue:  boolean,
 *   countNoun:  string,
 * }
 */
export function computeGoalPace({ target, current, isRevenue, countNoun } = {}) {
  const tgt = Number(target) || 0
  const cur = Number(current) || 0
  if (tgt <= 0) return null
  if (cur <= 0) return null  // nothing logged yet today — don't nudge

  const ratio = cur / tgt
  if (ratio < 0.6 && ratio < 1) return null  // too early to be motivating

  return {
    hit:       ratio >= 1,
    pctDone:   Math.min(Math.round(ratio * 100), 100),
    remaining: Math.max(0, tgt - cur),
    isRevenue: !!isRevenue,
    countNoun: countNoun === 'appointments' ? 'appointments' : 'estimates',
  }
}

// ── Rival Chase ──────────────────────────────────────────────────────────────

/**
 * The rep directly above this rep on the (weekly) leaderboard, and the
 * bookings gap to catch them. Frames the next booking as overtaking a
 * specific teammate — a sharper motivator than an abstract rank.
 *
 * We only fire when there's a closeable gap in BOOKINGS (≥ 1). If the rep
 * above is ahead purely on revenue with equal bookings, the "one more
 * booking passes them" story doesn't hold, so we skip it.
 *
 * @param {Array}  board   leaderboard rows ({ id, name, revenue, bookings, doors })
 * @param {string} repId
 * @returns null | {
 *   rivalName:    string,
 *   myRank:       number,   // 1-based
 *   bookingsGap:  number,   // bookings needed to match the rival
 *   revenueGap:   number,   // $ behind the rival (secondary context)
 * }
 */
export function computeRivalChase(board, repId) {
  if (!Array.isArray(board) || !repId) return null
  if (board.length < 3) return null  // rank is noise on a tiny team

  const sorter = (a, b) => {
    const ar = Number(a.revenue || 0),  br = Number(b.revenue || 0)
    if (ar !== br) return br - ar
    const ab = Number(a.bookings || 0), bb = Number(b.bookings || 0)
    if (ab !== bb) return bb - ab
    return (Number(b.doors || 0)) - (Number(a.doors || 0))
  }

  const sorted = [...board].sort(sorter)
  const myIdx  = sorted.findIndex((r) => r.id === repId)
  if (myIdx <= 0) return null  // not found, or already #1 — no one to chase

  const me    = sorted[myIdx]
  const rival = sorted[myIdx - 1]

  const bookingsGap = Number(rival.bookings || 0) - Number(me.bookings || 0)
  if (bookingsGap < 1) return null  // gap isn't a bookings story — skip

  return {
    rivalName:   rival.name || 'the rep ahead',
    myRank:      myIdx + 1,
    bookingsGap: Math.round(bookingsGap),
    revenueGap:  Math.max(0, Number(rival.revenue || 0) - Number(me.revenue || 0)),
  }
}

// ── Milestone Within Reach ───────────────────────────────────────────────────

// Round-number milestones per lifetime metric, ascending. Tuned so there's
// always a meaningful "next big number" without firing on trivial ones.
const MILESTONE_TIERS = {
  doors:    [100, 250, 500, 1000, 2500, 5000, 10000, 25000],
  bookings: [10, 25, 50, 100, 250, 500, 1000],
  revenue:  [10000, 25000, 50000, 100000, 250000, 500000, 1000000],
}

const MILESTONE_META = {
  doors:    { noun: 'doors knocked',    isRevenue: false },
  bookings: { noun: 'lifetime bookings', isRevenue: false },
  revenue:  { noun: 'booked',            isRevenue: true  },
}

/** Smallest tier strictly greater than `value`, or null if past them all. */
function nextTier(tiers, value) {
  for (const t of tiers) if (t > value) return t
  return null
}

/**
 * The single closest "round number" lifetime milestone the rep is within
 * striking distance of (≥ 80% of the way there). Mirrors the level-up
 * proximity philosophy: one big nearby number, framed as almost-earned.
 *
 * Considers doors, bookings, and revenue, and returns whichever the rep is
 * proportionally closest to.
 *
 * @param {object} lifetime  periods.lifetime ({ doors, bookings, revenue })
 * @returns null | {
 *   metric:     'doors'|'bookings'|'revenue',
 *   noun:       string,
 *   target:     number,
 *   current:    number,
 *   remaining:  number,
 *   pctDone:    number,   // 0..100
 *   isRevenue:  boolean,
 * }
 */
export function computeMilestone(lifetime) {
  if (!lifetime) return null

  let best = null
  for (const metric of ['doors', 'bookings', 'revenue']) {
    const current = Number(lifetime[metric] || 0)
    if (current <= 0) continue
    const target = nextTier(MILESTONE_TIERS[metric], current)
    if (target == null) continue  // already past the top tier
    const ratio = current / target
    if (ratio < 0.8) continue     // not close enough to be motivating
    if (!best || ratio > best.ratio) {
      best = { metric, current, target, ratio }
    }
  }
  if (!best) return null

  const meta = MILESTONE_META[best.metric]
  return {
    metric:    best.metric,
    noun:      meta.noun,
    target:    best.target,
    current:   best.current,
    remaining: Math.max(0, best.target - best.current),
    pctDone:   Math.round(best.ratio * 100),
    isRevenue: meta.isRevenue,
  }
}

// ── Misc helpers ─────────────────────────────────────────────────────────────

/** Render "yyyy-Www" → "the week of Apr 7" for natural copy. */
export function describeWeek(weekKeyStr) {
  if (!weekKeyStr) return ''
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKeyStr)
  if (!m) return weekKeyStr
  const year = Number(m[1])
  const week = Number(m[2])
  // Monday of ISO week `week` in `year`:
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (week - 1) * 7)
  return format(monday, 'MMM d')
}
