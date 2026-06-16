# Doorstep — Phase 0 Prototype Build Spec

**Companion to:** PRD — AI Homeowner Role-Play
**Purpose:** De-risk the three things that can kill the product before any funnel/monetization work: **voice latency, conversational realism, and per-session cost.**
**Owner:** Zach Tyler · **Status:** Draft v1 · **Updated:** 2026-06-16

> Phase 0 is a throwaway-grade prototype with one job: prove the core loop feels like a real door at an acceptable cost. Do **not** build auth, billing, score cards, or the manager view here.

---

## 1. Goal & decision gate

Build the smallest possible thing that answers: *"When a rep talks, does the AI homeowner talk back fast enough, realistically enough, and cheaply enough to build a business on?"*

**Exit criteria (all three must pass to greenlight Phase 1):**
1. **Latency:** median perceived turn time **< 1.2s**, p90 **< 1.8s** (rep stops talking → homeowner starts talking).
2. **Realism:** ≥ 5 test reps/managers rate it **≥ 4/5** on "felt like a real door," with at least a few saying they forgot it was AI.
3. **Cost:** measured **≤ $0.30/session** on the lean stack (target ~$0.12–0.15; headroom for tuning).

If latency fails: collapse the STT→LLM→TTS pipeline into a **speech-to-speech realtime API** and re-test before abandoning the approach.

---

## 2. Scope

**In scope**
- One vertical: **pest control**. One persona: **"Already-have-a-guy Greg"** (PRD appendix).
- **Text-first build** to nail conversation logic and persona behavior, then **wire voice** on top of the same core.
- Streaming voice loop with **barge-in**.
- Latency + cost instrumentation on every turn.
- A bare web page: pick "knock," talk, see/hear the homeowner respond, end session, see the raw transcript.

**Explicitly out of scope (Phase 1+)**
- Auth, accounts, billing, credits.
- Score cards, certification, manager dashboard, leaderboard.
- Multiple personas/verticals/difficulty (hardcode one).
- Polished UI, mobile packaging, email gate.

---

## 3. Architecture (prototype)

```
Browser (mic) ──audio stream──► Edge/WS server ──► STT (streaming)
      ▲                                              │ partial+final transcript
      │ audio chunks (TTS)                           ▼
      └────────────◄── TTS (streaming) ◄── LLM (persona, streaming tokens)
```

- **Repo:** start Doorstep in its **own repository** from day one (separate product, own domain, public/unauthenticated, voice-heavy deps — see PRD §9). Phase 0 may **piggyback on existing KnockIQ infra** (Supabase project, hosting) to move fast, but production will run on a **dedicated, isolated Supabase project**; don't entangle Phase 0 code with the core KnockIQ repo.
- **Single thin backend** (Supabase Edge Function or a small Node WS service) orchestrating STT → LLM → TTS. Stream at every hop; never wait for a full response before starting the next stage.
- **Stateless per turn** except an in-memory conversation array (persona system prompt + running dialogue + lightweight state flags).
- Log timing for each stage per turn (see §6).

### Recommended model choices (lean stack)
- **STT:** Deepgram Nova-3 streaming (~$0.0077–$0.0125/min) with partial transcripts + endpointing for fast turn detection.
- **LLM:** a fast, cheap chat model (e.g., GPT-4o-mini / Claude Haiku-class). Stream tokens; keep the system prompt tight to limit latency and cost.
- **TTS:** Cartesia Sonic or Deepgram Aura (~$0.03/min) for speed and price. One warm male voice for Greg.
- **Fallback path to test if latency fails:** OpenAI Realtime (speech-to-speech) to collapse hops.

