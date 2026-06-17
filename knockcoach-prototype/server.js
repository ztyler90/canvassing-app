// KnockCoach Phase 0 prototype server.
// AI homeowner role-play + scoring via the Anthropic (Claude) Messages API,
// with latency/cost instrumentation. Browser handles voice (STT/TTS) for free.

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const { PERSONAS, buildSystemPrompt } = require("./personas");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Extract just the clean key, ignoring any stray characters/whitespace/emoji
// that may have been pasted into .env around it.
const API_KEY = (() => {
  const raw = process.env.ANTHROPIC_API_KEY || "";
  const m = raw.match(/sk-ant-[A-Za-z0-9_\-]+/);
  return m ? m[0] : raw.replace(/[^\x21-\x7E]/g, "").trim();
})();
const BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1";
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-sonnet-4-6";
const SCORE_MODEL = process.env.SCORE_MODEL || "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

// Rough cost estimate (USD per 1K tokens) for the instrumentation readout only.
// Defaults approximate Claude Sonnet; override in .env. (Haiku is much cheaper.)
const COST_PER_1K = {
  input: Number(process.env.COST_IN_PER_1K || 0.003),
  output: Number(process.env.COST_OUT_PER_1K || 0.015),
};

function estCost(usage) {
  if (!usage) return 0;
  const cin = ((usage.input_tokens || 0) / 1000) * COST_PER_1K.input;
  const cout = ((usage.output_tokens || 0) / 1000) * COST_PER_1K.output;
  return +(cin + cout).toFixed(5);
}

// Call Anthropic Messages API. `prefill` seeds the assistant's reply (used to force JSON).
async function callClaude({ system, messages, model = CHAT_MODEL, maxTokens = 400, temperature = 0.8, prefill = null }) {
  if (!API_KEY) throw new Error("ANTHROPIC_API_KEY not set. Copy .env.example to .env and add your key.");
  const msgs = prefill ? [...messages, { role: "assistant", content: prefill }] : messages;
  const t0 = Date.now();
  const r = await fetch(`${BASE_URL}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: msgs }),
  });
  const latency = Date.now() - t0;
  if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = (data.content || []).map((b) => b.text || "").join("");
  return { text, usage: data.usage, latency };
}

function logEvent(row) {
  try {
    fs.appendFileSync(path.join(__dirname, "sessions.log"), JSON.stringify(row) + "\n");
  } catch (_) {}
}

// --- Chat turn. The homeowner opens the door first (returned directly, no API call). ---
app.post("/api/chat", async (req, res) => {
  try {
    const { personaId, history = [] } = req.body;
    const persona = PERSONAS[personaId] || PERSONAS["pest-greg"];

    if (history.length === 0) {
      return res.json({ reply: persona.opening_line, opening: true, latency_ms: 0, cost_usd: 0 });
    }

    // Anthropic requires the first message to be 'user'; prepend a synthetic door-open turn.
    const messages = [
      { role: "user", content: "(You open your front door — a salesperson is standing on your porch.)" },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    const { text, usage, latency } = await callClaude({
      system: buildSystemPrompt(persona),
      messages,
      maxTokens: 200,
      temperature: 0.85,
    });
    const cost = estCost(usage);
    logEvent({ ts: Date.now(), type: "turn", personaId: persona.id, latency_ms: latency, cost_usd: cost, usage });
    res.json({ reply: text.trim().replace(/^"|"$/g, ""), latency_ms: latency, cost_usd: cost });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- Score the session. Total is computed in CODE, not by the model. ---
const WEIGHTS = { open: 0.2, discovery: 0.15, objection: 0.25, value_urgency: 0.2, close: 0.2 };
const OUTCOME_NUDGE = { booked: 5, soft_yes: 2, callback: 0, door_closed: -3 };

app.post("/api/score", async (req, res) => {
  try {
    const { personaId, history = [], outcome = "callback" } = req.body;
    const persona = PERSONAS[personaId] || PERSONAS["pest-greg"];

    const transcript = history
      .map((m) => `${m.role === "user" ? "REP" : "HOMEOWNER"}: ${m.content}`)
      .join("\n");

    const system = `You are an expert door-to-door sales coach grading ONE practice conversation. Be fair, specific, consistent.
Persona: ${persona.display_name} (difficulty ${persona.difficulty}/5).
Win condition: ${persona.win_condition}
Lose condition: ${persona.lose_condition}

Grade FIVE dimensions, each 0-100: open, discovery, objection, value_urgency, close.
RULES:
- Grade RELATIVE TO DIFFICULTY (handling a hard objection well earns more credit).
- Reward addressing the REAL concern; penalize generic scripts.
- HARD CAPS: if the rep was pushy/argumentative, objection <= 40. If they never asked for any next step, close <= 25.
- Quote the rep's ACTUAL words in coaching. No generic advice. Low variance.
Return ONLY a JSON object exactly like:
{"dimensions":{"open":{"score":int,"reason":str},"discovery":{"score":int,"reason":str},"objection":{"score":int,"reason":str},"value_urgency":{"score":int,"reason":str},"close":{"score":int,"reason":str}},"verdict":str,"coaching":[{"quote":str,"issue":str,"fix":str}],"try_next":str,"outcome_note":str}`;

    const { text, usage, latency } = await callClaude({
      system,
      messages: [{ role: "user", content: `OUTCOME: ${outcome}\n\nTRANSCRIPT:\n${transcript}` }],
      model: SCORE_MODEL,
      maxTokens: 900,
      temperature: 0.2,
      prefill: "{",
    });

    let parsed;
    try {
      parsed = JSON.parse("{" + text);
    } catch (_) {
      try { parsed = JSON.parse(text); } catch (e2) {
        return res.status(502).json({ error: "Grader returned non-JSON", raw: text });
      }
    }

    const d = parsed.dimensions || {};
    const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    const dims = {
      open: clamp(d.open?.score), discovery: clamp(d.discovery?.score),
      objection: clamp(d.objection?.score), value_urgency: clamp(d.value_urgency?.score),
      close: clamp(d.close?.score),
    };
    let total = 0;
    for (const k of Object.keys(WEIGHTS)) total += dims[k] * WEIGHTS[k];
    total = clamp(total + (OUTCOME_NUDGE[outcome] || 0));

    const cost = estCost(usage);
    logEvent({ ts: Date.now(), type: "score", personaId: persona.id, total, latency_ms: latency, cost_usd: cost });

    res.json({
      total, dimensions: parsed.dimensions, verdict: parsed.verdict,
      coaching: parsed.coaching, try_next: parsed.try_next, outcome_note: parsed.outcome_note,
      latency_ms: latency, cost_usd: cost,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/personas", (_req, res) => {
  res.json(Object.values(PERSONAS).map((p) => ({ id: p.id, name: p.display_name, vertical: p.vertical, difficulty: p.difficulty, voice: p.voice })));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`KnockCoach prototype on http://localhost:${PORT}`));
