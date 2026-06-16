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
- Optional: a **shareable score card** (image) — "I scored 82 on Doorstep 🚪" with KnockIQ branding to drive virality.

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

## 8. Technical architecture

**Voice pipeline (the core risk — latency is the product):**
- **STT:** streaming speech-to-text (e.g., Deepgram / Whisper-streaming). Partial transcripts for responsiveness.
- **LLM:** persona-grounded chat completion with a system prompt built from the persona JSON + objection library + conversation state. Stream tokens out.
- **TTS:** low-latency streaming voice (e.g., ElevenLabs / Cartesia / OpenAI voices). Voice chosen per persona.
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

**Privacy/consent:** rep is the only speaker recorded; show a clear mic-consent prompt. Store transcripts, not raw audio, by default. Standard privacy policy + a delete-my-data path (you already run Turnstile/CSP discipline on the main app — carry the same posture here).

---

## 9. Verticals at launch

Per your call: **configurable/generic core + seeded persona packs for pest control, solar, and roofing.** Generic is the engine; the three packs prove value to the most common door-to-door trades and map directly to KnockIQ's existing customer base (incl. your Saguaro Pest and Summit Exteriors demo orgs as showcase content).

---

## 10. Roadmap

**Phase 0 — Prototype (validate latency & realism)**
- One vertical (pest control), one persona, text first → then wire voice. Prove the turn-latency target and that the role-play "feels real." This is the make-or-break.

**Phase 1 — Lead-magnet MVP**
- Voice loop, 3 verticals + generic, ~9–12 starter personas, scoring + debrief, free→email gate, share card, PostHog funnel.

**Phase 2 — Stickiness & virality**
- Progress tracking, streaks, difficulty ladder, leaderboard (ties to KnockIQ's existing leaderboard pattern), manager view ("see your team's scores").

**Phase 3 — KnockIQ Pro integration**
- Org-authored personas, assign practice as onboarding, sync scores into KnockIQ rep profiles, feed the objection library into the in-field "objection copilot."

---

## 11. Success metrics

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

---

## 12. Open questions / risks

- **Latency is existential.** If the voice loop feels laggy, the illusion breaks. Phase 0 must de-risk this before anything else; budget for a realtime speech-to-speech path.
- **Voice cost at scale.** A free, ungated app + paid TTS/STT/LLM per minute = real COGS. Model per-session cost; the email gate also doubles as an abuse/cost throttle.
- **Scoring fairness.** Reps will rage if scores feel random. Pin the rubric, use structured grading, calibrate against real manager judgments.
- **Realism vs. discouragement.** Hostile personas are fun but a brutal first session could scare off a new rep — start easy, ladder up.
- **Abuse / cost control on an open app** — rate-limit anonymous sessions, Turnstile on the gate, server-side session caps.
- **Naming / brand** — "Doorstep" is a placeholder; confirm a name + domain.

---

## 13. Appendix — example persona config

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
