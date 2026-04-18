/**
 * repStats.js — pure helpers for rep-side numbers and gamification.
 *
 * All functions here are pure (no Supabase calls, no side effects) so the
 * RepHome screen can compute week / month / lifetime views instantly from
 * a single list of submitted sessions.
 */
import { format } from 'date-fns'

// ─── Commission ───────────────────────────────────────────────────────────────

/**
 * Default config when a manager hasn't set one yet.
 * Keeps the commission card from being blank on first run.
 */
export const DEFAULT_COMMISSION_CONFIG = { type: 'flat_pct', value: 0 }

/**
 * Calculate commission $ earned from a stats object, per the rep's commission
 * config (set by the manager in Settings).
 *
 * @param {object} stats      { revenue, bookings, ... }
 * @param {object} config     commission_config from the users row (may be null)
 * @returns {number}          commission in dollars (not cents)
 */
export function calcCommission(stats, config) {
  if (!stats) return 0
  const cfg = config || DEFAULT_COMMISSION_CONFIG
  const revenue  = Number(stats.revenue)  || 0
  const bookings = Number(stats.bookings) || 0

  switch (cfg.type) {
    case 'flat_pct':
      return revenue * ((Number(cfg.value) || 0) / 100)

    case 'per_booking':
      return bookings * (Number(cfg.value) || 0)

    case 'tiered_pct': {
      const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : []
      if (!tiers.length) return 0
      // Walk tiers in order, filling each band with the portion of revenue
      // that falls inside it. `upto: null` means "no cap — apply to remainder."
      let remaining = revenue
      let prevCap   = 0
      let total     = 0
      for (const t of tiers) {
        const pct = Number(t.pct) || 0
        if (t.upto == null) {
          total += remaining * (pct / 100)
          remaining = 0
          break
        }
        const band = Math.max(0, Math.min(remaining, Number(t.upto) - prevCap))
        total    += band * (pct / 100)
        remaining = Math.max(0, remaining - band)
        prevCap   = Number(t.upto)
        if (remaining <= 0) break
      }
      return total
    }

    default:
      return 0
  }
}

/**
 * Short human-readable summary of a commission config, e.g.
 *   "15% of revenue"   /   "$75 per booking"   /   "Tiered: 10% → 15% → 20%"
 */
export function describeCommission(config) {
  const cfg = config || DEFAULT_COMMISSION_CONFIG
  switch (cfg.type) {
    case 'flat_pct':    return `${Number(cfg.value) || 0}% of revenue`
    case 'per_booking': return `$${Number(cfg.value) || 0} per booking`
    case 'tiered_pct': {
      const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : []
      if (!tiers.length) return 'Tiered (not configured)'
      return 'Tiered: ' + tiers.map(t => `${Number(t.pct) || 0}%`).join(' → ')
    }
    default: return 'Not set'
  }
}

// ─── Period filtering + totals ────────────────────────────────────────────────

const DAY_MS = 86_400_000

/**
 * Split a list of submitted sessions into week / month / lifetime stat blocks.
 * Weeks and months are rolling windows (last 7 days, last 30 days) rather
 * than calendar-aligned — what reps actually care about.
 */
export function computePeriodStats(sessions) {
  const now       = Date.now()
  const weekStart = now - 7  * DAY_MS
  const monthStart= now - 30 * DAY_MS

  const empty = () => ({
    doors: 0, conversations: 0, estimates: 0, bookings: 0,
    revenue: 0, sessions: 0,
  })

  const week = empty(), month = empty(), lifetime = empty()

  for (const s of sessions || []) {
    const ts = new Date(s.started_at).getTime()
    const add = (acc) => {
      acc.doors         += s.doors_knocked  || 0
      acc.conversations += s.conversations  || 0
      acc.estimates     += s.estimates      || 0
      acc.bookings      += s.bookings       || 0
      acc.revenue       += Number(s.revenue_booked) || 0
      acc.sessions      += 1
    }
    add(lifetime)
    if (ts >= monthStart) add(month)
    if (ts >= weekStart)  add(week)
  }

  return { week, month, lifetime }
}

