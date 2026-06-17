# KnockCoach — Post-Gate Email Nurture Sequence

**Companion to:** PRD — AI Homeowner Role-Play
**Sequence type:** Lead nurture (free → paid)
**Goal:** Convert free, email-gated users into paid KnockCoach plans — route reps to Starter/Growth self-serve, route managers/owners to a Teams/Enterprise conversation.
**Trigger:** User submits email at the gate (after ~2 free sessions).
**Owner:** Zach Tyler · **Status:** Draft v1 · **Updated:** 2026-06-16

---

## 1. Strategy

**Narrative arc:** *"You just felt what real practice does → here's how to get good fast → here's the proof it works → here's how to make it stick (for you, and your whole team)."* Momentum is highest right after a session, so the sequence front-loads value and rides the score the user just earned.

**Two audience branches (set at signup via the optional role/team-size field, refined by behavior):**
- **Rep / individual** → goal is a Starter or Growth self-serve subscription.
- **Manager / owner** (or anyone who reports team_size > 1) → goal is a Teams demo / Enterprise conversation. Managers get a parallel track emphasizing ramp time, certification, and team visibility.

**Escalation logic:** value & education first → social proof → personalized "your progress" hook → direct offer with a time-boxed incentive → soft breakup. Intensity rises only after value is established.

**Exit = conversion:** user starts any paid plan (rep) or books a demo (manager). On exit, drop them from nurture and enroll in the matching post-conversion flow (onboarding for reps; sales-assist for managers).

**Cost note:** the in-app free allotment is finite (no rollover; §8 of PRD), so "you're almost out of free credits" is a real, honest urgency lever — not manufactured scarcity.

---

## 2. Sequence overview

### Rep / individual track

| # | Subject (lead option) | Purpose | Timing | Primary CTA | Condition |
|---|---|---|---|---|---|
| 1 | "Your KnockCoach score is saved 🚪" | Welcome, anchor the score, prompt next session | Day 0 (within minutes of gate) | Run your next session | All |
| 2 | "The 10 seconds that win the door" | Educational quick win; build the habit | Day 2 | Practice the opener | All who haven't converted |
| 2b | "Still thinking about that score?" | Soft re-ask for openers who didn't click | Day 3 | Beat your last score | Opened #2, no click |
| 3 | "How top reps use practice reps" | Social proof + outcome framing | Day 5 | See how it works | No conversion |
| 4 | "You're almost out of free sessions" | Honest urgency + first offer | Day 8 | Unlock unlimited-feeling practice | Near/again at free cap |
| 5 | "Last call: your first month, [X]% off" | Direct offer with deadline | Day 12 | Start Starter/Growth | No conversion |
| 6 | "Want me to close your practice file?" | Breakup; keep door open | Day 18 | Keep practicing | No conversion |

### Manager / owner track (parallel)

| # | Subject (lead option) | Purpose | Timing | Primary CTA | Condition |
|---|---|---|---|---|---|
| M1 | "Get new reps knocking faster" | Reframe KnockCoach as an onboarding system | Day 0 | See the manager view | role=manager / team_size>1 |
| M2 | "What if every new hire practiced 25 reps before day one?" | Pain → solution (ramp time) | Day 3 | Explore Teams | No demo booked |
| M3 | "How [trade] teams cut ramp time" | Social proof + ROI math | Day 6 | Book a 15-min demo | No demo booked |
| M4 | "Built for teams with constant turnover" | Enterprise scaling story (credits + certification) | Day 10 | Talk pricing | No demo booked |
| M5 | "Should I close this out?" | Breakup; offer async resources | Day 16 | Grab the ramp playbook | No conversion |

---

## 3. Full email drafts — Rep track

> Tokens: `{{first_name}}`, `{{last_score}}`, `{{best_score}}`, `{{free_sessions_left}}`, `{{vertical}}`. Tone: plain-spoken, rep-to-rep, no corporate fluff. One CTA each.

