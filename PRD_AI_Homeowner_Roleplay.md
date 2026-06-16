# PRD — AI Homeowner Role-Play ("Doorstep" — working title)

**Owner:** Zach Tyler
**Status:** Draft v1
**Last updated:** 2026-06-16
**Type:** Standalone app + KnockIQ lead magnet
**Related:** KnockIQ canvassing platform (rep training / onboarding gap)

---

## 1. Summary

A voice-first AI training app where door-to-door sales reps practice their pitch against a realistic AI "homeowner" who answers the door, raises objections, and reacts like a real person. The rep talks; the AI talks back. After the session, the rep gets a score and concrete coaching.

It ships as a **standalone, fully-branded free app** (top-of-funnel awareness + virality), and after a couple of sessions an **email gate** unlocks more reps. It's the cheapest, highest-intent lead magnet KnockIQ can put in front of its exact buyer: sales managers and reps who feel the onboarding-ramp pain every day.

**One-line positioning:** *"Flight simulator for door knockers. Practice on a fake door before you waste a real one."*

---

## 2. Problem & opportunity

- New-rep ramp is the #1 pain in door-to-door sales. Reps learn by burning real doors, which costs money and morale, and managers can't be on every porch.
- Role-play today happens awkwardly between humans — inconsistent, embarrassing, hard to schedule, impossible to measure.
- Nobody owns the "practice rep" category for canvassing. Generic AI sales-roleplay tools exist for inside/SaaS sales, but none model the **door-knock moment**: the cold open, the 3-second window, the "I'm not interested" slam, the spouse/decision-maker dynamic, the trade-specific objections.
- For KnockIQ specifically: it's a perfectly-targeted lead magnet. Anyone who finishes a session is, by definition, a canvassing rep or manager — i.e., an ICP.

---

## 3. Goals & non-goals

**Goals (v1)**
1. Deliver a believable voice role-play of a homeowner answering the door across roofing, solar, pest control, and a configurable/generic persona set.
2. Give every rep an immediate, specific pitch score + 2–3 coaching points after each session.
3. Convert free users into KnockIQ leads via an email gate and an in-app upgrade path.
4. Be shareable — reps want to send their score to a buddy or manager.

**Non-goals (v1)**
- Not a full LMS or curriculum builder.
- Not multiplayer / live human coaching.
- No deep KnockIQ account integration at launch (the app stands alone; data flows one-way into the lead funnel).
- No mobile-native build at launch if a PWA gets us there faster (revisit in Phase 2).

---

## 4. Target users

| User | Context | What they want |
|---|---|---|
| **New rep (primary)** | Days 1–30, nervous, no muscle memory | Safe reps, fast feedback, "am I getting better?" |
| **Sales manager (buyer)** | Onboarding a team, can't 1:1 coach everyone | Scalable, measurable practice; visibility into who's ready |
| **Veteran rep** | Sharpening for a new vertical or objection | Hard-mode personas, edge-case objections |
| **Curious prospect (funnel)** | Found it via social / referral | A fun, impressive 2-min demo that earns the email |

---

## 5. Core experience (v1)

### 5.1 The session loop (voice-first)
1. **Pick a scenario** — trade (roofing/solar/pest/generic), persona, difficulty.
2. **Knock** — app plays a knock + door-open SFX; the AI homeowner opens with a realistic line ("Yeah? Can I help you?").
3. **Rep pitches by voice** — speech-to-text feeds the AI; the AI homeowner responds in natural voice (TTS), staying in character, with persona-driven objections and mood.
4. **Branching conversation** — homeowner can soften, stall, object, or shut the door based on how the rep handles it. A real door can be "lost."
5. **Outcome** — booked appointment, soft yes, callback, or door closed.
6. **Debrief** — score + coaching (see §6).

### 5.2 Personas (configurable)
A persona = a JSON config the AI is grounded in. Ships with a starter library; managers/orgs can clone and edit.

