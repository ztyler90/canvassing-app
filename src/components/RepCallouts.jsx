/**
 * RepCallouts — the stack of personalized nudge cards on RepHome, shown
 * between the Start Canvassing button and the Goal / Level scoreboard.
 *
 * Every card:
 *   - Is powered by pure helpers in lib/callouts.js (or computeBestHour in
 *     lib/repStats.js). All data shaping happens up there.
 *   - Renders null when its payload is null — never a "not enough data" stub.
 *   - Respects the per-user show/hide toggles in lib/prefs.js.
 *
 * Ordering below is intentional: positive momentum first (hot hour, rank up,
 * personal best, level-up), then activating nudges (dry spell, team pulse),
 * then diagnostic / coaching (close rate drop). Negative prompts sit last so
 * the card stack doesn't lead with a scold.
 */
import {
  Clock, TrendingUp, TrendingDown, Flame, Trophy,
  Sparkles, Users, AlertTriangle,
} from 'lucide-react'
import { usePrefs } from '../lib/prefs.js'
import { formatHourRange } from '../lib/repStats.js'

export default function RepCallouts({
  bestHour       = null,
  rankMovement   = null,
  drySpell       = null,
  personalBest   = null,
  closeDiag      = null,
  levelProximity = null,
  teamPulse      = null,
}) {
  const prefs = usePrefs()
  const cards = []

  // ── 1. Hot hour (positive, time-gated) ─────────────────────────────
  // Door-knocking prime time is late afternoon. We only surface the hot-
  // hour nudge between 4pm and 6pm local so it arrives right when the rep
  // is actively in (or approaching) their best window — not at 9am when
  // they can't act on it yet.
  if (prefs.calloutHotHour !== false && bestHour && isHotHourWindow()) {
    cards.push(<HotHourCard key="hot-hour" info={bestHour} />)
  }

  // ── 2. Rank movement (positive if up; accountability if down) ──────
  if (prefs.calloutRankMovement !== false && rankMovement) {
    cards.push(<RankMovementCard key="rank" info={rankMovement} />)
  }

  // ── 3. Personal best close rate ────────────────────────────────────
  if (prefs.calloutPersonalBestClose !== false && personalBest) {
    cards.push(<PersonalBestCard key="pb" info={personalBest} />)
  }

  // ── 4. Level-up proximity ──────────────────────────────────────────
  if (prefs.calloutLevelUpProximity !== false && levelProximity) {
    cards.push(<LevelUpCard key="level" info={levelProximity} />)
  }

  // ── 5. Dry-spell recovery (empowering framing) ─────────────────────
  if (prefs.calloutDrySpellRecovery !== false && drySpell) {
    cards.push(<DrySpellCard key="dry" info={drySpell} />)
  }

  // ── 6. Team pulse ──────────────────────────────────────────────────
  if (prefs.calloutTeamPulse !== false && teamPulse) {
    cards.push(<TeamPulseCard key="team" info={teamPulse} />)
  }

  // ── 7. Close-rate diagnostic (last; only when sample is loud) ──────
  if (prefs.calloutCloseRateDiagnostic !== false && closeDiag) {
    cards.push(<CloseRateDiagCard key="close-diag" info={closeDiag} />)
  }

  if (cards.length === 0) return null

  return <div className="space-y-3">{cards}</div>
}

// Gate the hot-hour card to the 4–6pm local window. Separate helper so the
// intent reads clearly at the call site and we don't re-compute the Date
// inside the callouts function body.
function isHotHourWindow() {
  const h = new Date().getHours()
  return h >= 16 && h < 18
}

// ── Card components ─────────────────────────────────────────────────────────
// All cards share a rounded-2xl, overlay-icon, two-line layout so the stack
// reads as one family rather than seven unrelated prompts.

function HotHourCard({ info }) {
  const range = formatHourRange(info.hour)
  return (
    <CalloutShell
      gradient="linear-gradient(135deg, #6D28D9 0%, #DB2777 100%)"
      icon={<Clock className="w-4 h-4 text-white" />}
      watermark={<Clock className="absolute -bottom-3 -right-2 w-16 h-16 text-white/10" />}
      eyebrow="Your hot hour"
    >
      <p className="text-[15px] font-bold leading-tight">
        {range} · {info.lift.toFixed(1)}× more bookings than your average
      </p>
      <p className="text-[11px] text-white/80 mt-0.5">
        Based on {info.knocks} doors in that window over the last 60 days.
      </p>
    </CalloutShell>
  )
}

function RankMovementCard({ info }) {
  const up = info.direction === 'up'
  // Two visual personalities: gold-lime for a promotion, slate for a drop.
  // Copy stays short and direct — no "keep going!" filler on the downside,
  // just the fact of the move and the current standing.
  const gradient = up
    ? 'linear-gradient(135deg, #059669 0%, #7DC31E 100%)'
    : 'linear-gradient(135deg, #334155 0%, #1E293B 100%)'
  const Icon = up ? TrendingUp : TrendingDown
  const verb = up ? 'up' : 'down'
  const spots = Math.abs(info.delta)
  return (
    <CalloutShell
      gradient={gradient}
      icon={<Icon className="w-4 h-4 text-white" />}
      watermark={<Icon className="absolute -bottom-3 -right-2 w-16 h-16 text-white/10" />}
      eyebrow={up ? 'You climbed the board' : 'You slipped this week'}
    >
      <p className="text-[15px] font-bold leading-tight">
        #{info.priorRank} → #{info.currentRank} · {verb} {spots} {spots === 1 ? 'spot' : 'spots'}
      </p>
      <p className="text-[11px] text-white/80 mt-0.5">
        You're #{info.currentRank} of {info.total} on this week's team leaderboard.
      </p>
    </CalloutShell>
  )
}

