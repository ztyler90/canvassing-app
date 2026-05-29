# KnockIQ — Attorney Handoff Summary

**Prepared:** [date for delivery to counsel]
**For:** Outside counsel reviewing KnockIQ's Privacy Policy and Terms of Service before publication
**From:** [Zach Tyler], KnockIQ

This document is the executive briefing to read before the attached Privacy Policy and Terms of Service. It summarizes the legal posture, flags the highest-risk items, lists every input the documents need from you, and lists the platform-engineering remediations that have to happen alongside the policy work.

---

## 1. What KnockIQ is and why this matters

KnockIQ is a B2B SaaS platform for door-to-door canvassing companies. Field sales representatives ("Reps") use a web/mobile-optimized application to log every door they visit. The app captures, transmits, and persists:

- **Reps' precise geolocation**, continuously, broadcast in real time to managers.
- **Visited Persons' addresses, GPS coordinates, contact info, photos of their property, and free-text notes** — recorded for every door visited, including doors where no one answered. **Visited Persons never sign up and never consent.**
- **Voice recordings**, transmitted to OpenAI for transcription. The transcript text is stored.

The critical legal posture: **KnockIQ is a controller (not a processor) for Visited Person data**, because no contract authorizes KnockIQ to collect it through the homeowner. That puts direct regulatory obligations on KnockIQ that cannot be pushed entirely to the canvassing-company customer.

Two background memos accompany this handoff and feed every recommendation below:

- `data_audit.md` — exhaustive inventory of every field collected, where it goes, who can access it.
- `legal_research.md` — current US state law landscape (20 comprehensive privacy laws in effect mid-2026) + Canadian PIPEDA, Quebec Law 25, AB/BC PIPA + recording-consent + biometric + TCPA + DNK.
- `homeowner_exposure.md` — controller/processor analysis, DNK registries, voice-note consent risk, photo restrictions, deletion-right scope, TCPA carve-outs.

---

## 2. The five issues that need to be resolved before the documents can be published

These are not policy-drafting questions. They are operational/platform decisions that the policy must accurately reflect, and that — if left as drafted — create direct exposure.

### Issue 1 — Public Supabase Storage buckets
Both `interaction-photos` and `avatars` are configured as public buckets per migration `20260413_photos_followup.sql`. URL knowledge equals read access. The Privacy Policy claims safeguards for homeowner imagery; if buckets remain public on launch, the claim is misleading.
**Decision needed:** convert to private buckets with signed URLs **before** publishing the Policy.

### Issue 2 — OpenAI account terms
The Privacy Policy states that voice audio is not retained by OpenAI after transcription and is not used to train models. This is only true on OpenAI's enterprise/API tier with zero-day retention configured. If the KnockIQ account is on default consumer terms, the statement is materially inaccurate.
**Decision needed:** confirm OpenAI account tier and retention setting; document in the legal file.

### Issue 3 — Retention/deletion lifecycle
There is no implemented retention or deletion lifecycle for `interactions`, `gps_points`, `do_not_knock`, photos, or voice transcripts. The Privacy Policy proposes specific retention periods (currently bracketed for your input). MODPA, BIPA, and best practice all require an actual retention schedule.
**Decision needed:** confirm retention periods, then have engineering implement automated deletion to match. Publishing a schedule the platform doesn't enforce is direct litigation exposure.

### Issue 4 — Homeowner data-subject request workflow
The Privacy Policy commits to a 45-day search-by-address workflow that touches all systems where Visited Person data lives (interactions, GPS, DNK, photos, transcripts). No tool exists today. Without it, the commitment is unfulfillable.
**Decision needed:** scope and build the internal tool, document the SLA you can actually meet, then either match the Policy to operational reality or commit engineering resources to match the Policy.

### Issue 5 — Super-admin cross-tenant access logging
A "super-admin" role bypasses tenancy RLS and can read across all customer orgs. The Privacy Policy and security section mention this with logging. Confirm logging is in place and that customers can request the log on the data they care about.

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

### Operational SLAs
- Retention periods for: interactions, GPS breadcrumbs, voice transcripts, photographs, do-not-knock entries, logs (Privacy Policy Section 12)
- Final export window after termination (Terms § 7.5 — currently 30 days)
- Data-deletion-after-termination window (Terms § 7.5 — currently 60 days)
- Auto-renewal cancellation notice window (Terms § 4.4 — currently 1 day before renewal)

