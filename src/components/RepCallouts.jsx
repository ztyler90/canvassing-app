/**
 * RepCallouts — the stack of personalized nudge cards on RepHome, shown
 * between the Start Canvassing button and the Goal / Level scoreboard.
 *
 * Every card:
 *   - Is powered by pure helpers in lib/callouts.js (or computeBestHour in
 *     lib/repStats.js). All data shaping happens up there.
 *   - Renders null when its payload is null — never a "not enough data" stub.
 *   - Carries a dismiss "✕". Basic reps no longer toggle callouts in Settings;
 *     instead they close the ones they don't want and the choice is remembered
 *     in lib/prefs.js (keyed by the card's stable id). A dismissed card stays
 *     hidden on future loads until prefs are reset.
 *
 * Ordering below is intentional: positive momentum first (hot hour, goal pace,
 * rank/rival, personal best, milestone, level-up), then activating nudges
 * (dry spell, team pulse), then diagnostic / coaching (close rate). Negative
 * prompts sit last so the card stack doesn't lead with a scold.
 *
 * To keep the home screen from turning into a wall of cards, we render at most
 * MAX_VISIBLE at once (highest-priority first). As a rep dismisses the top
 * ones, lower-priority cards surface into the visible window.
 */
import {
  Clock, TrendingUp, TrendingDown, Flame, Trophy,
  Sparkles, Users, AlertTriangle, Target, Swords, Medal, X,
} from 'lucide-react'
import { usePrefs, dismissCallout } from '../lib/prefs.js'
import { formatHourRange } from '../lib/repStats.js'

// Hard cap on simultaneously visible cards. Tune freely — it only controls
// how many of the (already relevance-filtered) cards render at once.
const MAX_VISIBLE = 4

export default function RepCallouts({
  bestHour       = null,
  goalPace       = null,
  rankMovement   = null,
  rivalChase     = null,
  personalBest   = null,
  milestone      = null,
  drySpell       = null,
  closeDiag      = null,
  levelProximity = null,
  teamPulse      = null,
}) {
  const prefs     = usePrefs()
  const dismissed = prefs.dismissedCallouts || {}

  // Cards in priority order. `key` doubles as the stable dismiss id, so closing
  // a card hides that whole callout type on future loads. A card is shown only
  // when its gate (payload present + any time window) passes.
  const ordered = [
    { key: 'hot-hour',  gate: bestHour && isHotHourWindow(), render: () => <HotHourCard      info={bestHour} /> },
    { key: 'goal-pace', gate: goalPace,                      render: () => <GoalPaceCard     info={goalPace} /> },
    { key: 'rank',      gate: rankMovement,                  render: () => <RankMovementCard info={rankMovement} /> },
    { key: 'rival',     gate: rivalChase,                    render: () => <RivalChaseCard   info={rivalChase} /> },
    { key: 'pb',        gate: personalBest,                  render: () => <PersonalBestCard info={personalBest} /> },
    { key: 'milestone', gate: milestone,                     render: () => <MilestoneCard    info={milestone} /> },
    { key: 'level',     gate: levelProximity,                render: () => <LevelUpCard      info={levelProximity} /> },
    { key: 'dry',       gate: drySpell,                      render: () => <DrySpellCard     info={drySpell} /> },
    { key: 'team',      gate: teamPulse,                     render: () => <TeamPulseCard    info={teamPulse} /> },
    { key: 'close-diag',gate: closeDiag,                     render: () => <CloseRateDiagCard info={closeDiag} /> },
  ]

  const visible = ordered
    .filter((c) => c.gate && dismissed[c.key] !== true)
    .slice(0, MAX_VISIBLE)

  if (visible.length === 0) return null

  return (
    <div className="space-y-3">
      {visible.map((c) => c.render())}
    </div>
  )
}

// Gate the hot-hour card to the 4–6pm local window. Separate helper so the
// intent reads clearly at the call site.
function isHotHourWindow() {
  const h = new Date().getHours()
  return h >= 16 && h < 18
}

// ── Card components ─────────────────────────────────────────────────────────
// All cards share a rounded-2xl, overlay-icon, two-line layout so the stack
// reads as one family. Each renders through CalloutShell with its own dismiss
// key so the "✕" remembers exactly which callout the rep closed.

