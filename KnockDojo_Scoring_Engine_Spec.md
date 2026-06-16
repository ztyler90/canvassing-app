# KnockDojo — Scoring Engine Spec

**Companion to:** PRD §6 (scoring & coaching)
**Purpose:** Define exactly how a session is graded — the LLM call, the rubric, the JSON contract, and how to make scores feel **fair, consistent, and useful** rather than random.
**Owner:** Zach Tyler · **Status:** Draft v1 · **Updated:** 2026-06-16

---

## 1. Design principles

1. **Deterministic enough to trust.** Reps will rage-quit if the same pitch scores 60 then 85. Low temperature, fixed rubric, anchored examples.
2. **Specific over generic.** Coaching must quote the rep's actual words and the homeowner's reaction — no fortune-cookie advice.
3. **Outcome-aware, not outcome-only.** A rep can play it well and still get a "no" from a difficulty-5 persona. Score the *behavior*, weight the outcome lightly.
4. **Fast & cheap.** One structured call on the transcript (~$0.01–0.03). Runs after the session; never blocks the conversation.
5. **Coachable.** Every score comes with one concrete "try this next time."

---

## 2. The rubric (matches PRD §6)

| Dimension | Weight | What "good" looks like |
|---|---|---|
| **Open / first 10s** | 20% | Disarms, earns the next 30 seconds, matches the homeowner's energy. |
| **Discovery** | 15% | Asks questions; surfaces the real concern / decision-maker before pitching. |
| **Objection handling** | 25% | Addresses the actual objection (not a script); reframes vs. caves. |
| **Value & urgency** | 20% | Clear, relevant benefit; a credible reason to act — without hype. |
| **Close / next step** | 20% | Asks for a specific next step (inspection/appointment); doesn't drift. |

**Total = weighted sum, 0–100.** Each dimension scored 0–100 first, then weighted.

**Adjustments:**
- **Difficulty modifier:** dimension scores are graded *relative to the persona's difficulty* — handling a d5 hostile objection well scores higher than the same line against a d1. The model is told the difficulty.
- **Outcome nudge:** ±up to 5 points total based on outcome (booked > soft-yes > callback > door closed), capped so behavior dominates.
- **Hard floors:** if the rep was pushy/argumentative or never asked for anything, objection-handling/close are capped low regardless of eloquence.

---

## 3. The grading call

**Model:** a capable, cheap model (GPT-4o-class / Claude Sonnet-class). **Temperature ≤ 0.2.** Force structured output (JSON mode / tool schema).

**Inputs:** persona config (display_name, difficulty, win/lose conditions), the full transcript with speaker labels and the final outcome.

### System prompt (draft)

```
You are an expert door-to-door sales coach grading a single practice conversation
between a REP and a simulated HOMEOWNER. Be fair, specific, and consistent.

You will receive: the persona (with difficulty 1-5 and its win/lose conditions),
the full transcript, and the outcome.

Grade FIVE dimensions, each 0-100:
1. open            - first ~10 seconds: did they disarm and earn the right to continue?
2. discovery       - did they ask questions / find the real concern or decision-maker?
3. objection       - did they address the ACTUAL objection and reframe, vs. cave or argue?
4. value_urgency   - clear, relevant benefit and a credible reason to act (no hype)?
5. close           - did they ask for a specific next step?

GRADING RULES
- Grade RELATIVE TO DIFFICULTY: handling a hard (d4-5) objection well earns more credit
  than the same move against an easy (d1-2) homeowner.
- Reward addressing the real concern; penalize generic scripts that ignore what the
  homeowner actually said.
- HARD CAPS: if the rep was pushy/argumentative, cap 'objection' <= 40.
  If the rep never asked for any next step, cap 'close' <= 25.
- Behavior dominates; outcome is a minor factor only.
- Quote the rep's ACTUAL words in coaching. No generic advice.
- Be consistent: similar performance must yield similar scores. Low variance.

Return ONLY valid JSON matching the provided schema.
```