/**
 * Funnel conversion rates as % (doors → conversations → estimates → bookings).
 * Returns 0 if denominator is 0 rather than NaN.
 */
export function computeConversion(stats) {
  const pct = (num, den) => (den > 0 ? (num / den) * 100 : 0)
  return {
    contactRate:   pct(stats.conversations, stats.doors),         // doors → conv
    estimateRate:  pct(stats.estimates,     stats.conversations), // conv  → est
    closeRate:     pct(stats.bookings,      stats.estimates),     // est   → book
    overallClose:  pct(stats.bookings,      stats.doors),         // doors → book
  }
}

// ─── Streak ───────────────────────────────────────────────────────────────────

/**
 * Count consecutive days the rep canvassed, ending on today or yesterday.
 * A "day" counts if there's at least one submitted session on it.
 * A missed "today" doesn't break the streak (reps haven't started yet today),
 * but a missed yesterday does.
 */
export function computeStreak(sessions) {
  if (!sessions?.length) return 0
  const days = new Set(
    sessions.map(s => format(new Date(s.started_at), 'yyyy-MM-dd'))
  )

  // Start from today; if today isn't knocked, allow yesterday as the anchor.
  let cursor = new Date()
  let streak = 0
  const key  = (d) => format(d, 'yyyy-MM-dd')

  if (!days.has(key(cursor))) {
    cursor.setDate(cursor.getDate() - 1)
    if (!days.has(key(cursor))) return 0
  }

  while (days.has(key(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

// ─── Level + XP ───────────────────────────────────────────────────────────────

/**
 * XP formula: rewards every productive action, but weights bookings and revenue
 * heavily so a few big closes can level up a rep just like a big grind day.
 *
 *   xp = doors + 3*conversations + 5*estimates + 25*bookings + floor(revenue/10)
 */
export function computeXP(stats) {
  if (!stats) return 0
  return (
    (stats.doors         || 0) * 1  +
    (stats.conversations || 0) * 3  +
    (stats.estimates     || 0) * 5  +
    (stats.bookings      || 0) * 25 +
    Math.floor((stats.revenue || 0) / 10)
  )
}

/**
 * Levels grow quadratically: level L starts at XP = 50 * (L-1)^2.
 *   L1:     0 xp
 *   L2:    50 xp
 *   L3:   200 xp
 *   L4:   450 xp
 *   L5:   800 xp
 *   L10: 4050 xp
 *   L20:18050 xp
 */
const LEVEL_XP = (L) => 50 * (L - 1) * (L - 1)

const LEVEL_TITLES = [
  // index = level - 1
  'Rookie',          // 1
  'Door Starter',    // 2
  'Door Warrior',    // 3
  'Street Pro',      // 4
  'Closer',          // 5
  'Deal Hunter',     // 6
  'Sales Ninja',     // 7
  'Revenue Master',  // 8
  'Elite Closer',    // 9
  'Top Dog',         // 10
]
const LEGEND_TITLE = 'Legend'

export function computeLevel(xp) {
  const x = Math.max(0, xp | 0)
  // Invert LEVEL_XP: level = floor(sqrt(xp/50)) + 1
  const level     = Math.floor(Math.sqrt(x / 50)) + 1
  const thisStart = LEVEL_XP(level)
  const nextStart = LEVEL_XP(level + 1)
  const span      = nextStart - thisStart
  const progress  = span > 0 ? (x - thisStart) / span : 1
  const title     = level <= LEVEL_TITLES.length
    ? LEVEL_TITLES[level - 1]
    : LEGEND_TITLE

  return {
    level,
    title,
    xp: x,
    thisLevelStart: thisStart,
    nextLevelStart: nextStart,
    xpIntoLevel:    x - thisStart,
    xpForNext:      span,
    progress:       Math.max(0, Math.min(1, progress)),
  }
}
