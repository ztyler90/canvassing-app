# KnockIQ Canvassing App — Data Inventory Audit

Grounded in source under `/Users/zachtyler/Documents/Claude/outputs/canvassing-app`. Optional/env-gated paths are flagged inline.

## Sub-processors actually invoked from code

| Service | Region | Triggered by | Personal data sent |
|---|---|---|---|
| Supabase (Postgres, Auth, Storage, Edge Fns) | US (project-dependent) | All persistence/auth | All tables below + audio + photos + avatars |
| OpenAI Whisper (`api.openai.com/v1/audio/transcriptions`) | US | `transcribe-voice` edge fn | Raw audio blob (rep voice; may contain homeowner-identifying speech) |
| Resend (`manage-team`) | US/EU | Rep invite/magic-link | Rep email, full_name, org name |
| Stripe (`create-subscription`, `stripe-webhook`) | US | Org owner subscribes | Owner email, stripe ids, subscription metadata |
| OpenStreetMap tiles (`{s}.tile.openstreetmap.org`) | DE | Every map render (`MapView.jsx`, `TerritoryMap.jsx`) | Rep/manager IP + viewport coords |
| Overpass (`overpass-api.de`, `overpass.kumi.systems`) | DE/EU | Reverse geocoding | Rep IP + door lat/lng |
| Nominatim (`nominatim.openstreetmap.org`) | DE/EU | Fallback geocode + neighborhood lookup | Rep IP + lat/lng |
| Google Maps Geocoding | US | Only if `VITE_GOOGLE_MAPS_API_KEY` set | Rep IP + lat/lng |
| Zapier (or any webhook) | Customer-chosen | Only if manager saves a webhook URL | Session rollup: rep name/email, doors, revenue (no per-homeowner data in reviewed payload) |
| Google Fonts, unpkg.com (Leaflet CSS) | US | Every page load | IP + UA |

No analytics, session-replay, or error-tracking SDK is loaded (no Segment, PostHog, Mixpanel, GA, Sentry, FullStory, LogRocket). No service worker ships in `/public`; `App.jsx` only calls `getRegistrations().update()` defensively in the loading-screen recovery path.

---

## 1. Rep data (the canvasser using the app)

### 1a. Account & profile (`public.users` + Supabase Auth)