function HotHourCard({ info }) {
  const range = formatHourRange(info.hour)
  return (
    <CalloutShell
      dismissKey="hot-hour"
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

function GoalPaceCard({ info }) {
  const remainingLabel = info.isRevenue
    ? `$${Math.round(info.remaining).toLocaleString()}`
    : `${info.remaining} ${info.countNoun}`
  return (
    <CalloutShell
      dismissKey="goal-pace"
      gradient={info.hit
        ? 'linear-gradient(135deg, #059669 0%, #10B981 100%)'
        : 'linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)'}
      icon={<Target className="w-4 h-4 text-white" />}
      watermark={<Target className="absolute -bottom-3 -right-2 w-16 h-16 text-white/10" />}
      eyebrow={info.hit ? 'Daily goal hit' : 'On pace for today'}
    >
      <p className="text-[15px] font-bold leading-tight">
        {info.hit
          ? `You hit today's goal — ${info.pctDone}% and climbing`
          : `${remainingLabel} to go · ${info.pctDone}% of today's goal`}
      </p>
      <p className="text-[11px] text-white/80 mt-0.5">
        {info.hit
          ? 'Everything from here is gravy. Stack a few more before you wrap.'
          : 'One solid conversation closes the gap. Keep the pace up.'}
      </p>
    </CalloutShell>
  )
}

function RankMovementCard({ info }) {
  const up = info.direction === 'up'
  // Two visual personalities: green-lime for a promotion, slate for a drop.
  const gradient = up
    ? 'linear-gradient(135deg, #059669 0%, #7DC31E 100%)'
    : 'linear-gradient(135deg, #334155 0%, #1E293B 100%)'
  const Icon = up ? TrendingUp : TrendingDown
  const verb = up ? 'up' : 'down'
  const spots = Math.abs(info.delta)
  return (
    <CalloutShell
      dismissKey="rank"
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

function RivalChaseCard({ info }) {
  const gap = info.bookingsGap
  return (
    <CalloutShell
      dismissKey="rival"
      gradient="linear-gradient(135deg, #7C3AED 0%, #2563EB 100%)"
      icon={<Swords className="w-4 h-4 text-white" />}
      watermark={<Swords className="absolute -bottom-3 -right-2 w-16 h-16 text-white/10" />}
      eyebrow="Catch the rep ahead"
    >
      <p className="text-[15px] font-bold leading-tight">
        {gap} {gap === 1 ? 'booking' : 'bookings'} behind {info.rivalName}
      </p>
      <p className="text-[11px] text-white/80 mt-0.5">
        Pass them for #{info.myRank - 1} this week. {gap === 1 ? 'One booking does it.' : `${gap} bookings closes the gap.`}
      </p>
    </CalloutShell>
  )
}

function PersonalBestCard({ info }) {
  const bestPct    = (info.bestRate * 100).toFixed(0)
  const currentPct = info.currentRate != null ? (info.currentRate * 100).toFixed(0) : null
  return (
    <CalloutShell
      dismissKey="pb"
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
          : 'Log 2+ conversations this week to start tracking against it.'}
      </p>
    </CalloutShell>
  )
}

function MilestoneCard({ info }) {
  const targetLabel = info.isRevenue
    ? `$${info.target.toLocaleString()}`
    : `${info.target.toLocaleString()} ${info.noun}`
  const remainingLabel = info.isRevenue
    ? `$${Math.round(info.remaining).toLocaleString()}`
    : `${info.remaining.toLocaleString()} ${info.noun}`
  return (
    <CalloutShell
      dismissKey="milestone"
      gradient="linear-gradient(135deg, #D97706 0%, #DB2777 100%)"
      icon={<Medal className="w-4 h-4 text-white" />}
      watermark={<Medal className="absolute -bottom-3 -right-2 w-16 h-16 text-white/10" />}
      eyebrow="Milestone within reach"
    >
      <p className="text-[15px] font-bold leading-tight">
        {remainingLabel} from {targetLabel} {info.isRevenue ? 'booked' : ''}
      </p>
      <p className="text-[11px] text-white/80 mt-0.5">
        You're {info.pctDone}% of the way to a career milestone. So close.
      </p>
    </CalloutShell>
  )
}

function LevelUpCard({ info }) {
  return (
    <CalloutShell
      dismissKey="level"
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
      dismissKey="dry"
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
      dismissKey="team"
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
      dismissKey="close-diag"
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
// corner icon that gives each card visual identity. `dismissKey` wires the
// top-right "✕" that closes (and remembers) this callout.
function CalloutShell({ dismissKey, gradient, icon, watermark, eyebrow, children }) {
  return (
    <div
      className="rounded-2xl px-4 py-3 text-white shadow-sm relative overflow-hidden"
      style={{ background: gradient }}
    >
      {dismissKey && (
        <button
          type="button"
          onClick={() => dismissCallout(dismissKey)}
          aria-label="Dismiss this callout"
          className="absolute top-2 right-2 z-20 w-6 h-6 rounded-full bg-white/15 hover:bg-white/30 active:bg-white/40 flex items-center justify-center transition-colors"
        >
          <X className="w-3.5 h-3.5 text-white" />
        </button>
      )}
      <div className="flex items-start gap-2.5 relative z-10 pr-7">
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
