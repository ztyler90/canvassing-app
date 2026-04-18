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
    // Normalize: a booking is always also an estimate. This handles historical
    // sessions that were recorded before the booked-counts-as-estimate rule
    // was introduced — if raw estimates < bookings, we lift estimates up.
    const rawBookings  = s.bookings  || 0
    const rawEstimates = s.estimates || 0
    const estimates    = Math.max(rawEstimates, rawBookings)
    const add = (acc) => {
      acc.doors         += s.doors_knocked  || 0
      acc.conversations += s.conversations  || 0
      acc.estimates     += estimates
      acc.bookings      += rawBookings
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
 *
 * Note on `overallClose`: close rate is bookings ÷ estimates (not ÷ doors).
 * Reps only "close" a deal once a homeowner has gotten a quote; measuring it
 * against total doors punishes a rep for a long prospecting day.
 */
export function computeConversion(stats) {
  const pct = (num, den) => (den > 0 ? (num / den) * 100 : 0)
  return {
    contactRate:   pct(stats.conversations, stats.doors),         // doors → conv
    estimateRate:  pct(stats.estimates,     stats.conversations), // conv  → est
    closeRate:     pct(stats.bookings,      stats.estimates),     // est   → book
    overallClose:  pct(stats.bookings,      stats.estimates),     // book  ÷ est
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

// 20-tier level system. Each level has a unique title + emoji icon + tier
// key. Tiers drive badge colors in <LevelBadge>. Reps don't see a full
// progression list — each new rank is revealed on level-up, so the titles
// stay surprising.
const LEVELS = [
  { title: 'Rookie',         icon: '🌱', tier: 'rookie'    },  // 1
  { title: 'Apprentice',     icon: '👣', tier: 'rookie'    },  // 2
  { title: 'Door Knocker',   icon: '🚪', tier: 'bronze'    },  // 3
  { title: 'Closer',         icon: '🎯', tier: 'bronze'    },  // 4
  { title: 'Sharpshooter',   icon: '🏹', tier: 'silver'    },  // 5
  { title: 'Warrior',        icon: '⚔️', tier: 'silver'    },  // 6
  { title: 'Sales Ninja',    icon: '🥷', tier: 'ninja'     },  // 7
  { title: 'Shogun',         icon: '🗡️', tier: 'ninja'     },  // 8
  { title: 'Champion',       icon: '🏆', tier: 'gold'      },  // 9
  { title: 'Legend',         icon: '🔥', tier: 'legend'    },  // 10
  { title: 'Titan',          icon: '⚡', tier: 'titan'     },  // 11
  { title: 'Mythic',         icon: '🐉', tier: 'mythic'    },  // 12
  { title: 'Ascendant',      icon: '💎', tier: 'diamond'   },  // 13
  { title: 'Conqueror',      icon: '🛡️', tier: 'platinum'  },  // 14
  { title: 'Overlord',       icon: '👑', tier: 'royal'     },  // 15
  { title: 'Phoenix',        icon: '🦅', tier: 'phoenix'   },  // 16
  { title: 'Celestial',      icon: '☄️', tier: 'celestial' },  // 17
  { title: 'Immortal',       icon: '🪐', tier: 'cosmic'    },  // 18
  { title: 'Cosmic',         icon: '🌌', tier: 'galaxy'    },  // 19
  { title: 'Knock God',      icon: '♾️', tier: 'god'       },  // 20
]
// Beyond 20 = the rep has maxed out. Keep them at Knock God.
const CAP = LEVELS[LEVELS.length - 1]

export function computeLevel(xp) {
  const x = Math.max(0, xp | 0)
  // Invert LEVEL_XP: level = floor(sqrt(xp/50)) + 1
  const level     = Math.floor(Math.sqrt(x / 50)) + 1
  const thisStart = LEVEL_XP(level)
  const nextStart = LEVEL_XP(level + 1)
  const span      = nextStart - thisStart
  const progress  = span > 0 ? (x - thisStart) / span : 1
  const info      = level <= LEVELS.length ? LEVELS[level - 1] : CAP

  return {
    level,
    title: info.title,
    icon:  info.icon,
    tier:  info.tier,
    xp: x,
    thisLevelStart: thisStart,
    nextLevelStart: nextStart,
    xpIntoLevel:    x - thisStart,
    xpForNext:      span,
    progress:       Math.max(0, Math.min(1, progress)),
  }
}