function PersonalBestCard({ info }) {
  const bestPct    = (info.bestRate * 100).toFixed(0)
  const currentPct = info.currentRate != null ? (info.currentRate * 100).toFixed(0) : null
  return (
    <CalloutShell
      gradient="linear-gradient(135deg, #2563EB 0%, #06B6D4 100%)"
      icon={<Trophy className="w-4 h-4 text-white" />}
      watermark={<Trophy className="absolute -bottom-3 -right-2 w-16 h-16 text-white/10" />}
      eyebrow={info.isBeating ? 'You\'re beating your personal best' : 'Personal best to chase'}
    >
      <p className="text-[15px] font-bold leading-tight">
        {info.isBeating
          ? `This week: ${currentPct}% close rate — past your ${bestPct}% record`
          : `Best week ever: ${bestPct}% close rate`}
      </p>
      <p className="text-[11px] text-white/80 mt-0.5">
        {currentPct != null
          ? `You're at ${currentPct}% this week. ${info.isBeating ? 'Keep the streak going.' : 'A few strong conversations pulls you ahead.'}`
          : 'Log 2+ estimates this week to start tracking against it.'}
      </p>
    </CalloutShell>
  )
}

function LevelUpCard({ info }) {
  return (
    <CalloutShell
      gradient="linear-gradient(135deg, #F59E0B 0%, #DC2626 100%)"
      icon={<Sparkles className="w-4 h-4 text-white" />}
      watermark={<Sparkles className="absolute -bottom-3 -right-2 w-16 h-16 text-white/10" />}
      eyebrow="Level up within reach"
    >
      <p className="text-[15px] font-bold leading-tight">
        {info.xpRemaining.toLocaleString()} XP to Level {info.nextLevel} · {info.pctDone}% there
      </p>
      <p className="text-[11px] text-white/80 mt-0.5">
        One booking is worth 25 XP plus a chunk of the revenue. You're one good session away.
      </p>
    </CalloutShell>
  )
}

function DrySpellCard({ info }) {
  const hasComeback = info.comebackCount >= 2 && info.avgComebackBookings >= 1
  return (
    <CalloutShell
      gradient="linear-gradient(135deg, #EA580C 0%, #FACC15 100%)"
      icon={<Flame className="w-4 h-4 text-white" />}
      watermark={<Flame className="absolute -bottom-3 -right-2 w-16 h-16 text-white/10" />}
      eyebrow="Break the streak today"
    >
      <p className="text-[15px] font-bold leading-tight">
        {info.dryDays} {info.dryDays === 1 ? 'day' : 'days'} without a booking — let's flip it
      </p>
      <p className="text-[11px] text-white/80 mt-0.5">
        {hasComeback
          ? `You've bounced back ${info.comebackCount}× before — averaging ${info.avgComebackBookings.toFixed(1)} bookings the day you broke the slump.`
          : 'Focus the first hour on your most-friendly streets — warm conversations reset the rhythm.'}
      </p>
    </CalloutShell>
  )
}

function TeamPulseCard({ info }) {
  const myShare = info.totalBookings > 0 ? Math.round((info.myBookings / info.totalBookings) * 100) : 0
  return (
    <CalloutShell
      gradient="linear-gradient(135deg, #0EA5E9 0%, #6366F1 100%)"
      icon={<Users className="w-4 h-4 text-white" />}
      watermark={<Users className="absolute -bottom-3 -right-2 w-16 h-16 text-white/10" />}
      eyebrow="Team pulse today"
    >
      <p className="text-[15px] font-bold leading-tight">
        {info.totalBookings} {info.totalBookings === 1 ? 'booking' : 'bookings'} across {info.activeReps} active {info.activeReps === 1 ? 'rep' : 'reps'}
      </p>
      <p className="text-[11px] text-white/80 mt-0.5">
        {info.myBookings > 0
          ? `${info.myBookings} of those are yours (${myShare}% of the team total).`
          : `${info.totalDoors.toLocaleString()} doors knocked collectively — time to add yours.`}
      </p>
    </CalloutShell>
  )
}

function CloseRateDiagCard({ info }) {
  return (
    <CalloutShell
      gradient="linear-gradient(135deg, #B45309 0%, #F59E0B 100%)"
      icon={<AlertTriangle className="w-4 h-4 text-white" />}
      watermark={<AlertTriangle className="absolute -bottom-3 -right-2 w-16 h-16 text-white/10" />}
      eyebrow="Close-rate check"
    >
      <p className="text-[15px] font-bold leading-tight">
        {(info.weekRate * 100).toFixed(0)}% this week · {(info.monthRate * 100).toFixed(0)}% your 30-day avg
      </p>
      <p className="text-[11px] text-white/80 mt-0.5">
        Down {info.dropPct.toFixed(0)}% from your baseline — worth a tune-up on your hook at the door.
      </p>
    </CalloutShell>
  )
}

// ── Shell ─────────────────────────────────────────────────────────────────────
// Every card renders through the same shell so spacing, rounding, eyebrow
// typography, and icon placement stay uniform. `watermark` is the big faded
// corner icon that gives each card visual identity.
function CalloutShell({ gradient, icon, watermark, eyebrow, children }) {
  return (
    <div
      className="rounded-2xl px-4 py-3 text-white shadow-sm relative overflow-hidden"
      style={{ background: gradient }}
    >
      <div className="flex items-start gap-2.5 relative z-10">
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-white/85">
            {eyebrow}
          </p>
          <div className="mt-0.5">{children}</div>
        </div>
      </div>
      {watermark}
    </div>
  )
}
