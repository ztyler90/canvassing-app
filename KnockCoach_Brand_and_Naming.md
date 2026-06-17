# KnockCoach — Naming & Brand Direction

**Companion to:** PRD — AI Homeowner Role-Play
**Owner:** Zach Tyler · **Status:** Confirmed name · **Updated:** 2026-06-16

---

## 1. Name: **KnockCoach** ✅ (confirmed)

A coach in your pocket for door-to-door reps. Clear to a cold visitor, on-brand with KnockIQ ("Knock" family), and it frames the product around its real value — **coaching that makes you better**, not just a simulator.

- **Domain:** `knockcoach.com` available (~$11/yr). Register it (+ grab `knockcoach.ai` and a defensive `getknockcoach.com` if cheap).
- **Tagline options:** "Your pocket pitch coach." · "Practice. Score. Knock." · "Get ramp-ready before you knock."

## 2. Visual direction

**Vibe:** light, airy, and fun — a notch edgier and more energetic than KnockIQ, while staying in the same family. Bright, optimistic, confident. Feels like a modern consumer app, not enterprise software.

**Color — strong blue, minimal gradient:**
- **Primary: a strong, vibrant blue** — `#2563EB` (deep `#1D4ED8`). This is the dominant brand color; most surfaces, buttons, and the score use solid blue.
- **Gradients are sparing and subtle** — only an **aqua → vibrant blue** accent (`#22D3EE → #2563EB`) on a few hero moments (mic button, share card, the odd progress bar). No purple, no pink.
- **Light & airy base:** near-white backgrounds (`#F7FAFF` / `#FFFFFF`), soft blue/aqua tints (`#EFF4FF`, `#ECFBFE`), generous whitespace, big rounded corners (20–28px), soft diffuse shadows.

**Type — clean, modern, a little techy:**
- **Display/headings:** *Space Grotesk* (free, Google Fonts) — geometric and energetic without being loud; pairs well with strong blue.
- **Body/UI:** *Inter*.
- Big, proud numbers (the score is the hero and the shareable unit).
- Easy to swap the display face later (e.g., Sora, Plus Jakarta Sans) — it's one line in the mockups.

**Motif & system:**
- A door + a coaching cue (a whistle, a target, a speech bubble, or an upward arrow/level-up).
- **Rank/level system** for difficulty + certification — "Rookie → Pro → All-Star," laddering to **"KnockCoach Certified"** (the "ready to knock" signal for managers).
- Playful microcopy and reactions ("Door slammed 😅 — shake it off, run it back").

## 3. Runner-up (for reference)

**KnockDojo** (`knockdojo.com` + `.ai` were available) — more playful "training dojo" angle with a belt/rank metaphor. Good fallback or defensive registration, but KnockCoach reads clearer and centers the coaching value.

## 4. Platform: mobile-first web (PWA)

The voice loop (mic capture, streaming STT/TTS, audio playback) runs fine in a **mobile browser**, so KnockCoach ships as a **mobile-first web app / PWA** — not native, at least to start.

- **Why web-first:** it's a free, viral lead magnet. A shared score-card link must open and start a session in one tap — an App Store install wall would kill the K-factor.
- **Native later, cheaply:** you already use **Capacitor** for KnockIQ, so the same PWA can be wrapped into iOS/Android store builds later with no rewrite if you ever want store presence.
- Native's only real edge (background mic, push) doesn't matter for a foreground practice tool. (PRD §3/§9 already assume a React PWA.)

## 5. Action items

1. Register `knockcoach.com` (+ `.ai`).
2. Confirm the strong-blue hex against KnockIQ's exact brand blue so the family reads as intentional.
3. Confirm display font (Space Grotesk) — see the mockups file; easy to swap.
4. Confirm the rank/level + "KnockCoach Certified" system.