### Commercial / dispute
- Choice of governing-law state (Terms § 19) — typical SaaS picks: Delaware, California, or HQ state
- Arbitration provider (Terms § 18.2) — JAMS or AAA most common
- Arbitration seat / venue (Terms § 18.2)
- Liability cap floor (Terms § 14(b)(ii) — currently $100; consider matching to insurance coverage)
- Whether KnockIQ offers any SLA (Terms § 12)

### Quebec Law 25 obligations
- Confirm whether a §17 Privacy Impact Assessment has been conducted for each cross-border transfer (Supabase US, OpenAI US, OSM Germany). If not, conduct before publication in any market with Quebec residents.
- Confirm whether the named Privacy Officer is publicly listed (required).

### Sub-processor list
- Confirm the sub-processor list in Privacy Policy Section 7 matches reality. The audit identified: Supabase, OpenAI (Whisper), Stripe, Resend, OpenStreetMap (tiles, Overpass, Nominatim), Google Maps Geocoding (env-gated), Customer-configured webhooks (Zapier), Google Fonts, unpkg. Verify against current code.

### Marketing materials review
- Cross-check all marketing claims (knockiq.com, sales decks, demo scripts) for any commitment that goes beyond what the Privacy Policy or Terms now say. Marketing-claim exposure is the most common source of "we said something we didn't deliver" liability.

---

## 4. Highest-risk substantive areas — your judgment requested

Each of these items got an `[ATTORNEY REVIEW: ...]` callout in the documents. Listed here in priority order so you can read past the boilerplate first.

### 4.1 Controller vs. processor framing for Visited Person data — Privacy Policy § 2
The draft treats KnockIQ as a controller (jointly with the Customer) for Visited Person data. This is the more defensible posture but increases direct compliance obligations. The alternative — calling KnockIQ a pure processor — likely fails because no contract authorizes the data collection through the homeowner. Confirm.

### 4.2 BIPA exposure for voice processing — Privacy Policy § 9
The draft asserts that no voiceprints are generated. This is true only if the OpenAI pipeline performs no speaker diarization and no voice embeddings are extracted. If KnockIQ ever adds speaker-ID or voice-fingerprinting features, the Policy needs a full BIPA-compliant notice (written notice + written release + public retention schedule) BEFORE the feature ships. Cisneros v. Nuance (7th Cir. 2025) extends BIPA liability to third-party service providers — meaning KnockIQ could be sued directly, not just the canvassing customer. This is the single largest dollar exposure in the product.

### 4.3 Recording-consent (all-party-consent state) liability — Privacy Policy § 9, Terms § 5.2(d)
Twelve states + DC require all-party consent for recording. The voice-note feature can ambient-capture homeowners on porches. The current approach: (a) push training obligation to the Customer in the Terms, (b) disclose in the Policy. Counsel should consider whether a UI-level mitigation (geofence-based consent prompt) is needed to defeat constructive-knowledge arguments.

### 4.4 Customer indemnification scope — Terms § 16
Customer indemnifies KnockIQ for Rep misconduct including trespass, illegal recording, photo violations, ignoring DNK lists, TCPA breaches, and HSSA failures. This is broad. Counsel should confirm the carve-outs your insurance requires and that the scope is enforceable in the chosen governing-law state.

### 4.5 Aggregated / de-identified data use — Terms § 7.3
The draft permits KnockIQ to derive aggregated data from Customer Data for internal use. This conflicts with MODPA's strict-necessity rule for sensitive data. If KnockIQ wants to use geolocation or voice-derived data in cross-customer benchmarking, that must be limited to truly de-identified data per CCPA § 1798.140(m) and disclosed. Counsel should narrow if necessary.

### 4.6 Arbitration and class-action waiver — Terms § 18
Standard SaaS arbitration with class waiver. Counsel should confirm enforceability in the governing-law state (California McGill v. Citibank is the leading challenge) and confirm cost-allocation provisions don't run afoul of one-sided-cost-shifting cases.

### 4.7 California "right to know" specificity — Privacy Policy § 14 + State-Specific Disclosures
CCPA/CPRA requires specific category-of-data disclosures from the past 12 months. Counsel should review the appendix once final operational data is available, and confirm whether KnockIQ meets thresholds requiring a toll-free phone number and an authorized-agent intake process.