Persona fields:
- **Demographic/role:** e.g., "retiree, homeowner, decision-maker" / "busy parent, defers to spouse" / "renter (disqualify)".
- **Mood/temperament:** friendly, skeptical, rushed, hostile, chatty.
- **Difficulty:** 1–5 (controls how fast they disengage and how hard the objections land).
- **Objection set:** weighted list pulled from the objection library (§5.3).
- **Win condition:** what it takes to book this person (e.g., must address spouse, must create urgency, must quantify savings).
- **Voice profile:** TTS voice + pacing.

**Starter personas by vertical:**
- *Roofing:* "Storm-skeptic Steve" (thinks it's a scam), "Insurance-savvy Sandra," "Just-replaced-it Ron."
- *Solar:* "Math-wants-the-numbers Priya," "Renter Rachel (DQ practice)," "HOA-worried Hank."
- *Pest control:* "Already-have-a-guy Greg," "DIY Dana," "Recurring-contract-wary Will."
- *Generic/configurable:* "Friendly but busy," "Hostile no-soliciting," "Curious tire-kicker."

### 5.3 Objection library
A shared, weighted bank of canvassing objections ("too expensive," "not interested," "renting," "already have someone," "bad time," "need to ask my spouse," "is this a scam"). Personas draw from it; difficulty scales frequency and persistence. This bank is the seed for a future KnockIQ Pro "objection copilot."

### 5.4 Difficulty & "hard mode"
Higher difficulty = shorter patience window, layered objections, the door closes faster. Veterans can crank it; new reps start easy and ladder up.

---

## 6. Scoring & coaching

After each session the rep gets a **Pitch Score (0–100)** plus a short debrief. Scoring is LLM-graded against a rubric and made deterministic enough to feel fair.

**Rubric dimensions (suggested weights):**
- **Open / first 10 seconds (20%)** — did they earn the right to keep talking?
- **Discovery (15%)** — did they ask questions / identify the decision-maker?
- **Objection handling (25%)** — did they address the real concern vs. talk past it?
- **Value & urgency (20%)** — clear benefit, reason to act now.
- **Close / next step (20%)** — did they ask for the appointment?

**Debrief output:**
- Score + one-line verdict ("Strong open, lost it on price").
- 2–3 specific, quoted coaching points ("When she said 'too expensive,' you dropped the price instead of reframing value").
- One thing to try next time.

### 6.1 Shareable score card (required, not optional)
Every completed session generates a **shareable score card image** — this is a core virality mechanism, not a nice-to-have, so it ships in v1.

- **Auto-generated PNG** rendered server-side (or via canvas) at the end of each session: big score ("82"), one-line verdict ("Strong open, lost it on price"), persona/vertical badge, and prominent **KnockIQ branding + URL/QR** so every share is an ad.
- **One-tap share** to the native share sheet (iMessage, Instagram/TikTok stories, X), plus copy-link and download. Format variants: square (feed) and 9:16 (stories).
- **Hook copy** auto-filled: *"I scored 82 on Doorstep 🚪 — can you beat my pitch? [link]"*. The link is a tracked referral URL feeding the funnel (§7).
- **Personal-best & streak cards** for repeat users ("New PB: 91!") to prompt re-shares.
- **Instrument** `share_card_generated` and `share_card_shared` + referral attribution so we can measure virality (K-factor) directly.

---

## 7. Lead-magnet funnel

**Stage 1 — Fully free & branded (no signup).** Anyone can run a couple of sessions immediately. Zero friction = max top-of-funnel. KnockIQ branding throughout (logo, "Powered by KnockIQ," score card).

**Stage 2 — Email gate.** After ~2 completed sessions, a gate: *"Enter your email to keep practicing — unlock all personas + your progress."* Captures name, email, optional company/role/team-size (qualifies the lead).

**Stage 3 — Nurture → KnockIQ.** Captured emails enter a nurture sequence. In-app upsells appear where KnockIQ shines: "Want your whole team practicing — and the same objection coaching live in the field? That's KnockIQ Pro."

**Funnel instrumentation (PostHog — KnockIQ already runs project 470756):**
- `session_started`, `session_completed`, `score_received`, `email_gate_shown`, `email_submitted`, `share_card_generated`, `upgrade_cta_clicked`.
- Identify by email post-gate to stitch the journey into the existing KnockIQ analytics.

**Gating config should be a server-side variable** (free-session count, which personas are gated) so it's tunable without a redeploy — use a feature flag.

---

## 8. Monetization, pricing & unit economics

Doorstep has **two jobs**: (1) be the best lead magnet KnockIQ has, and (2) stand on its own as a paid product for managers who want to train a team — independent of whether they ever buy core KnockIQ.

### 8.1 Unit economics — what a session actually costs
A practice session is short (≈2–4 min; model at **3 min avg**). The homeowner (TTS) only speaks part of the time; the rep does most of the talking (STT). Researched 2026 rates (see Sources in chat):

| Component | Rate (2026) | Per 3-min session |
|---|---|---|
| STT (Deepgram Nova-3 streaming) | ~$0.0077–$0.0125/min, ~2 min of rep speech | ~$0.02 |
| LLM (persona + grading) | ~$0.01–$0.03/min | ~$0.06 |
| TTS — **lean** (Cartesia Sonic / Deepgram Aura) | ~$0.03/min, ~1 min homeowner speech | ~$0.03 |
| TTS — **premium** (ElevenLabs Multilingual v2) | ~$0.27/min, ~1 min homeowner speech | ~$0.27 |

- **Lean stack ≈ $0.10–0.15 / session.** **Premium-voice stack ≈ $0.35–0.40 / session.** Speech-to-speech (OpenAI Realtime) lands in between (~$0.15–0.45/min uncached, much less with caching).
- **Planning number: ~$0.25/session** blended.
- **Implication:** even at modest virality this adds up — 10k free sessions/mo × $0.25 ≈ **$2.5k/mo**. Affordable as marketing spend, but it confirms two things: (a) the **email gate doubles as a cost throttle**, and (b) heavy individual use must convert to paid. Your "try twice, then pay" instinct is correct.
- **Cost strategy:** default to the **lean voice stack** for free/anonymous traffic; reserve premium voices for paid tiers. Use prompt caching and short, capped sessions. Make model choice a server-side config so we can dial quality vs. cost per tier without a redeploy.

### 8.2 Pricing tiers

| Tier | Price (proposed) | What's included | Purpose |
|---|---|---|---|
| **Free / Tryout** | $0, no signup | **2 full sessions**, lean voice, starter personas, score card | Top-of-funnel, zero friction |
| **Free + Email** | $0, email gate | A few more sessions/mo (e.g., up to ~5–8), progress saved | **Lead capture** |
| **Doorstep Pro (individual rep)** | **~$19–29/mo** (or ~$15/mo annual) | Unlimited fair-use practice, all personas, premium voice, hard mode, full coaching history | Self-serve reps |
| **Doorstep Teams (manager)** | **~$15–20 / seat / mo**, 3-seat min, volume discounts | Everything in Pro + **manager dashboard**: assign personas/onboarding tracks, see team scores, leaderboard, progress reports | **Standalone team-training revenue** |
| **KnockIQ Pro bundle** | Included free | Doorstep Teams bundled into KnockIQ Pro | Retention + the upsell destination |

Notes:
- **Fair-use cap** on unlimited individual plans (e.g., soft cap ~X sessions/day) to protect margin against power users; at $0.25/session, a $19/mo plan stays healthy up to ~60–70 sessions/mo.
- **Annual discount** (~2 months free) to improve LTV and cash.
- All prices are **proposals to validate** — keep them as server-side config / feature-flagged so they're tunable.

### 8.3 Doorstep Teams (the standalone team product)
The manager-facing plan is its own business, not just a funnel for KnockIQ:
- **Manager dashboard:** invite reps by email/seat, assign required practice (e.g., "pass 3 sessions at difficulty 3 before your first shift"), view per-rep scores, rubric breakdowns, and trend over time.
- **Onboarding tracks:** sequenced persona ladders a new hire must complete (ties to KnockIQ's onboarding-ramp pain).
- **Leaderboard** (reuse KnockIQ's existing leaderboard pattern) for friendly competition.
- **Billing:** per-seat, self-serve via Stripe (reuse KnockIQ's Stripe setup), monthly/annual.
- **Land-and-expand:** a manager who buys Doorstep Teams is a pre-qualified KnockIQ prospect — the strongest possible upsell path into the core platform.

---

## 9. Technical architecture

**Voice pipeline (the core risk — latency is the product):**
- **STT:** streaming speech-to-text (e.g., Deepgram / Whisper-streaming). Partial transcripts for responsiveness.
- **LLM:** persona-grounded chat completion with a system prompt built from the persona JSON + objection library + conversation state. Stream tokens out.
- **TTS:** low-latency streaming voice, **tiered by plan to control COGS (§8.1)** — lean voice (Cartesia Sonic / Deepgram Aura, ~$0.03/min) for free/anonymous traffic; premium voice (ElevenLabs, ~$0.27/min) for paid tiers. Voice chosen per persona; model choice is server-side config.
- **Target end-to-end latency:** < ~1.2s perceived turn time. Above ~2s it stops feeling like a door conversation. Consider a realtime/speech-to-speech API to collapse the STT→LLM→TTS hops if latency targets aren't met.
- **Barge-in:** rep can interrupt; homeowner can cut the rep off (realism + a teaching moment).

**App stack (reuse KnockIQ's existing stack to move fast):**
- **Frontend:** React PWA (mic access, push-to-talk + hands-free VAD mode). Mobile-friendly since reps live on phones.
- **Backend / data:** Supabase (auth-lite for the email gate, Postgres for sessions/scores/personas, edge functions for the voice orchestration + LLM grading). Mirrors the main app so code/ops carry over.
- **Analytics:** PostHog (shared project) + funnel events above.
- **Scoring:** a separate grading LLM call against the rubric, returning structured JSON (scores per dimension + coaching strings).

**Data model (sketch):**
- `personas` (id, vertical, config jsonb, difficulty, is_template, org_id nullable)
- `practice_sessions` (id, anon_id/email, persona_id, vertical, transcript jsonb, outcome, started_at, ended_at, duration_s)
- `session_scores` (session_id, total, open, discovery, objection, value, close, coaching jsonb)
- `leads` (email, name, company, role, team_size, first_seen, session_count, source)
- `accounts` (id, type [individual|team], owner_email, plan, stripe_customer_id, seat_count, status)
- `seats` (account_id, rep_email, assigned_tracks jsonb, status) — for Doorstep Teams

**Privacy/consent:** rep is the only speaker recorded; show a clear mic-consent prompt. Store transcripts, not raw audio, by default. Standard privacy policy + a delete-my-data path (you already run Turnstile/CSP discipline on the main app — carry the same posture here).

---

## 10. Verticals at launch

Per your call: **configurable/generic core + seeded persona packs for pest control, solar, and roofing.** Generic is the engine; the three packs prove value to the most common door-to-door trades and map directly to KnockIQ's existing customer base (incl. your Saguaro Pest and Summit Exteriors demo orgs as showcase content).

---

## 11. Roadmap

**Phase 0 — Prototype (validate latency, realism & cost)**
- **Goal:** de-risk the three things that can kill the product before investing in the funnel — voice latency, realism, and per-session cost.
- **Scope:** one vertical (pest control), one persona ("Already-have-a-guy Greg"), text-first to nail the conversation logic → then wire the voice loop.
- **Build:** STT → persona-grounded LLM → TTS, streaming, with barge-in. Instrument real turn-latency.
- **Exit criteria:** (1) perceived turn latency consistently < ~1.2s; (2) ≥5 test reps say it "feels like a real door"; (3) measured per-session cost ≤ ~$0.30 on the lean stack. If latency fails, evaluate a speech-to-speech realtime API before proceeding.
- **Decision gate:** only build Phase 1 if all three exit criteria are met.

**Phase 1 — Lead-magnet MVP**
- Voice loop, 3 verticals + generic, ~9–12 starter personas, scoring + debrief, free→email gate, share card, PostHog funnel.

**Phase 2 — Stickiness & virality**
- Progress tracking, streaks, difficulty ladder, leaderboard (ties to KnockIQ's existing leaderboard pattern), manager view ("see your team's scores").

**Phase 3 — Monetization & KnockIQ integration (dual path)**
- **Standalone:** ship Doorstep Teams (manager dashboard, seat billing, onboarding tracks) as its own paid product (§8.3) — revenue independent of core KnockIQ.
- **Embedded:** bundle Doorstep into KnockIQ Pro; org-authored personas, assign practice as onboarding, sync scores into KnockIQ rep profiles, and feed the objection library into the in-field "objection copilot."

---

## 12. Success metrics

**Lead magnet (primary):**
- Email-capture rate (% of free users who pass the gate). *Target: 25–40%.*
- Cost per lead vs. existing channels.
- Lead→KnockIQ trial conversion.
- Share-card generation rate (virality proxy).

**Product engagement:**
- Sessions per user; % who run >1 session.
- Session completion rate.
- Repeat-visit rate (came back another day).
- Median perceived turn latency (quality guardrail).

**Revenue & unit economics:**
- Free→paid conversion (individual Pro) and free→Teams conversion (manager).
- Gross margin per session / per paid seat (guardrail: keep blended COGS well under price; see §8.1).
- Teams seats sold and seat expansion within an org.
- Doorstep→KnockIQ Pro upsell rate (land-and-expand).

---

## 13. Open questions / risks

- **Latency is existential.** If the voice loop feels laggy, the illusion breaks. Phase 0 must de-risk this before anything else; budget for a realtime speech-to-speech path.
- **Voice cost at scale.** Quantified in §8.1: ~$0.10–0.40/session depending on voice quality (~$0.25 blended planning number). Mitigations: lean voice stack for free traffic, email gate + session caps as throttles, prompt caching, and converting heavy users to paid.
- **Scoring fairness.** Reps will rage if scores feel random. Pin the rubric, use structured grading, calibrate against real manager judgments.
- **Realism vs. discouragement.** Hostile personas are fun but a brutal first session could scare off a new rep — start easy, ladder up.
- **Abuse / cost control on an open app** — rate-limit anonymous sessions, Turnstile on the gate, server-side session caps.
- **Naming / brand** — "Doorstep" is a placeholder; confirm a name + domain.

---

## 14. Appendix — example persona config

```json
{
  "id": "pest-greg-already-have-a-guy",
  "vertical": "pest_control",
  "display_name": "Already-have-a-guy Greg",
  "temperament": "polite but dismissive",
  "difficulty": 3,
  "voice_profile": "warm_male_45",
  "opening_line": "Oh — hey. We're actually all set, we've got a guy already.",
  "objection_weights": {
    "already_have_provider": 0.5,
    "bad_time": 0.2,
    "price_sensitive": 0.2,
    "not_interested": 0.1
  },
  "win_condition": "Rep must differentiate on service/results AND offer a low-friction next step (free inspection) without bashing the current provider.",
  "lose_condition": "Rep argues, gets pushy, or fails to ask for anything within ~90s.",
  "notes_for_model": "Greg isn't hostile, just comfortable. He'll warm up if the rep is curious about whether his current guy is actually solving his problem (e.g., scorpions, recurring ants)."
}
```
