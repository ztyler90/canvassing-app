# KnockDojo — Phase 0 Prototype

A minimal, **text-first** AI homeowner role-play to validate the core loop before investing in the voice pipeline. You're the rep; the AI plays the homeowner. End the session to get a scored debrief. Every turn shows **latency and estimated cost** so you can sanity-check unit economics.

> This is throwaway-grade. No auth, billing, credits, or voice yet — by design (see `Doorstep_Phase0_Build_Spec.md`). Once the loop "feels real" in text, wire voice on the same backend.

## What it demonstrates
- Persona-grounded role-play (Greg / Priya / Steve, varying difficulty)
- The scoring engine: 5-dimension rubric, **total computed in code** (see `KnockDojo_Scoring_Engine_Spec.md`)
- Per-turn + per-session instrumentation (latency, tokens, est. cost → `sessions.log`)

## Run it

Requires **Node 18+** and an OpenAI API key (or any OpenAI-compatible endpoint).

```bash
cd knockdojo-prototype
npm install
cp .env.example .env        # then paste your OPENAI_API_KEY into .env
npm start                   # → http://localhost:3000
```

Open http://localhost:3000, pick a homeowner, hit **Knock**, and pitch. Hit **End & Score** for the debrief.

## Swapping the model / provider
- Defaults to `gpt-4o-mini` for both chat and grading (fast + cheap).
- Override via `.env`: `CHAT_MODEL`, `SCORE_MODEL`, `OPENAI_BASE_URL`.
- To use Anthropic or another API, edit `callLLM()` in `server.js` (one function).

## Files
| File | Purpose |
|---|---|
| `server.js` | Express server: `/api/chat` (turn), `/api/score` (grade), `/api/personas` |
| `personas.js` | Persona configs + system-prompt builder |
| `public/index.html` | Chat UI + score card |
| `sessions.log` | Appended instrumentation (created on first run) |

## What to look for (Phase 0 exit criteria)
1. **Realism** — does it react to what you actually said? Does it feel like a real door?
2. **Cost** — check the per-turn `~$` readout and `sessions.log`; project per-session cost.
3. **Scoring sanity** — do the scores roughly match a manager's judgment? (Latency here is API text latency, *not* the <1.2s voice target — that's tested when voice is wired.)

## Next steps after this passes
- Wire streaming STT → LLM → TTS with barge-in (voice turn latency is the real test).
- Add the score card image, email gate, and credit/account model (Phase 1).