### Email 1 — Welcome / anchor the score (Day 0)
- **Subject options:** "Your KnockCoach score is saved 🚪" · "{{first_name}}, you scored {{last_score}}" · "Nice first reps — here's what's next"
- **Preview:** "Pick up where you left off and beat it."
- **Purpose:** Confirm the account, anchor the score, drive an immediate second session while motivation is hot.
- **Body:**
  > {{first_name}} — you scored **{{last_score}}** on your first practice door. That's a real baseline, and it only goes up from here.
  >
  > The reps who improve fastest do one thing: short, frequent practice. Two minutes between real doors beats an hour of theory.
  >
  > Your saved progress and personas are ready. Want to beat {{last_score}}?
- **CTA:** **Run your next session →**
- **Segment notes:** All new signups.

### Email 2 — Quick win (Day 2)
- **Subject options:** "The 10 seconds that win the door" · "Most pitches die in the first sentence" · "Steal this opener"
- **Preview:** "The part of the pitch that matters most — and how to drill it."
- **Purpose:** Teach something genuinely useful so the email earns trust; tie the lesson to a practice rep.
- **Body:**
  > Homeowners decide whether to keep listening in about 10 seconds. Nail the open and everything after gets easier.
  >
  > Three things a strong open does: **disarm** (you're not what they fear), **earn 30 seconds** (give a reason to keep the door open), and **read the room** (match their energy).
  >
  > Want to drill it? Run a session and focus only on your first two lines. KnockCoach's homeowner will react like the real thing.
- **CTA:** **Practice the opener →**
- **Segment notes:** Everyone not yet converted.

### Email 2b — Soft re-ask (Day 3, branch)
- **Subject options:** "Still thinking about that {{last_score}}?" · "Your door's still open"
- **Preview:** "One more rep takes two minutes."
- **Purpose:** Re-engage openers who didn't click #2 with a lower-friction ask.
- **Body:**
  > No pressure — just a nudge. You're one quick session away from a higher score, and the homeowner's waiting.
- **CTA:** **Beat your last score →**
- **Segment notes:** Opened #2, didn't click. Replaces #3 for this micro-segment, then rejoins at #4.

### Email 3 — Social proof (Day 5)
- **Subject options:** "How top reps use practice reps" · "The flight-simulator trick for door-knocking" · "Why your best closer would use this"
- **Preview:** "Practice on a fake door before you waste a real one."
- **Purpose:** Position practice as what serious reps do; introduce outcome framing.
- **Body:**
  > Pilots train in simulators before they fly. Top reps do the same thing — they rehearse objections until the answers are automatic.
  >
  > That's all KnockCoach is: a realistic door you can knock as many times as you want, with instant coaching on what landed and what didn't.
  >
  > The difference shows up on the porch — fewer frozen moments, faster recovery on "I'm not interested."
- **CTA:** **See how it works →**
- **Segment notes:** No conversion.

### Email 4 — Honest urgency + first offer (Day 8)
- **Subject options:** "You're almost out of free sessions" · "{{free_sessions_left}} free reps left" · "Keep your streak going"
- **Preview:** "Here's how to keep practicing without limits."
- **Purpose:** Use the real free cap as urgency; introduce paid plans as the way to keep momentum.
- **Body:**
  > Heads up — you've got **{{free_sessions_left}}** free sessions left.
  >
  > A paid plan gives your team a monthly pool of practice credits, all personas, hard mode, and your full coaching history. Ramp a new rep in ~25–30 reps; keep yourself sharp the rest of the month.
  >
  > Starter is **$49/mo (60 sessions)** — plenty to build the habit.
- **CTA:** **Keep practicing →** (→ pricing)
- **Segment notes:** At/near free cap.

### Email 5 — Direct offer + deadline (Day 12)
- **Subject options:** "Last call: [X]% off your first month" · "Your offer expires Friday" · "Lock in your first month"
- **Preview:** "A little push to make practice a habit."
- **Purpose:** Convert fence-sitters with a time-boxed incentive.
- **Body:**
  > Quick one: for the next 3 days, your first month is **[X]% off**.
  >
  > If the practice helped — even a little — the habit is what compounds. Start a plan, keep your streak, and walk up to real doors warmed up.
- **CTA:** **Claim my first month →**
- **Segment notes:** No conversion. Suppress if already paid.

### Email 6 — Breakup (Day 18)
- **Subject options:** "Want me to close your practice file?" · "Last one from me" · "Door's still open"
- **Preview:** "No hard feelings — your progress is saved either way."
- **Purpose:** Final nudge via gentle loss-aversion; reduce list fatigue.
- **Body:**
  > I'll stop emailing after this. Your score ({{best_score}}) and progress stay saved if you want to come back.
  >
  > If practice ever feels worth two minutes between doors, you know where to find us.
- **CTA:** **Keep practicing →**
- **Segment notes:** No conversion. Exit to low-frequency "tips" list afterward.

---

## 4. Full email drafts — Manager track

> Extra tokens: `{{company}}`, `{{team_size}}`. Tone: ROI- and time-focused; speak to ramp time and turnover.

### Email M1 — Reframe as onboarding system (Day 0)
- **Subject options:** "Get new reps knocking faster" · "An onboarding rep that never gets tired" · "{{first_name}}, the manager view is ready"
- **Preview:** "Assign practice, see who's ready, before they hit a real street."
- **Purpose:** Shift the frame from personal tool → team onboarding system.
- **Body:**
  > You just tried what your new hires would. Now imagine every rep doing 25 reps against realistic objections **before** their first shift.
  >
  > KnockCoach Teams lets you assign practice, set a "ready to knock" bar, and see each rep's scores and weak spots — so nobody learns on your best neighborhoods.
- **CTA:** **See the manager view →**
- **Segment notes:** role=manager or team_size>1.

### Email M2 — Pain → solution (Day 3)
- **Subject options:** "What if every hire practiced before day one?" · "Stop burning doors on training" · "Your ramp time, cut"
- **Preview:** "The cost of learning on real doors — and the fix."
- **Purpose:** Quantify the pain of slow ramp; position certification.
- **Body:**
  > Every new rep who learns on real doors costs you twice: the doors they burn and the weeks before they produce.
  >
  > KnockCoach compresses that. Reps drill objections until the answers are automatic, earn a **"KnockCoach Certified"** badge, and you get a ramp scorecard showing exactly who's ready.
- **CTA:** **Explore Teams →**
- **Segment notes:** No demo booked.

### Email M3 — Social proof + ROI (Day 6)
- **Subject options:** "How {{vertical}} teams cut ramp time" · "The math on faster ramp" · "One extra deal pays for the year"
- **Preview:** "A simple ROI you can run on a napkin."
- **Purpose:** Make the financial case; drive a demo.
- **Body:**
  > Napkin math: if practice helps a new rep book **one** extra deal in month one, it's paid for itself many times over.
  >
  > Teams with high turnover get the most out of it — you're always onboarding, so practice runs constantly. Credits are pooled across your team and scale with you.
  >
  > Want me to walk through the manager view on a quick call?
- **CTA:** **Book a 15-min demo →**
- **Segment notes:** No demo booked.

### Email M4 — Enterprise scaling story (Day 10)
- **Subject options:** "Built for teams with constant turnover" · "Pricing that scales with your headcount" · "For {{team_size}}+ reps"
- **Preview:** "Committed credits, auto-replenish, one price that grows with you."
- **Purpose:** For larger teams, introduce Enterprise (committed annual credits, auto-replenish, platform features).
- **Body:**
  > If you're onboarding constantly, you don't want to think about per-seat math. Enterprise gives you a committed annual credit pool at a volume rate, auto-replenish for hiring spikes, plus SSO, admin, and KnockIQ integration.
  >
  > The bigger you get, the better the per-credit rate. Let's size it to your hiring plan.
- **CTA:** **Talk pricing →**
- **Segment notes:** team_size large / Enterprise-fit. No conversion.

### Email M5 — Breakup + async resource (Day 16)
- **Subject options:** "Should I close this out?" · "Last one — grab the playbook" · "Door's open when you're ready"
- **Preview:** "A free ramp playbook even if now's not the time."
- **Purpose:** Final nudge; leave value behind to stay top-of-mind.
- **Body:**
  > I'll wrap up here. If the timing's off, no worries — here's our **new-rep ramp playbook** to use regardless.
  >
  > When you're ready to make practice part of onboarding, we'll be here.
- **CTA:** **Grab the ramp playbook →**
- **Segment notes:** No conversion. Exit to quarterly check-in list.

---

## 5. Flow diagram

```
[Email gate submit] --> branch on role/team_size
        |
   ┌────┴───────────────┐
   │ Rep                 │ Manager
   ▼                     ▼
Email 1 (Day 0)      M1 (Day 0)
   │                     │
Email 2 (Day 2)      M2 (Day 3)
   │                     │
 Opened #2,           Demo booked? --Yes--> [EXIT: Sales-assist]
 no click? --Yes--> 2b (Day 3)   │No
   │No                  M3 (Day 6, demo CTA)
Email 3 (Day 5)          │
   │                  M4 (Day 10, Enterprise)
Email 4 (Day 8)          │
   │                  M5 (Day 16, breakup)
 Started plan? --Yes--> [EXIT: Rep onboarding]   │
   │No                  [EXIT: Quarterly list]
Email 5 (Day 12, offer)
   │
 Started plan? --Yes--> [EXIT: Rep onboarding]
   │No
Email 6 (Day 18, breakup)
   │
 [EXIT: Low-freq tips list]
```

---

## 6. Branching, exit & suppression rules

- **Branch at entry:** role/team_size determines Rep vs Manager track. If unknown, default to Rep but switch to Manager if they click any "team/manager" link.
- **Engagement branch:** opened-but-didn't-click on #2 → send 2b, then rejoin at #4.
- **Demo branch (manager):** clicking a demo CTA at any point exits nurture → Sales-assist flow.
- **Exit = conversion:** rep starts any paid plan; manager books a demo or starts Teams. Remove from nurture immediately.
- **Re-entry:** if a churned/free user returns and runs a new session, they may re-enter once after 60 days.
- **Suppression:** don't send if unsubscribed, already paying, in an active onboarding/sales flow, or contacted support in the last 48h. Cap total marketing emails at ~3/week across all flows.

---

## 7. A/B tests (run in order of impact)

1. **Email 4 framing** — honest scarcity ("almost out of free sessions") vs. aspiration ("keep your streak"). Split 50/50; measure click→paid. Biggest lever in the sequence.
2. **Email 1 subject** — score-personalized ("you scored {{last_score}}") vs. generic ("your score is saved"). Measure open rate.
3. **Offer in Email 5** — % off first month vs. bonus credits. Measure conversion and downstream retention (bonus credits may retain better).
4. **Manager M3 CTA** — "Book a demo" vs. "See a 2-min walkthrough" (self-serve video). Measure demo-booking + downstream close.

---

## 8. Benchmarks & metrics

Targets (lead-nurture baseline; tune with real data):

| Metric | Target |
|---|---|
| Open rate | 25–35% (Email 1 higher, 50%+) |
| Click-through | 4–8% |
| Free→paid conversion (rep track) | 3–6% |
| Demo-booked rate (manager track) | 5–10% |
| Unsubscribe | <0.5% |

Track per-email open/CTR/unsub, sequence-level free→paid and demo-booked, time-to-conversion, and drop-off points. Wire the same events into PostHog (project 470756) so the email funnel stitches to in-app behavior. Review weekly for the first month, then monthly.

---

## 9. Setup checklist (any ESP — Resend/Klaviyo/Customer.io)

1. Create the flow; enrollment trigger = `email_submitted` at the gate.
2. Add the role/team_size branch at entry.
3. Add each email with the specified delays; build the 2b engagement branch and the demo/started-plan exits.
4. Configure suppression (paid, unsubscribed, active other flow) and the 3/week global cap.
5. Pipe email events + in-app `upgrade_cta_clicked` / `plan_started` to PostHog for end-to-end funnel reporting.