### 4.8 Quebec Law 25 cross-border PIA — Privacy Policy § 11
The PIA must actually exist before the Policy is published in any market with Quebec residents. The PIA must evaluate each receiving jurisdiction's "substantially equivalent" protection — US laws like the CLOUD Act and FISA 702 weigh against adequacy of US transfers.

### 4.9 Data Processing Agreement (DPA) — Terms § 8
A DPA is incorporated by reference but not yet drafted. Required by 11 CCR § 7051 (California) and equivalent provisions in VA, CO, CT, TX, OR, MT, DE, NH, NJ, MD, MN, TN, IN, KY, RI, NE, IA. CPPA's Sept 2025 $1.35M settlement specifically faulted a controller for missing vendor DPAs. The DPA needs the nine § 7051 mandatory clauses. Companion drafting task.

### 4.10 Do-not-knock disclaimer language — Terms § 5.2(b), § 13
The draft explicitly disclaims any guarantee that KnockIQ's DNK feature provides comprehensive registry coverage. Counsel should verify the disclaimer survives if KnockIQ's marketing or onboarding ever implies otherwise.

---

## 5. Companion documents that should follow these two

The Privacy Policy and Terms are the foundation, but several supporting documents close out the legal package:

1. **Data Processing Agreement (DPA)** — required by Terms § 8 and by every Canadian and serious enterprise customer. Must include the nine § 7051 mandatory clauses.
2. **Sub-processor list and change-notification page** — referenced by Privacy Policy § 7 and the DPA. Should be at a stable URL (e.g., knockiq.com/sub-processors) with an email-subscription mechanism for notifications.
3. **Acceptable Use Policy (AUP)** as a standalone document — many of the Section 5.2 obligations can live in an AUP that the Terms reference, which is easier to update without renegotiating the full Terms.
4. **Visited Person privacy notice** at knockiq.com/privacy/homeowners — plain-language, sub-2-page summary that homeowners can find via search. Required because the standard Privacy Policy is too long for an unrelated third party to find the relevant rights.
5. **Rep onboarding consent flow** — when a Rep accepts an invite, present a screen documenting the collection of geolocation, voice, and motion data. This is the meaningful-consent record for PIPEDA and a defensive document for any later rep dispute.
6. **Cookie / local-storage disclosure** — currently described inside the Privacy Policy. If KnockIQ adds analytics or any third-party tracking in the future, a separate cookie banner with granular consent will be needed.
7. **Breach response runbook** — operational document. PIPEDA + most state laws require breach notification on specified timelines; this is the operational counterpart to the Policy's commitment.
8. **Quebec Law 25 §17 PIA** — for any Quebec customer.

---

## 6. Recommended publication sequence

A reasonable rollout, assuming the platform issues in Section 2 are remediated:

1. **Week 0** — counsel reviews this handoff and the draft Privacy Policy + Terms.
2. **Week 1** — counsel returns redlines; we resolve all bracketed items.
3. **Week 2** — DPA drafted; sub-processor page live; Visited Person summary published.
4. **Week 3** — platform fixes shipped (private buckets, retention lifecycle, deletion workflow, super-admin logging review).
5. **Week 4** — final Privacy Policy and Terms published. Existing customers notified at least 30 days before they take effect for them.
6. **Ongoing** — sub-processor change notifications; annual review; update on any material legal change (e.g., a new state law passes, OpenAI changes its data-handling terms).

---

## 7. Questions for the user (KnockIQ) to answer before the lawyer meeting

So the lawyer can do their first pass efficiently, please bring:

- Confirmed legal entity, state of incorporation, registered agent.
- Decision on governing-law state (default: state of incorporation).
- Decision on arbitration provider (default: JAMS).
- Cyber/E&O insurance summary so liability cap can be calibrated.
- Confirmation of OpenAI account tier.
- Snapshot of current marketing claims (homepage, pricing page, sales deck) — counsel will check for any "we promise X" that goes beyond what the Terms say.
- List of all current customers, by state, so jurisdiction-specific obligations can be confirmed (e.g., do you have any Quebec customers yet — that triggers the §17 PIA).
- Roadmap items in the next 6 months that would change the data flows (e.g., adding analytics, a new AI feature, an integration). Better to address in the first policy version than in a six-month amendment.

---

## End of Handoff Summary

The full Privacy Policy is in `PRIVACY_POLICY.md` (or `.docx`). The full Terms of Service is in `TERMS_OF_SERVICE.md` (or `.docx`). Background research is in `data_audit.md`, `legal_research.md`, and `homeowner_exposure.md`.
