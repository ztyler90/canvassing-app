# KnockIQ — Attorney Handoff Summary

**Prepared:** [date for delivery to counsel]
**For:** Outside counsel reviewing KnockIQ's Privacy Policy and Terms of Service before publication
**From:** [Zach Tyler], KnockIQ

This document is the executive briefing to read before the attached Privacy Policy and Terms of Service. It summarizes the legal posture, flags the highest-risk items still requiring counsel's judgment, lists every input the documents need from you, and documents the platform-engineering remediations that have already shipped.

---

## 1. What KnockIQ is and why this matters

KnockIQ is a B2B SaaS platform for door-to-door canvassing companies. Field sales representatives ("Reps") use a web/mobile-optimized application to log every door they visit. The app captures, transmits, and persists:

- **Reps' precise geolocation**, continuously, broadcast in real time to managers during an active session.
- **Visited Persons' addresses, GPS coordinates, contact information, photographs of their property, and free-text notes** — recorded when a Rep logs a conversation, estimate, or booking. **Visited Persons never sign up and never consent.**
- **No audio.** The voice-note feature that previously transmitted audio to OpenAI Whisper has been removed from the product (see Resolved Issue 2 below).

The critical legal posture: **KnockIQ is a controller (not a processor) for Visited Person data**, because no contract authorizes KnockIQ to collect it through the homeowner. That puts direct regulatory obligations on KnockIQ that cannot be pushed entirely to the canvassing-company customer.

Three background memos accompany this handoff and feed every recommendation below:

- `data_audit.md` — exhaustive inventory of every field collected, where it goes, who can access it. (Audited as of 2026-05; voice-note removal happened immediately after audit.)
- `legal_research.md` — current US state law landscape (20 comprehensive privacy laws in effect mid-2026) + Canadian PIPEDA, Quebec Law 25, AB/BC PIPA + recording-consent + biometric + TCPA + DNK.
- `homeowner_exposure.md` — controller/processor analysis, DNK registries, recording-consent risk, photo restrictions, deletion-right scope, TCPA carve-outs.

---

## 2. Platform-engineering remediations — status

The first version of this handoff listed five operational/platform issues that had to be resolved before the documents could credibly be published. Status as of the current version:

### Issue 1 — Public Supabase Storage buckets [RESOLVED]
Both `interaction-photos` and `avatars` buckets are now configured as private (`public = false`), verified directly in Supabase. Same-org RLS policies on `storage.objects` gate SELECT access; rep-owned INSERT/DELETE policies gate writes. Client code mints short-lived signed URLs via a new `lib/photos.js` helper and a smart resolver that handles both the new storage-path format and the legacy public-URL format (so existing rows continue to work). See migration `supabase/migrations/20260529_private_storage_buckets.sql`.

### Issue 2 — OpenAI / voice processing [RESOLVED by removal]
The voice-note feature, the `transcribe-voice` edge function, the `VoiceNoteButton` component, and the OpenAI Whisper sub-processor relationship have all been removed. There is no audio capture, no voiceprint generation, and no audio data flowing through the platform. This collapses BIPA exposure (the single largest dollar risk in the prior version of the product), all-party-consent recording risk across 12 states + DC, and the OpenAI cross-border-transfer disclosure obligation, in one move. The Privacy Policy and Terms have been rewritten accordingly with a forward-looking reservation: if audio is ever reintroduced, a full BIPA-compliant notice and 30-day user notice will land BEFORE the feature ships.

