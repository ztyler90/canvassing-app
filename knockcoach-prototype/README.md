# KnockCoach — Phase 0 Prototype

A runnable AI homeowner role-play to test the core loop. You're the rep; Claude plays the homeowner. **Talk to it** (free browser voice) or type, then end the session for a scored debrief. Every turn shows latency + estimated cost.

- **AI:** Anthropic Claude (Messages API)
- **Voice:** the browser's built-in speech-to-text + text-to-speech — **free**, no paid voice APIs yet
- **Scoring:** 5-dimension rubric, total computed in code (see `KnockCoach_Scoring_Engine_Spec.md`)

> This is the Phase 0 test rig — no auth, billing, or paid voice pipeline yet, by design. Once it "feels real," we wire production STT/TTS and the rest.

## Run it (local, on your Mac)

Requires **Node 18+** and an **Anthropic API key**. Use **Chrome or Edge** for voice (best Web Speech support).

```bash
cd knockcoach-prototype
npm install
cp .env.example .env        # then paste your ANTHROPIC_API_KEY into .env
npm start                   # → http://localhost:3000
```

Open **http://localhost:3000** in Chrome:
1. Pick a homeowner (Greg / Priya / Steve) and hit **Knock**.
2. Tap the **mic** and pitch out loud — the homeowner replies in voice. (Or toggle Voice off and type.)
3. Hit **End & Score** for the debrief.

First mic use will ask for microphone permission — allow it.

## Notes
- **Voice is browser-native** here (free) to test the *feel*. Real turn-latency in production comes from the streaming STT→LLM→TTS pipeline — that's the next phase. The latency shown is just Claude's text response time.
- **Model:** defaults to `claude-sonnet-4-6` for realism. For cheaper/faster runs set `CHAT_MODEL=claude-haiku-4-5-20251001` in `.env`.
- **Cost:** see the per-turn `~$` readout and `sessions.log`.
- **Browser support:** speech-to-text needs Chrome/Edge. Safari/Firefox: typing still works; you'll see a notice.

## Files
| File | Purpose |
|---|---|
| `server.js` | Express server: `/api/chat` (turn), `/api/score` (grade), `/api/personas`. Calls Claude. |
| `personas.js` | Persona configs + system-prompt builder |
| `public/index.html` | Dark-blue app UI + browser voice |
| `sessions.log` | Appended instrumentation (created on first run) |

## What to look for
1. **Realism** — does the homeowner react to what you actually said? Does it feel like a real door?
2. **Scoring sanity** — do the scores roughly match a manager's judgment?
3. **The voice feel** — is talking to it natural enough to build on?

## Next steps after this passes
- Wire production streaming STT→LLM→TTS with barge-in (the real latency test).
- Add the score-card image, email gate, accounts/credits (Phase 1).