| Field | Source / collection | Sensitivity |
|---|---|---|
| `id` (uuid, FK `auth.users`) | Auto on signup | account id |
| `email`, `phone` (nullable, unique), `full_name` | Rep self-entry (Signup / RepJoin / SetPassword) or manager invite | contact + identity |
| `role`, `status`, `is_super_admin`, `force_password_change`, `organization_id` | Server-assigned via RPCs (`provision_new_organization`, `consume_invite_code`) | role/tenancy |
| `avatar_url` | Rep file-picker → Supabase Storage `avatars` bucket (**PUBLIC**) | photo of rep |
| `commission_config` (jsonb) | Manager input in RepDetail | wage data |
| `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `trial_ends_at` | Stripe webhook | billing |
| `user_metadata.zapier_webhook_url` | Manager Settings | integration secret |
| Password hash | Supabase Auth | credential |

### 1b. Real-time presence & location

| Field | Where | How |
|---|---|---|
| GPS breadcrumb: `lat`, `lng`, `accuracy`, `speed`, `heading`, `recorded_at` | `public.gps_points` (flushed every 30 s, ≤ 50 m accuracy gate) | `navigator.geolocation.watchPosition` — `src/lib/gps.js` |
| Live rep pin: `lat`, `lng`, `updated_at` | `public.rep_locations` (upsert ~every 30 s during active session) | Same watch stream via `upsertRepLocation` |
| Wake-lock (screen-on) | Client only | `navigator.wakeLock.request('screen')` — `src/lib/wakeLock.js` |
| Device motion (accelerometer x/y/z, gravity-adjusted) | RAM only, never persisted | `DeviceMotionEvent` — `src/lib/motion.js`. iOS requires explicit `requestPermission`. Only used to classify walking/vehicle/stationary. |

**Continuous geolocation**, broadcast to the manager dashboard in real time (`getActiveRepLocations`, rendered in `ManagerDashboard.jsx`). Will keep tracking after-hours if the rep forgets to end the session.

### 1c. Voice & audio

| Field | Where | How |
|---|---|---|
| Raw audio blob (webm/mp4/ogg/wav, ≤ 25 MB, ≤ 90 s) | POST'd to `transcribe-voice` edge fn → forwarded to OpenAI Whisper. **No KnockIQ-side retention** found (no Storage write in `transcribe-voice/index.ts`); OpenAI's retention applies | `getUserMedia({audio:true})` + `MediaRecorder` — `VoiceNoteButton.jsx` |
| Whisper transcript text | Returned to client; appended to `interactions.notes` only if rep saves the modal | OpenAI response |

Sensitivity: **biometric-adjacent** voice capture, **US transfer** (OpenAI), and the transcript can quote homeowners.

### 1d. Performance telemetry on the rep

Derived from `canvassing_sessions` + `interactions`: doors / conversations / estimates / bookings / revenue per session/day/week, hour-of-day conversion (`getRepOutcomesForHour`), org-level "healthy / at-risk / churning" label exposed to super-admin (`getOrganizationInsightsSummary`).

### 1e. Browser-local storage on the rep's device

| Key | Storage | Contents |
|---|---|---|
| `knockiq:active-session-v1` | localStorage (`SessionContext.jsx`) | Current session row + all logged interactions (**includes homeowner contact info**) until session ends |
| `knockiq:rep-prefs-v1` | localStorage (`lib/prefs.js`) | UI prefs |
| `knockiq:onboarding-callout:<org_id>` | localStorage (`ManagerDashboard.jsx`) | Dismissed-banner flag |
| Supabase auth session (JWT + refresh token) | localStorage (supabase-js, `persistSession: true`) | Auth credentials |

No IndexedDB use detected.

---

## 2. Customer-org data (the paying canvassing company)

| Field | Location | Sensitivity |
|---|---|---|
| Org id, name, tier, status, created_at, trial_ends_at, daily-goal config | `public.organizations` | business info |
| `invite_code`, `invite_code_enabled` | `public.organizations` | shareable join token |
| Tier change history | `public.organization_tier_history` | billing audit |
| MRR roll-up | view `organization_billing`, super-admin `getPlatformMetrics` | revenue |
| Stripe customer/subscription ids | `public.users.stripe_*` | billing |
| Service catalog (label, sort_order) | `public.organization_services` | non-PII |
| Territories (name, color, polygon, category, created_by) | `public.territories` | operational geo |
| Territory assignments + completions | `public.territory_assignments`, `public.territory_completions` | operational |
| Do-not-knock pins (address, lat, lng, reason, added_by) | `public.do_not_knock` | **homeowner-derived** — see §3 |
| DNK polygon zones (name, reason, polygon, expires_at) | `public.dnk_zones` | free-text reason may name a person |
| Zapier webhook URL | `auth.user_metadata.zapier_webhook_url` | integration secret |

---

## 3. Homeowner data (third-party data subjects who never consented)

This is the highest-risk surface. Homeowners do not have accounts, are never shown a notice, and in many cases never opened the door — yet records about them are created.

### 3a. `public.interactions` — one row per door event

| Field | When populated | Notes |
|---|---|---|
| `address` | Every knock; auto-filled from reverse-geocode (Overpass → Google/Nominatim), editable | Residential address |
| `lat`, `lng` | Every knock | GPS centroid of rep's stop |
| `outcome` ('no_answer'\|'not_interested'\|'estimate_requested'\|'booked') | Every knock | Behavioral observation; even no-answer creates a row |
| `contact_name`, `contact_phone`, `contact_email` | Estimate/Booked | Homeowner contact info |
| `service_types[]`, `estimated_value` | Estimate/Booked | Purchase interest + quoted price |
| `notes` | Any outcome (optional) | Free-form; may be a Whisper transcript quoting the homeowner |
| `photo_urls` (jsonb) | Any outcome | Files uploaded to Supabase Storage `interaction-photos` (**PUBLIC** bucket per `20260413_photos_followup.sql`). Likely subjects: roofs/gutters/driveways — could incidentally include people, vehicles, plates |
| `follow_up`, `follow_up_notes` | Flag + free text | Re-contact notes |
| `rep_id`, `session_id`, `organization_id`, `created_at`, `updated_at` | Auto | — |

### 3b. Derivative homeowner data created without any homeowner interaction

- A row is created **for every door visited including "no answer"** — a record about a household tied to a precise address.
- `gps_points` breadcrumb implicitly identifies residences the rep walked past or paused near, with timestamps.
- `getAllDoorHistory` exposes up to 2000 recent doors org-wide on the rep map with rep name.
- `getOrgRecentInteractions` (coverage heatmap) shows up to 10 000 interaction lat/lngs over 30 days.
- `do_not_knock` rows store address + lat/lng + free-text `reason` (added by reps/managers; may name the complaining homeowner).

### 3c. Photo bucket exposure

Both `interaction-photos` and `avatars` are configured as **public** Supabase Storage buckets — URL knowledge = read access. Filenames are randomized (`${interactionId}/${Date.now()}_${randomBase36}.${ext}`); this is obscurity, not ACL.

### 3d. Voice transcripts about homeowners

VoiceNoteButton → `transcribe-voice` edge fn → OpenAI Whisper with hard-coded prompt about canvassing services. Transcript returns to client and lands in `interactions.notes` if the modal is saved. Audio itself not retained by KnockIQ per reviewed code; confirm OpenAI zero-retention setting.

### 3e. Where homeowner data flows

| Destination | What goes there |
|---|---|
| Supabase Postgres | Everything in §3a |
| Supabase Storage `interaction-photos` (public) | Photos |
| OpenAI Whisper | Voice audio during dictation |
| OSM Overpass / Nominatim / Google | Door lat/lng (geocoder sees lat/lng + rep IP) |
| OSM tile server | Viewport coords whenever a map is rendered |
| Zapier webhook (optional) | Session rollup only — no per-homeowner data in the reviewed payload |
| Resend | Not used for homeowner data |

---

## Items NOT collected (verified by absence)

- No SSN, DOB, or government-ID fields anywhere.
- No solicited photo of the homeowner; the photo input is generic.
- No screen-recording, session-replay, or "watch the rep work" beyond the live GPS pin.
- No analytics or error-tracking SDK.
- No service worker file ships; only a defensive `getRegistrations().update()` in the loading-screen recovery path.
- No background-location library; tracking only runs while the tab is foreground (`wakeLock.js` docstring).
- No backend SMS sending; phone numbers surface only via `tel:`/SMS deep-links for the rep.

---

## Flags for counsel

1. **Homeowner data collected at scale with no notice/consent mechanism** — every door (including "no answer") produces a record at a precise address; contact info on conversations.
2. **Public Supabase Storage buckets** for `interaction-photos` and `avatars`.
3. **Continuous GPS tracking of the rep**, live-streamed to managers, full breadcrumb retained.
4. **Voice audio transmitted to OpenAI (US).** Verify zero-retention on the OpenAI account.
5. **Geocoding leaks each door's coordinates** to OSM Overpass / Nominatim / Google.
6. **No retention/deletion lifecycle** found for `interactions`, `gps_points`, `do_not_knock`, photos, or audio.
7. **Super-admin role bypasses tenancy RLS** — cross-org read for internal support.
8. `do_not_knock.reason` and `interactions.notes` are free-text and likely contain third-party PII dictated by reps.