### Issue 3 — Retention/deletion lifecycle [RESOLVED]
A nightly `purge_expired_data()` function plus a pg_cron schedule (03:15 UTC daily) deletes:
- Interactions (general): 24 months
- Interactions (outcome = no_answer): 180 days, with the row already minimized to lat/lng + timestamp + outcome only
- Interaction photos: tied to the parent interaction (storage objects also purged in the same sweep so orphans don't accumulate)
- GPS breadcrumbs (`gps_points`): 12 months
- Live rep-location pin orphans: 24 hours
- Audit log: 12 months
- Do-not-knock: retained indefinitely (the entire point)

A separate `auto_close_idle_sessions()` function runs every 10 minutes and closes any session with no GPS or interaction activity in 60+ minutes, clearing the live `rep_locations` pin. The client-side timer in `ActiveCanvassing.jsx` warns reps at 50 minutes with a "Still canvassing?" modal and auto-ends at 60. See migrations `20260529_retention_purge.sql` and `20260529_auto_close_idle_sessions.sql`.

The retention schedule in the Privacy Policy (§12) matches the schedule the platform actually enforces. Both will need to be updated together if a value ever changes.

### Issue 4 — Homeowner data-subject request workflow [OUTSTANDING]
The Privacy Policy commits to a 45-day search-by-address workflow that touches every system where Visited Person data lives (interactions, GPS breadcrumbs, do-not-knock, photos). The intake address (`privacy@knockiq.com`) is documented in the Policy but no internal tooling exists yet to actually search by address across all systems. Until this is built, fulfilling a homeowner's deletion or access request requires a manual SQL pass.

**What's needed:** an internal admin tool that takes a street address (or a lat/lng box), surfaces all matching rows across `interactions`, `gps_points`, `do_not_knock`, and storage objects, and lets an operator export or delete with a single click. Plus a documented runbook so anyone on the on-call rotation can run the workflow inside the 45-day SLA.

### Issue 5 — Super-admin cross-tenant access logging [OUTSTANDING — verify]
A `super_admin` flag bypasses tenancy RLS for internal support purposes. The Privacy Policy's Security section claims that "every cross-tenant access event is logged." Confirm with engineering that this logging is actually in place, that the log is queryable per-Customer, and that the log itself is in the retention sweep (12 months under the audit_log policy).

---

## 3. Inputs the documents need from you

These bracketed `[INSERT — ...]` items in the Privacy Policy and Terms must be answered before publication.

### Entity and governance
- Legal entity name (e.g., "KnockIQ Software, Inc.")
- State / country of incorporation and entity type
- Principal place of business (street address)
- Registered agent
- Privacy contact: dedicated email (privacy@knockiq.com), mailing address, optional toll-free phone (required by CA if 10,000+ California consumers' data is processed annually)
- Privacy Officer for Canada (PIPEDA / Quebec Law 25 require a named person with public contact info)

### Operational items already locked in (no input needed)
- **Retention windows** — set in the migration and reflected verbatim in Privacy Policy §12. If you want different values, update both together.
- **Final export window after termination** — 30 days (Terms § 7.5)
- **Data-deletion-after-termination window** — 60 days following the export window (90 days total, Terms § 7.5)
- **Auto-renewal cancellation notice window** — 1 day before renewal (Terms § 4.4; counsel should confirm this is workable for your customer base)

### Commercial / dispute
- Choice of governing-law state (Terms § 19) — typical SaaS picks: Delaware, California, or HQ state
- Arbitration provider (Terms § 18.2) — JAMS or AAA most common
- Arbitration seat / venue (Terms § 18.2)
- Liability cap floor (Terms § 14(b)(ii) — currently $100; consider matching to insurance coverage)
- Whether KnockIQ offers any SLA (Terms § 12)

### Quebec Law 25 obligations
- Confirm whether a §17 Privacy Impact Assessment has been conducted for each cross-border transfer (now just Supabase US and OpenStreetMap Germany — OpenAI is no longer a sub-processor). If not, conduct before publication in any market with Quebec residents.
- Confirm whether the named Privacy Officer is publicly listed (required).

### Sub-processor list
- Confirm the sub-processor list in Privacy Policy Section 7 matches reality. The current list reflects the post-voice-removal state: Supabase (US), Stripe (US), Resend (US/EU), OpenStreetMap (DE), Google Maps Geocoding (env-gated, US), Customer-configured webhooks (varies), Google Fonts (US), unpkg (US). Verify against current code before publishing.

### Marketing materials review
- Cross-check all marketing claims (knockiq.com, sales decks, demo scripts) for any commitment that goes beyond what the Privacy Policy or Terms now say. Marketing-claim exposure is the most common source of "we said something we didn't deliver" liability.

---

## 4. Highest-risk substantive areas — your judgment requested

Each of these items got an `[ATTORNEY REVIEW: ...]` callout in the documents. Listed here in priority order so you can read past the boilerplate first.

### 4.1 Controller vs. processor framing for Visited Person data — Privacy Policy § 2
The draft treats KnockIQ as a controller (jointly with the Customer) for Visited Person data. This is the more defensible posture but increases direct compliance obligations. The alternative — calling KnockIQ a pure processor — likely fails because no contract authorizes the data collection through the homeowner. Confirm.

### 4.2 Customer indemnification scope — Terms § 16
Customer indemnifies KnockIQ for Rep misconduct including trespass, unauthorized photography, harassment, ignoring DNK lists, TCPA breaches, and HSSA failures. This is broad. Counsel should confirm the carve-outs your insurance requires and that the scope is enforceable in the chosen governing-law state.

### 4.3 Aggregated / de-identified data use — Terms § 7.3
The draft permits KnockIQ to derive aggregated data from Customer Data for internal use. This conflicts with MODPA's strict-necessity rule for sensitive data. If KnockIQ wants to use geolocation-derived data in cross-customer benchmarking, that must be limited to truly de-identified data per CCPA § 1798.140(m) and disclosed. Counsel should narrow if necessary.

### 4.4 Arbitration and class-action waiver — Terms § 18
Standard SaaS arbitration with class waiver. Counsel should confirm enforceability in the governing-law state (California McGill v. Citibank is the leading challenge) and confirm cost-allocation provisions don't run afoul of one-sided-cost-shifting cases.

### 4.5 California "right to know" specificity — Privacy Policy § 14 + State-Specific Disclosures
CCPA/CPRA requires specific category-of-data disclosures from the past 12 months. Counsel should review the appendix once final operational data is available, and confirm whether KnockIQ meets thresholds requiring a toll-free phone number and an authorized-agent intake process.

### 4.6 Quebec Law 25 cross-border PIA — Privacy Policy § 11
The PIA must actually exist before the Policy is published in any market with Quebec residents. The PIA must evaluate each receiving jurisdiction's "substantially equivalent" protection — US laws like the CLOUD Act and FISA 702 weigh against adequacy of US transfers. The PIA scope is now smaller than it was: with OpenAI removed, only Supabase (US) and OpenStreetMap (DE) need evaluation.

### 4.7 Data Processing Agreement (DPA) — Terms § 8
A DPA is incorporated by reference but not yet drafted. Required by 11 CCR § 7051 (California) and equivalent provisions in VA, CO, CT, TX, OR, MT, DE, NH, NJ, MD, MN, TN, IN, KY, RI, NE, IA. CPPA's Sept 2025 $1.35M settlement specifically faulted a controller for missing vendor DPAs. The DPA needs the nine § 7051 mandatory clauses. Companion drafting task.

### 4.8 Do-not-knock disclaimer language — Terms § 5.2(b), § 13
The draft explicitly disclaims any guarantee that KnockIQ's DNK feature provides comprehensive registry coverage. Counsel should verify the disclaimer survives if KnockIQ's marketing or onboarding ever implies otherwise.

### 4.9 7-year billing record retention — Privacy Policy § 12
The draft sets a 7-year retention for billing records based on common US tax-record guidance. Counsel should confirm this matches your jurisdiction (some states require longer for certain entity types).

### 4.10 Post-termination grace period — Privacy Policy § 12, Terms § 7.5
The current commitment is 90 days from termination before customer data is deleted (30-day export window + 60-day deletion). Counsel should confirm this aligns with anything KnockIQ has committed to customers contractually or in sales conversations.

---

## 5. Companion documents that should follow these two

The Privacy Policy and Terms are the foundation, but several supporting documents close out the legal package:

1. **Data Processing Agreement (DPA)** — required by Terms § 8 and by every Canadian and serious enterprise customer. Must include the nine § 7051 mandatory clauses.
2. **Sub-processor list and change-notification page** — referenced by Privacy Policy § 7 and the DPA. Should be at a stable URL (e.g., knockiq.com/sub-processors) with an email-subscription mechanism for notifications.
3. **Acceptable Use Policy (AUP)** as a standalone document — many of the Section 5.2 obligations can live in an AUP that the Terms reference, which is easier to update without renegotiating the full Terms.
4. **Visited Person privacy notice** at knockiq.com/privacy/homeowners — plain-language, sub-2-page summary that homeowners can find via search. Required because the standard Privacy Policy is too long for an unrelated third party to find the relevant rights.
5. **Rep onboarding consent flow** — when a Rep accepts an invite, present a screen documenting the collection of geolocation and motion data. This is the meaningful-consent record for PIPEDA and a defensive document for any later rep dispute.
6. **Cookie / local-storage disclosure** — currently described inside the Privacy Policy. If KnockIQ adds analytics or any third-party tracking in the future, a separate cookie banner with granular consent will be needed.
7. **Breach response runbook** — operational document. PIPEDA + most state laws require breach notification on specified timelines; this is the operational counterpart to the Policy's commitment.
8. **Homeowner DSR runbook** — the operational counterpart to Outstanding Issue 4. Documents who responds, what tooling they use, and how to meet the 45-day SLA.
9. **Quebec Law 25 §17 PIA** — for any Quebec customer.

---

## 6. Recommended publication sequence

A reasonable rollout, assuming the two outstanding issues in Section 2 are remediated:

1. **Week 0** — counsel reviews this handoff and the draft Privacy Policy + Terms.
2. **Week 1** — counsel returns redlines; we resolve all bracketed items.
3. **Week 2** — DPA drafted; sub-processor page live; Visited Person summary published; homeowner DSR tool scoped.
4. **Week 3** — outstanding platform fixes shipped (homeowner DSR tool + super-admin logging verification).
5. **Week 4** — final Privacy Policy and Terms published. Existing customers notified at least 30 days before they take effect for them.
6. **Ongoing** — sub-processor change notifications; annual review; update on any material legal change.

---

## 7. Questions for the user (KnockIQ) to answer before the lawyer meeting

So the lawyer can do their first pass efficiently, please bring:

- Confirmed legal entity, state of incorporation, registered agent.
- Decision on governing-law state (default: state of incorporation).
- Decision on arbitration provider (default: JAMS).
- Cyber/E&O insurance summary so liability cap can be calibrated.
- Confirmation that super-admin cross-tenant access is in fact logged (engineering check).
- Snapshot of current marketing claims (homepage, pricing page, sales deck) — counsel will check for any "we promise X" that goes beyond what the Terms say.
- List of all current customers, by state, so jurisdiction-specific obligations can be confirmed (e.g., do you have any Quebec customers yet — that triggers the §17 PIA).
- Roadmap items in the next 6 months that would change the data flows (e.g., adding analytics, a new AI feature, an integration). Better to address in the first policy version than in a six-month amendment.

---

## End of Handoff Summary

The full Privacy Policy is in `PRIVACY_POLICY.md` (or `.docx`). The full Terms of Service is in `TERMS_OF_SERVICE.md` (or `.docx`). Background research is in `data_audit.md`, `legal_research.md`, and `homeowner_exposure.md`.
