# Home page screenshots — capture guide

Drop PNG files into this folder using the exact filenames below. The home page (`/public/welcome.html`) will pick them up automatically. Each placeholder shows the filename it expects, so you can preview the page and see what's still missing.

## Capture settings

- **Account**: use the demo org (the one seeded by `seed_demo.py` — Redwood Home Services, Maya / Darius / Jake, etc.) so the data tells the same story as the rest of the page.
- **Desktop shots**: render in Chrome at **1440×900**, then crop tightly to the relevant UI (no browser chrome, no OS toolbar). Export 2× (retina) PNG for crisp display.
- **Phone shots**: use Chrome DevTools "iPhone 14 Pro" device emulation (393×852), capture the full screen, export PNG. The page wraps these in a phone frame so don't add your own.

## Files to capture

| Filename | What to capture | Demo data state | Used in section |
|---|---|---|---|
| `overview.png` | Manager → **Overview** tab. KPI sparkline strip on top, doors/bookings line chart middle. | Last 14 days populated. | Hero + Performance & Insights. |
| `active-session-phone.png` | Rep phone → **ActiveCanvassing** screen mid-session. Auto-knock pulsing, recent knocks list, timer running. | "Auto-tracking" badge visible, 30-50 knocks logged. Same session as `live-manager-view.png`. | Live View (rep side of split). |
| `live-manager-view.png` | Manager → full dashboard while the same rep is in an active session. Map + active session indicator visible. | Match the rep visible in `active-session-phone.png` — same session, both sides. | Live View (manager side of split). |
| `pipeline-board.png` | Manager → **Pipeline** tab. Full board with all phase columns visible. | At least 3-5 cards per column. Include 1 card with a closer assigned. | Pipeline section. |
| `team-chat.png` | Manager → team chat panel open, OR in-session chat bubble on rep phone. Whichever reads cleaner. | A short thread between manager + rep. | Coach Reps section (in-session chat card). |
| `leaderboard.png` | Manager → leaderboard panel only, tight crop. Top 5 reps with the improved weighted scoring. | Medals on top 3. | Coach Reps section. |
| `territory-map.png` | Manager → **Territories** view. 3-4 drawn polygons each named and color-coded by assigned rep. Optional DNK overlay. | Mix of small + medium territories, no overlaps. | Territory Management section. |
| `ai-insights.png` | Manager → insights view. Heatmap of revenue-per-area, OR a "recommended area" card. | At least one clear hot zone visible. | Performance & Insights — AI sub-card. |
| `funnel.png` | Manager → funnel/conversion chart. Vertical funnel from doors → interested → set → closed with conversion % between phases. | Real conversion data, not all 100%. | Performance & Insights — funnel sub-card. |
| `goal-tracking.png` | Manager → goals/overview. Monthly revenue goal ring with on-pace projection callout. | Goal ring around 60-78% to look "in the chase". | Performance & Insights — goals sub-card. |
| `closer-home.png` *(optional)* | Closer → home view showing assigned leads queue. | 3-5 leads queued. | Pipeline section, tertiary if room. |

## Tips for screenshots that sell

- **Hide PII**. The demo data should be safe, but double-check no real customer names/addresses show.
- **Aim for "interesting" states** — show a goal at 78% (almost there), not 0% or 100%; show a rep approaching a milestone, not flatlined.
- **Consistent time-of-day**. If most screenshots show "Today" in the afternoon, don't mix in one from 6am.
- **Light mode only** (the marketing site is light-themed).
- **Filename = lowercase, hyphens, no spaces**.
