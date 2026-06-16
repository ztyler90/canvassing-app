// KnockDojo Phase 0 prototype server.
// Text-first AI homeowner role-play + LLM scoring, with latency/cost instrumentation.
// Provider: OpenAI Chat Completions (swap easily — see callLLM()).

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const { PERSONAS, buildSystemPrompt } = require("./personas");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const CHAT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";
const SCORE_MODEL = process.env.SCORE_MODEL || "gpt-4o-mini";

// --- Rough cost estimate (USD per 1K tokens) for instrumentation only. Tune to your model. ---
const COST_PER_1K = {
  input: Number(process.env.COST_IN_PER_1K || 0.00015),
  output: Number(process.env.COST_OUT_PER_1K || 0.0006),
};

// Scoring rubric weights (must sum to 1.0). See KnockDojo_Scoring_Engine_Spec.md.
const WEIGHTS = { open: 0.2, discovery: 0.15, objection: 0.25, value_urgency: 0.2, close: 0.2 };
const OUTCOME_NUDGE = { booked: 5, soft_yes: 2, callback: 0, door_closed: -3 };

function estCost(usage) {
  if (!usage) return 0;
  const cin = ((usage.prompt_tokens || 0) / 1000) * COST_PER_1K.input;
  const cout = ((usage.completion_tokens || 0) / 1000) * COST_PER_1K.output;
  return +(cin + cout).toFixed(5);
}

async function callLLM(messages, { json = false, model = CHAT_MODEL } = {}) {
  if (!API_KEY) throw new Error("OPENAI_API_KEY not set. Copy .env.example to .env and add your key.");
  const body = { model, messages, temperature: json ? 0.2 : 0.8 };
  if (json) body.response_format = { type: "json_object" };
  const t0 = Date.now();
  const r = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  const latency = Date.now() - t0;
  if (!r.ok) throw new Error(`LLM ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return { content: data.choices?.[0]?.message?.content || "", usage: data.usage, latency };
}

function logEvent(row) {
  try {
    fs.appendFileSync(path.join(__dirname, "sessions.log"), JSON.stringify(row) + "\n");
  } catch (_) {}
}

// --- Chat turn: rep speaks -> homeowner replies ---
app.post("/api/chat", async (req, res) => {
  try {
    const { personaId, history = [] } = req.body;
    const persona = PERSONAS[personaId] || PERSONAS["pest-greg"];
    const messages = [{ role: "system", content: buildSystemPrompt(persona) }, ...history];
    const { content, usage, latency } = await callLLM(messages);
    const cost = estCost(usage);
    logEvent({ ts: Date.now(), type: "turn", personaId: persona.id, latency_ms: latency, cost_usd: cost, tokens: usage });
    res.json({ reply: content.trim(), latency_ms: latency, cost_usd: cost });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- Score: grade the full session. Total is computed in CODE, not by the model. ---
app.post("/api/score", async (req, res) => {
  try {
    const { personaId, history = [], outcome = "callback" } = req.body;
    const persona = PERSONAS[personaId] || PERSONAS["pest-greg"];

    const transcript = history
      .map((m) => `${m.role === "user" ? "REP" : "HOMEOWNER"}: ${m.content}`)
      .join("\n");

    const sys = `You are an expert door-to-door sales coach grading ONE practice conversation. Be fair, specific, consistent.
Persona: ${persona.display_name} (difficulty ${persona.difficulty}/5).
Win condition: ${persona.win_condition}
Lose condition: ${persona.lose_condition}

Grade FIVE dimensions, each 0-100: open, discovery, objection, value_urgency, close.
RULES:
- Grade RELATIVE TO DIFFICULTY (handling a hard objection well earns more credit).
- Reward addressing the REAL concern; penalize generic scripts.
- HARD CAPS: if the rep was pushy/argumentative, objection <= 40. If they never asked for any next step, close <= 25.
- Quote the rep's ACTUAL words in coaching. No generic advice. Low variance.
Return ONLY JSON: {"dimensions":{"open":{"score":int,"reason":str},"discovery":{...},"objection":{...},"value_urgency":{...},"close":{...}},"verdict":str,"coaching":[{"quote":str,"issue":str,"fix":str}],"try_next":str,"outcome_note":str}`;

    const { content, usage, latency } = await callLLM(
      [
        { role: "system", content: sys },
        { role: "user", content: `OUTCOME: ${outcome}\n\nTRANSCRIPT:\n${transcript}` },
      ],
      { json: true, model: SCORE_MODEL }
    );

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (_) {
      return res.status(502).json({ error: "Grader returned non-JSON", raw: content });
    }

    // --- Compute total in code (consistency win) ---
    const d = parsed.dimensions || {};
    const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));
    const dims = {
      open: clamp(d.open?.score),
      discovery: clamp(d.discovery?.score),
      objection: clamp(d.objection?.score),
      value_urgency: clamp(d.value_urgency?.score),
      close: clamp(d.close?.score),
    };
    let total = 0;
    for (const k of Object.keys(WEIGHTS)) total += dims[k] * WEIGHTS[k];
    total = clamp(Math.round(total + (OUTCOME_NUDGE[outcome] || 0)));

    const cost = estCost(usage);
    logEvent({ ts: Date.now(), type: "score", personaId: persona.id, total, latency_ms: latency, cost_usd: cost });

    res.json({ total, dimensions: { ...parsed.dimensions }, verdict: parsed.verdict, coaching: parsed.coaching, try_next: parsed.try_next, outcome_note: parsed.outcome_note, latency_ms: latency, cost_usd: cost });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/personas", (_req, res) => {
  res.json(Object.values(PERSONAS).map((p) => ({ id: p.id, name: p.display_name, vertical: p.vertical, difficulty: p.difficulty })));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`KnockDojo prototype on http://localhost:${PORT}`));
