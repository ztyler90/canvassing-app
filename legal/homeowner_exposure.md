# KnockIQ — Homeowner-Data Legal Exposure

Homeowners are the third-party data subjects with the greatest mismatch between data collected and consent given. Every door visited produces a record at a precise address; conversations capture contact info, voice transcripts, and free-text notes; photos and lat/lng leak to several US sub-processors. The platform never speaks to the homeowner directly — yet the data lands in KnockIQ infrastructure. The exposure splits along a controller/processor line, with several items that fall on the platform regardless of customer behavior.

---

## 1. Controller vs. processor model (CCPA "service provider" terms)

In the typical B2B SaaS configuration, the canvassing company is the **business / controller** and KnockIQ is the **service provider / processor**. To preserve that posture under CCPA/CPRA — and avoid being recharacterized as a "third party" that has "sold" data — the contract must satisfy **11 CCR § 7051**, which enumerates the mandatory service-provider terms ([Cornell LII](https://www.law.cornell.edu/regulations/california/11-CCR-7051)). The Virginia CDPA, Colorado CPA, and Texas TDPSA all impose substantially the same processor obligations through a required Data Processing Agreement ([Akin Gump](https://www.akingump.com/en/insights/alerts/texas-data-privacy-act-what-businesses-need-to-know)).

Non-negotiable DPA clauses for KnockIQ:

1. **Purpose limitation** — KnockIQ may process homeowner data only for the documented "business purposes" (canvassing operations, analytics back to the customer, security, support). No combining across customers for product improvement without separate authorization. Section 7051 explicitly bars retention, use, or disclosure outside the contracted purpose ([Lathrop GPM](https://www.lathropgpm.com/insights/contractual-requirements-for-vendor-contracts-under-the-ccpa/)).
2. **No sale, no share, no cross-context behavioral advertising.**
3. **Sub-processor flow-down** — KnockIQ's contracts with Supabase, OpenAI, Resend, Stripe, OSM-hosted services, and any Google APIs must impose equivalent processor terms; the customer must be notified of new sub-processors.
4. **Customer assistance with consumer rights requests** — KnockIQ must give the customer the tooling and turnaround to respond to access, deletion, and correction requests within statutory windows (45 days under VA/CO/TX, 45 days under CCPA).
5. **Audit / monitoring right** — annual at minimum; CPPA's September 2025 $1.35M settlement specifically faulted a controller for failing to put vendor DPAs in place ([Global Privacy Watch](https://www.globalprivacywatch.com/2026/05/the-paper-trail-state-privacy-law-contracting-requirements/)).
6. **Breach notification** — KnockIQ notifies the customer without undue delay; cooperation with the customer's own state-law notification obligations.
7. **Self-certification** that KnockIQ understands and will comply with applicable processor restrictions.
8. **Return/deletion on termination.**
9. **Confidentiality** of authorized personnel.

What the customer keeps: the legal-basis question (notice/consent to homeowners), the choice of what to collect, the retention rules, and primary response to data-subject requests.

---

## 2. Do-not-knock registries

Despite the platform's `do_not_knock` table, there is **no general state-level DNK registry** in the US — these are overwhelmingly municipal ordinances ([CallHub](https://callhub.io/political-canvassing-laws/), [The Jacobs Law](https://thejacobslaw.com/list-of-do-not-knock-towns-is-growing/)). Examples include Nashville TN, Marlborough MA, Sterling IL, Yorba Linda CA, Claremont CA, Novi MI, Eastchester NY, Orangetown NY, Avon Lake OH, Grove City OH, Godfrey IL, Millburn NJ, Mantua NJ, Cinnaminson NJ ([Avon Lake](https://www.avonlake.org/canvassing/do-not-knock-registry/), [IBJ Online](https://www.ibjonline.com/2025/04/11/village-of-godfrey-adopts-a-do-not-knock-registry/)). Penalties vary widely — Orangetown stacks to $10,000 and 30 days in jail for a third offense.

Critical limits:
- These registries apply only to **commercial** door-to-door solicitation. Political, religious, and charitable canvassing is protected by the First Amendment ([LegalClarity](https://legalclarity.org/what-is-political-canvassing-and-what-are-the-rules/)).
- Compliance requires the canvasser (the customer) to obtain the **municipality's current list** — usually as part of a permit — and avoid those addresses.

**Liability for ignoring the DNK feature.** The fine attaches to the entity doing the soliciting — the canvassing company and the individual rep — not the SaaS that surfaced the list. KnockIQ's risk is reputational + contractual: a court could read a marketing claim ("automatic DNK compliance") as a warranty, so the Terms must (a) disclaim any guarantee of registry completeness, (b) require the customer to load and maintain its own municipal lists, and (c) push enforcement liability to the customer.

---

## 3. Voice notes — two-party consent risk

Twelve states plus DC require **all-party consent** for recording oral communications: California, Connecticut, Delaware, Florida, Illinois, Maryland, Massachusetts, Montana, Nevada, New Hampshire, Pennsylvania, Washington ([Recording Law](https://www.recordinglaw.com/party-two-party-consent-states/)). Some are nuanced — Connecticut is one-party for in-person criminal cases but two-party in civil/phone contexts; Oregon flips the opposite way. The key trigger for two-party laws is whether the homeowner had a **reasonable expectation that their words were not being recorded** — which they typically do on their own porch.

Risk pattern in KnockIQ: a rep starts a VoiceNote on the doorstep, the homeowner's voice is ambiently captured (or the rep dictates direct quotes), audio is shipped to OpenAI Whisper, transcript lands in `interactions.notes`. In a two-party state, that recording itself can be a misdemeanor or felony and a private right of action (CA Penal Code § 632 — up to $5,000 per violation).

Terms must require the customer to:
- Train reps not to start a VoiceNote until they have left the porch / ended the conversation, OR until they have obtained explicit verbal consent ("I'd like to take a quick voice note — is that OK?") in two-party states.
- Treat the VoiceNote feature as a **rep-side dictation tool**, not a recording of the conversation.
- Disable the feature for territories in two-party jurisdictions if the company can't enforce the training rule.

Platform-side: the UI should display a "Recording — speak after leaving the door" hint, and a Terms section should disclaim that KnockIQ does not warrant the legality of any recording made via the feature in any jurisdiction.

---

## 4. Photos of homes and property

From a public street, photographing the visible exterior of a residence is generally lawful under US tort law — there is no reasonable expectation of privacy in what is exposed to public view ([PBS Media Law](https://www.pbs.org/standards/media-law-101/privacy/)). The boundaries that move it into tort territory:

- **Through windows / into interiors** — invasion of privacy / intrusion upon seclusion; "Peeping Tom" statutes can apply ([LegalClarity](https://legalclarity.org/is-it-illegal-to-take-pictures-of-people-without-their-consent/), [LegalClarity](https://legalclarity.org/is-it-legal-to-photograph-someone-in-public/)).
- **Standing on the homeowner's property after being asked to leave** — trespass; no First Amendment defense.
- **Minors in the frame** — heightened criminal liability under state voyeurism statutes.
- **License plates, identifiable people, or pets** — fact-pattern dependent; combined with the precise address creates an aggregation problem.

Terms must prohibit reps from photographing: (a) interiors visible through windows, (b) identifiable individuals, especially minors, (c) anything from inside the home or backyard without permission, (d) license plates and other identifying personal property. Photos must be limited to the structures relevant to the quoted service (roof, gutter, driveway, siding).

Platform-side: the `interaction-photos` Supabase Storage bucket is **public** per `20260413_photos_followup.sql`. URL-based obscurity is not access control — this needs to be remediated to a signed-URL pattern before Terms can credibly claim "we protect homeowner data."

---

## 5. Right to deletion / access for non-users

CCPA/CPRA grants rights to **all California residents**, not just users or customers of the business ([OAG CA](https://oag.ca.gov/privacy/ccpa)). The VA CDPA, CO CPA, and TX TDPSA grant similar rights to residents of those states acting in an individual (not commercial) capacity ([Akin Gump](https://www.akingump.com/en/insights/alerts/texas-data-privacy-act-what-businesses-need-to-know)). Quebec's Law 25 grants a deletion right that PIPEDA does not ([Cyera](https://www.cyera.com/blog/quebec-law-25-whats-new)).

If a homeowner emails KnockIQ saying "delete everything you have on me at 123 Main St":

- KnockIQ as **processor** is generally required to **forward the request to the customer (controller)** and assist them. Under § 7051(a)(5), the service provider either enables the business to comply or hands off the request ([Cornell LII](https://www.law.cornell.edu/regulations/california/11-CCR-7051)).
- The **controller** must verify, locate the records (across `interactions`, `do_not_knock`, `gps_points` adjacent to that address, photos, voice transcripts), and delete or anonymize within 45 days ([Ketch](https://www.ketch.com/blog/posts/understanding-the-ccpa-right-to-deletion)).
- One CCPA carve-out: deletion can be refused for data "not collected from the consumer" in some circumstances — but this is narrow and does NOT cleanly cover door-data, because the address is identifiable and the homeowner is a CA resident.
- The processor must also notify its own sub-processors (OpenAI for any retained transcripts, Supabase) to delete downstream.

Platform-side: KnockIQ needs (a) a documented intake email (privacy@), (b) an internal tool that can search by address across `interactions`, `do_not_knock`, `gps_points`, photo storage, and (c) a 45-day SLA. Without this, the customer cannot meaningfully comply, and the regulator will hold both responsible.

---

## 6. TCPA / CAN-SPAM after-the-fact contact

The moment the customer exports a lead and sends a marketing text or autodialed call, **TCPA prior express written consent** is required ([ActiveProspect](https://activeprospect.com/blog/express-written-consent/)). The 11th Circuit vacated the FCC's January 2025 one-to-one consent rule, so the older "clear and conspicuous" standard governs — but the underlying consent requirement is unchanged, opt-out keywords (STOP, etc.) must be honored within 10 business days under rules effective April 11, 2025 ([BCLP](https://www.bclplaw.com/en-US/events-insights-news/the-tcpas-new-opt-out-rules-take-effect-on-april-11-2025-what-does-this-mean-for-businesses.html)). Verbal "yes, text me about my quote" at the door is **not** written consent.

Terms must explicitly state that:
- Phone numbers logged in KnockIQ are operational records, not pre-consented marketing leads.
- The customer is solely responsible for TCPA and CAN-SPAM compliance for any follow-up communication.
- KnockIQ does not provide a marketing-messaging channel and is not a "seller" or "telemarketer" under the TCPA.
- Webhook/Zapier exports are at the customer's risk.

---

## 7. State home-solicitation sales acts

The FTC's "Cooling-Off Rule" (16 CFR Part 429) gives buyers three business days to cancel any door-to-door sale over $25 at a residence, and parallel state Home Solicitation Sales Acts exist (e.g., Ohio's HSSA, Nebraska's HSSA) ([FTC](https://www.ftc.gov/legal-library/browse/rules/cooling-period-sales-made-home-or-other-locations), [Koley Jessen](https://www.koleyjessen.com/insights/publications/nebraska-home-solicitation-sales-act)). KnockIQ does not generate contracts and does not transact — so the substantive HSSA obligations sit entirely with the canvassing company. Terms should flag this as a customer responsibility and disclaim that KnockIQ's records (estimates, bookings) constitute contracts or cooling-off notices.

---

## Customer obligations (must be in Terms / AUP)

1. Serve as the **data controller** for all homeowner data; provide any required notice and obtain any required consent.
2. Comply with all municipal **do-not-knock** ordinances and permitting; maintain the DNK list within KnockIQ.
3. Train reps on **two-party consent** — no VoiceNotes capturing homeowner voice in CA/CT/DE/FL/IL/MD/MA/MT/NV/NH/PA/WA without explicit consent.
4. Restrict **photos** to relevant exterior structures; prohibit interiors, minors, identifiable people, license plates.
5. Respond to **homeowner rights requests** (access/deletion/correction) within statutory windows; KnockIQ assists but does not own the response.
6. Comply with **TCPA / CAN-SPAM** for any outbound contact using lead data exported from KnockIQ; obtain prior express written consent independently.
7. Comply with the **federal Cooling-Off Rule** and state Home Solicitation Sales Acts for any sale closed at the door.
8. Honor the platform's `do_not_knock` flag; accept liability for any rep who ignores it.
9. Maintain a publicly posted privacy notice naming KnockIQ as a service provider.
10. Indemnify KnockIQ for rep misconduct (trespass, illegal recording, harassment).

## Platform obligations (KnockIQ must do regardless)

1. Execute a CCPA-compliant **DPA** with every customer; flow processor terms to Supabase, OpenAI, Resend, Stripe, Google, OSM operators.
2. Stand up a **homeowner privacy intake** (privacy@knockiq) with a documented 45-day workflow that searches by address across `interactions`, `gps_points`, `do_not_knock`, photos, and voice transcripts.
3. Confirm and contractually fix **OpenAI Whisper zero-retention** so audio doesn't persist outside the request lifecycle.
4. **Convert `interaction-photos` and `avatars` Storage buckets to private** with signed URLs — the current public-bucket posture is incompatible with any claim of safeguarding homeowner imagery.
5. Define and enforce **retention/deletion lifecycles** for `interactions`, `gps_points`, `do_not_knock`, photos, and transcripts (none exist in code today).
6. Provide a **homeowner-facing privacy notice** at knockiq.com explaining how to exercise rights, even though the homeowner is not a user.
7. Maintain a **breach-notification** procedure and a sub-processor list with change notifications.
8. Disclose in-product that the VoiceNote feature is for **post-doorstep dictation** in two-party states, with a UI hint.
9. Log and produce, on request, the **audit trail** (`audit_log`) and rep GPS / interaction history that the customer needs to demonstrate compliance.
10. Limit super-admin cross-tenant access and log every such access for the customer's own audit needs.

---

Sources:
- [Cornell LII — 11 CCR § 7051](https://www.law.cornell.edu/regulations/california/11-CCR-7051)
- [Lathrop GPM — Contractual Requirements under CCPA](https://www.lathropgpm.com/insights/contractual-requirements-for-vendor-contracts-under-the-ccpa/)
- [Global Privacy Watch — State Privacy Law Contracting Requirements (2026)](https://www.globalprivacywatch.com/2026/05/the-paper-trail-state-privacy-law-contracting-requirements/)
- [Akin Gump — Texas Data Privacy Act](https://www.akingump.com/en/insights/alerts/texas-data-privacy-act-what-businesses-need-to-know)
- [Avon Lake — Do Not Knock Registry](https://www.avonlake.org/canvassing/do-not-knock-registry/)
- [IBJ — Godfrey IL Do Not Knock](https://www.ibjonline.com/2025/04/11/village-of-godfrey-adopts-a-do-not-knock-registry/)
- [The Jacobs Law — List of Do Not Knock Towns](https://thejacobslaw.com/list-of-do-not-knock-towns-is-growing/)
- [CallHub — Political Canvassing Laws](https://callhub.io/political-canvassing-laws/)
- [Recording Law — Two-Party Consent States](https://www.recordinglaw.com/party-two-party-consent-states/)
- [PBS — Media Law 101: Privacy](https://www.pbs.org/standards/media-law-101/privacy/)
- [LegalClarity — Photographing People](https://legalclarity.org/is-it-illegal-to-take-pictures-of-people-without-their-consent/)
- [Ketch — CCPA Right to Delete](https://www.ketch.com/blog/posts/understanding-the-ccpa-right-to-deletion)
- [OAG California — CCPA](https://oag.ca.gov/privacy/ccpa)
- [Cyera — Quebec Law 25](https://www.cyera.com/blog/quebec-law-25-whats-new)
- [ActiveProspect — TCPA Express Written Consent](https://activeprospect.com/blog/express-written-consent/)
- [BCLP — TCPA Opt-Out Rules April 2025](https://www.bclplaw.com/en-US/events-insights-news/the-tcpas-new-opt-out-rules-take-effect-on-april-11-2025-what-does-this-mean-for-businesses.html)
- [FTC — Cooling-Off Period Rule](https://www.ftc.gov/legal-library/browse/rules/cooling-period-sales-made-home-or-other-locations)
- [Koley Jessen — Nebraska Home Solicitation Sales Act](https://www.koleyjessen.com/insights/publications/nebraska-home-solicitation-sales-act)