### Output schema

```json
{
  "type": "object",
  "required": ["dimensions", "total", "verdict", "coaching", "try_next", "outcome_note"],
  "properties": {
    "dimensions": {
      "type": "object",
      "required": ["open", "discovery", "objection", "value_urgency", "close"],
      "properties": {
        "open":          { "type": "object", "required": ["score","reason"], "properties": { "score": {"type":"integer","minimum":0,"maximum":100}, "reason": {"type":"string"} } },
        "discovery":     { "type": "object", "required": ["score","reason"], "properties": { "score": {"type":"integer","minimum":0,"maximum":100}, "reason": {"type":"string"} } },
        "objection":     { "type": "object", "required": ["score","reason"], "properties": { "score": {"type":"integer","minimum":0,"maximum":100}, "reason": {"type":"string"} } },
        "value_urgency": { "type": "object", "required": ["score","reason"], "properties": { "score": {"type":"integer","minimum":0,"maximum":100}, "reason": {"type":"string"} } },
        "close":         { "type": "object", "required": ["score","reason"], "properties": { "score": {"type":"integer","minimum":0,"maximum":100}, "reason": {"type":"string"} } }
      }
    },
    "total": { "type": "integer", "minimum": 0, "maximum": 100 },
    "verdict": { "type": "string", "description": "one-line summary, e.g. 'Strong open, lost it on price'" },
    "coaching": {
      "type": "array",
      "minItems": 2, "maxItems": 3,
      "items": { "type": "object", "required": ["quote","issue","fix"],
        "properties": { "quote": {"type":"string"}, "issue": {"type":"string"}, "fix": {"type":"string"} } }
    },
    "try_next": { "type": "string", "description": "one concrete thing to try next session" },
    "outcome_note": { "type": "string" }
  }
}
```

**Total computation:** compute the weighted sum **in code** from the five dimension scores (don't trust the model to do the arithmetic), then apply the outcome nudge and caps in code. The model returns dimension scores + narrative; code owns the math. This is the single biggest consistency win.

---

## 4. Consistency & fairness (anti-randomness)

- **Temperature ≤ 0.2** and **fixed prompt/rubric** version (store `rubric_version` on every score).
- **Code-side math** for the total (above) — removes arithmetic drift.
- **Few-shot anchors:** include 2–3 mini example transcripts with "correct" dimension scores in the prompt to calibrate the scale (a weak open = ~30, a great one = ~85).
- **Hard caps in code** as a backstop even if the model ignores them.
- **Self-consistency check (optional, paid tiers):** grade twice and average if the two totals differ by >10; flags genuinely ambiguous sessions.

---

## 5. Calibration plan (Phase 0 / early Phase 1)

1. Collect ~30 real practice transcripts across difficulties.
2. Have 1–2 experienced managers score them blind on the same rubric.
3. Compare model vs. manager: target **within ±8 points** on total for ~80% of sessions.
4. Tune the few-shot anchors and caps until alignment holds; lock `rubric_version`.
5. Re-run whenever the prompt or model changes (regression set).

**Metrics to watch:** model-vs-human mean absolute error; test-retest variance on the same transcript (should be small); rep-reported "felt fair" rating.

---

## 6. Surfacing to the user

- **Score card (PRD §6.1):** `total` + `verdict` — the shareable hero number.
- **Debrief:** the five dimensions with their one-line reasons (a simple bar per dimension), the 2–3 `coaching` items (quote → issue → fix), and `try_next`.
- **Trend (paid):** store every `session_scores` row; chart total + per-dimension over time so reps and managers see improvement. Certification = passing a vertical d3 persona at total ≥ threshold (e.g., 75).

---

## 7. Cost & latency

- One grading call per session: ~300–800 output tokens → **~$0.01–0.03**, well inside the credit's margin (counts toward LLM cost in PRD §8.2).
- Runs async after the session ends; show a 1–2s "scoring your pitch…" state. Never blocks the live conversation.