### Latency tactics (build these in from the start)
- Stream STT partials; trigger the LLM on **endpoint detection**, not on silence timeout.
- Stream LLM tokens straight into TTS sentence-by-sentence (don't wait for the full reply).
- **Barge-in:** if the rep starts talking, cut TTS playback and start a new STT turn.
- Pre-warm connections; keep the persona prompt cached.

---

## 4. Persona system prompt (starter)

Ground the LLM in the persona config and strict role rules. Draft to iterate on:

```
You are role-playing a HOMEOWNER answering your front door. You are NOT an assistant.
You are Greg, ~45, a homeowner who already has a pest control provider.

CHARACTER
- Temperament: polite but dismissive. Comfortable, not hostile.
- Opening line when the door opens: "Oh — hey. We're actually all set, we've got a guy already."
- You warm up ONLY if the rep is genuinely curious about whether your current provider is
  solving your actual problems (recurring ants, scorpions in summer).
- You get annoyed and end the conversation if the rep argues, gets pushy, bashes your current
  provider, or talks more than ~90 seconds without asking you anything.

OBJECTIONS (raise naturally, weighted)
- "We already have someone" (primary)
- "It's not a good time"
- "How much is this going to cost?"
- "I'm not really interested"

WIN CONDITION (only then agree to a free inspection / next step)
- Rep differentiates on service/results AND offers a low-friction next step
  without trashing your current provider.

RULES
- Speak ONLY as Greg, in short, natural, spoken-style replies (1-2 sentences). No narration.
- Never break character, never mention you are an AI, never coach the rep.
- React to what the rep ACTUALLY said. If they nail the win condition, soften and say yes.
- If they hit a lose condition, get curt and move to close the door.
- Keep replies short — this is a doorstep, not a monologue.
```

Track lightweight **state flags** between turns (e.g., `addressed_my_real_problem`, `was_pushy`, `asked_for_next_step`, `seconds_elapsed`) and feed them back into the prompt so behavior is consistent rather than random.

---

## 5. Minimal scoring (text-only, post-session)

Scoring is not an exit criterion, but build a **single grading call** to sanity-check feasibility for Phase 1:
- After the session, send the transcript to the LLM with the PRD rubric (open / discovery / objection handling / value & urgency / close) and ask for **structured JSON** (per-dimension 0–100 + one coaching line each).
- Eyeball ~10 sessions: do the scores roughly match what a manager would say? If wildly off, note it as a Phase 1 calibration task. No UI polish needed.

---

## 6. Instrumentation (the whole point)

Capture per **turn**:
- `t_user_speech_end`, `t_stt_final`, `t_llm_first_token`, `t_tts_first_audio`, `t_homeowner_audio_start`.
- Derived: **perceived turn latency** = `t_homeowner_audio_start − t_user_speech_end`; plus per-stage deltas to find the bottleneck.

Capture per **session**:
- Duration, turn count, STT minutes, LLM tokens (in/out), TTS characters → compute **actual $ cost** from current rates.
- Outcome (booked / soft yes / callback / door closed), and the post-session realism rating (1–5) from the tester.

Dump to a simple table (Supabase) — no dashboard needed; a CSV export is fine for Phase 0 analysis.

---

## 7. Test plan

1. **Internal dogfood:** Zach + 1–2 others run ~20 sessions; tune the persona prompt, endpointing, and latency tactics until it feels natural.
2. **Latency runs:** 30+ sessions, log every turn; compute median/p90. Identify the slowest stage and optimize (usually endpointing or TTS first-chunk).
3. **Realism panel:** 5+ real canvassing reps/managers run 2 sessions each, rate 1–5, and give open feedback ("what broke the illusion?").
4. **Cost check:** from instrumentation, confirm median session cost; project at 1k/10k sessions/mo.
5. **Latency-fail contingency:** if median > 1.2s after tuning, stand up the speech-to-speech variant and re-run the latency + realism panel.

---

## 8. Build checklist

- [ ] Thin WS/edge backend orchestrating streaming STT → LLM → TTS.
- [ ] Browser page: mic capture, push-to-talk + VAD/hands-free, audio playback, end-session, transcript view.
- [ ] Greg persona prompt + state-flag tracking.
- [ ] Barge-in (interrupt TTS on new speech).
- [ ] Per-turn + per-session instrumentation → Supabase table → CSV export.
- [ ] Post-session grading call (structured JSON) for feasibility check.
- [ ] Realism rating capture (1–5) at session end.
- [ ] Speech-to-speech fallback wired but behind a flag (only if needed).

---

## 9. Effort & sequencing (rough)

| Step | Rough effort |
|---|---|
| Text-only loop (persona + grading + transcript) | ~2–3 days |
| Wire streaming STT + TTS + barge-in | ~3–5 days |
| Instrumentation + cost calc | ~1–2 days |
| Tuning to hit latency target | ~2–4 days (variable) |
| Realism panel + write-up | ~2–3 days |

Single engineer, ~2–3 weeks to a go/no-go decision. Phase 0 can piggyback on KnockIQ's Supabase/hosting to avoid standing up new infra — but the code lives in **Doorstep's own repo** from the start, and production will move to a **dedicated Supabase project** (PRD §9).
