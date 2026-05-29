# KnockIQ — Legal Research for Privacy Policy & ToS

**Prepared:** 2026-05-29
**Scope:** B2B SaaS door-to-door canvassing app. Customers = canvassing companies. End users = sales reps. Data subjects also include **homeowners** whose address, lat/lng, property photos, voice notes about them, contact info, and visit outcome are stored **without their consent**. This is the central legal exposure throughout.

**Posture note for the policy:** KnockIQ acts as a **processor** for rep data (the canvassing company is controller) but is functionally a **controller** for homeowner data, because no business-to-business contract authorizes its collection. Most state laws define "consumer" broadly enough that a homeowner whose data sits in KnockIQ qualifies — they did not have to sign up. Treat homeowners as full data subjects with all statutory rights.

---

## 1. US State Comprehensive Privacy Laws (in effect mid-2026)

Per the IAPP US State Privacy Legislation Tracker and MultiState's 2026 roundup, **20 state comprehensive consumer privacy laws are in effect** as of mid-2026 ([IAPP](https://iapp.org/resources/article/us-state-privacy-legislation-tracker), [MultiState](https://www.multistate.us/insider/2026/2/4/all-of-the-comprehensive-privacy-laws-that-take-effect-in-2026)):

California (CCPA/CPRA), Virginia (VCDPA), Colorado (CPA), Connecticut (CTDPA), Utah (UCPA), Texas (TDPSA), Oregon (OCPA), Montana (MCDPA), Iowa (ICDPA), Florida (FDBR — narrow), Delaware (DPDPA), New Hampshire (NHPA), New Jersey (NJDPA), Tennessee (TIPA), Minnesota (MCDPA), Maryland (MODPA), Indiana (INCDPA — effective 1/1/2026), Kentucky (KCDPA — 1/1/2026), Rhode Island (RIDTPPA — 1/1/2026), Nebraska (NDPA). ([Koley Jessen](https://www.koleyjessen.com/insights/publications/new-state-privacy-laws-effective-january-1-2026-indiana-kentucky-and-rhode-island))

### Applicability thresholds (typical)
Most laws apply to entities that (a) conduct business in the state or target residents AND (b) meet a threshold like processing data of 100,000 consumers/year (or 25,000 + ≥25% revenue from data sales). Texas is the outlier — it applies to any business that processes/sells personal data, with no consumer-count threshold, exempting only federal small businesses ([Promise Legal](https://promise.legal/startup-legal-guide/compliance/texas-privacy)). **KnockIQ will almost certainly cross the threshold in any state where its customers operate**, given homeowner addresses are stored at scale.

### Required privacy notice content (the common core)
- Categories of personal data collected, sources, purposes
- Categories shared with third parties + categories of recipients
- Consumer rights (access, correction, deletion, portability, opt-out)
- How to exercise rights + appeal process (required in CO, CT, VA, TX, OR, MT, DE, NH, NJ, MD, MN, etc.)
- Sale / targeted advertising / profiling status
- Sensitive data processing disclosure
- Effective date / last update
- Designated contact ([FPF Anatomy of a State Privacy Law](https://fpf.org/wp-content/uploads/2025/12/FPF-Anatomy-of-a-State-Comprehensive-Privacy-Law-Report.pdf))

### Opt-out / consent model for sensitive data
- **Opt-out for sensitive PI:** California, Utah ([IAPP](https://iapp.org/news/a/new-categories-new-rights-the-cpras-opt-out-provision-for-sensitive-data))
- **Opt-IN required for sensitive data:** Virginia, Colorado, Connecticut, Texas, Oregon, Montana, Delaware, New Hampshire, New Jersey, Tennessee, Minnesota, Maryland, Indiana, Kentucky, Rhode Island, Nebraska, Iowa ([Benesch](https://www.beneschlaw.com/insight/privacy-points-2023-different-sensitive-personal-information-rights-requirements-emerge-in-new-us-state-data-protection-laws/))
- **Strictest standard — Maryland MODPA (effective 10/1/2025, enforced 4/1/2026):** sensitive data collection must be "**strictly necessary**" to provide the requested service — consent alone is NOT enough. MODPA also **prohibits sale of sensitive data entirely**, even with consent ([Manatt](https://www.manatt.com/insights/newsletters/privacy-and-data-security/now-in-effect-maryland-law-raises-bar-on-sensitive-data-data-minimization-and-children-s-privacy), [Captain Compliance](https://captaincompliance.com/education/marylands-strictly-necessary-standard/))

### Universal opt-out / Global Privacy Control (GPC)
At least 11 states require honoring GPC signals: CA, CO, CT, DE, MD, MN, MT, NH, NJ, OR, TX. New 2026 CCPA regulations require businesses to **visibly confirm** they processed an opt-out signal ([Nelson Mullins](https://www.nelsonmullins.com/insights/alerts/fcc-download/all/show-me-that-you-ve-opted-me-out-new-ccpa-rules-require-businesses-to-prove-compliance), [Didomi](https://www.didomi.io/blog/global-privacy-control-gpc-2026)).

### Unique 2026 items
- **California:** new ADMT, risk-assessment, and cybersecurity-audit regs effective 1/1/2026; Delete Request and Opt-Out Platform (DROP) live ([IAPP](https://iapp.org/news/a/new-year-new-rules-us-state-privacy-requirements-coming-online-as-2026-begins)).
- **Virginia SB338 (signed 4/13/2026, effective 7/1/2026):** outright **bans sale of precise geolocation data** ([Regulatory Oversight](https://www.regulatoryoversight.com/2026/04/virginia-becomes-third-state-to-ban-sale-of-consumers-precise-geolocation-data/)). Third state to do so after Maryland and one other.
- **Oregon (1/1/2026 updates):** universal opt-out recognition required; restrictions on geolocation data sales ([IAPP](https://iapp.org/news/a/new-year-new-rules-us-state-privacy-requirements-coming-online-as-2026-begins)).
- **Texas:** first TDPSA enforcement action filed Jan 2025 against Allstate/Arity over geolocation — AG is actively prosecuting geo cases ([Byte Back](https://www.bytebacklaw.com/2025/01/texas-files-first-privacy-law-enforcement-action/)).

---

## 2. Recording / Wiretapping / Two-Party Consent

Voice notes that ambiently capture a homeowner's voice are the highest-risk feature in the product.

### All-party (two-party) consent states (12)
California, Connecticut, Delaware, Florida, Illinois, Maryland, Massachusetts, Michigan, Montana, New Hampshire, Oregon, Pennsylvania, Washington ([Recording Law](https://www.recordinglaw.com/party-two-party-consent-states/)). Connecticut and a few others split rules (CT requires all-party for phone calls, one-party for in-person — but for in-person you must be a participant; a rep dictating a note while a homeowner is speaking in the background is **not a participant in the homeowner's separate utterance**, which is a gray zone) ([Recording Law CT](https://www.recordinglaw.com/party-two-party-consent-states/connecticut-recording-laws/)).

### Legal risk pattern
If the rep dictates a voice memo on the porch and the homeowner's voice is audible — even passively — the recording can be argued to be a recording of the homeowner without consent. Statutory damages in CA reach $5,000/violation; FL and PA can charge it as a felony.

### Safe-harbor disclosure pattern
1. **Customer-facing contract** must require the canvassing company to:
   - Train reps that voice notes must be recorded only **after** stepping away from the homeowner.
   - In all-party states, obtain verbal consent ("Do you mind if I record a note?") if the homeowner is audible.
   - Default to text notes in all-party states.
2. **In-app technical controls:** geofence — if the device is in an all-party state, surface a consent reminder banner before mic activates. (This is the FTC-pattern "privacy by design" mitigation.)
3. **Privacy policy disclosure to homeowners** (separate, public-facing page): "Reps may make voice notes. We do not intentionally record homeowners. If your voice was captured, you may request deletion."

---

## 3. Biometric Privacy Laws

Voice recordings are explicitly biometric under several laws.

- **Illinois BIPA:** "voiceprint" is enumerated as a biometric identifier. Requires (1) written notice, (2) written release (consent), (3) public retention schedule, before collection. **$1,000 per negligent, $5,000 per reckless violation** — class actions are routine. The Cisneros v. Nuance case (7th Cir. 2025) pushed liability onto third-party service providers — i.e., KnockIQ could be sued, not just the canvassing customer ([The Lyon Firm](https://thelyonfirm.com/class-action/data-privacy/bipa/voiceprint-violations-lawyer/), [Fisher Phillips](https://www.fisherphillips.com/en/insights/insights/ai-meeting-tools-are-the-latest-target-of-illinois-bipa-class-actions)). **Critical nuance:** raw audio is not a voiceprint, but if OpenAI's pipeline performs speaker diarization or extracts voice embeddings, it becomes one ([UMEVO](https://www.umevo.ai/blogs/ume-all-posts/how-biometric-privacy-laws-like-illinois-bipa-apply-to-ai-voice-recorders)).
- **Texas CUBI (as amended by HB 149 / TRAIGA, effective 1/1/2026):** voiceprint covered; consent required before capture for commercial purposes. AG enforcement only (no private right of action), but Texas AG just won $1.4B from Meta and $1.375B from Google on biometric matters ([Texas AG](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/biometric-identifier-act), [SIA](https://www.securityindustry.org/2025/06/24/groundbreaking-texas-ai-law-also-brings-needed-clarity-on-use-of-biometric-technologies-for-security/)).
- **Washington (RCW 19.375):** voiceprint covered; commercial purpose only; notice + consent required ([OGC](https://outsidegc.com/blog/biometric-data-protection-a-growing-trend-in-state-privacy-legislation/)).
- **NYC biometric ordinance (Local Law 3):** applies to commercial establishments; less relevant to a porch context but applies if reps later visit commercial properties.
- **State comprehensive laws (CO, CT, VA, etc.):** biometric data is "sensitive data" → opt-in consent required.

### What the policy must say
A specific biometric section disclosing: (1) we record audio that may contain voice; (2) we do/do not generate voiceprints or run speaker identification; (3) retention period for recordings; (4) deletion mechanism; (5) for IL/TX/WA, explicit "we do not collect biometric identifiers as defined by [BIPA/CUBI/RCW 19.375]" if technically true, or a full BIPA-compliant notice if not.

---

## 4. Canada — PIPEDA, Quebec Law 25, Alberta/BC PIPA

- **PIPEDA (federal):** Requires **meaningful consent** — voluntary, informed, specific. Consent must be reasonable to expect the individual understands. Policy must be plainly written, easily accessible ([OPC](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/principles/p_consent/)). Mandatory breach notification under PIPEDA's Breach of Security Safeguards regulations. Cross-border transfers permitted with transparency + contractual safeguards; OPC has reopened consultation on a **consent-based** transfer model — watch this ([IAPP](https://iapp.org/news/a/is-canadas-proposed-consent-requirement-for-cross-border-transfers-worth-the-risk)).
- **Quebec Law 25:** Most stringent. **Section 17 requires a Privacy Impact Assessment (PIA) before any cross-border transfer**, including to a US-based vendor. Even moving data to an Ontario-headquartered vendor whose servers are in the US triggers a PIA. The PIA must evaluate whether the destination jurisdiction provides "substantially equivalent" protection — US laws like the CLOUD Act and FISA 702 weigh against adequacy ([Upper Harbour](https://www.upperharbour.ca/resources/transfer-impact-assessments-law-25), [WatchDog](https://watchdogsecurity.io/law25/cross-border-transfers)). Required written agreement with the foreign processor incorporating PIA findings. **Implication for KnockIQ:** Supabase (US), OpenAI (US), and OpenStreetMap tile servers (DE) all require disclosure and PIA-grade analysis if any Quebec resident's data flows through.
- **Alberta PIPA / BC PIPA:** Substantially similar to PIPEDA. Alberta updated its statutory framework in 2025 (POPA replaced FOIP for public sector; PIPA review in progress) — PIA expectations for SaaS tools are tightening ([Upper Harbour](https://www.upperharbour.ca/resources/alberta-popa-pia-saas-compliance)). BC PIPA still requires consent for collection/use/disclosure of personal information; BC FIPPA's old data-residency requirement for public bodies has been relaxed but PIAs remain.
- **PHIPA Ontario:** Only relevant if health information is captured — not typical for canvassing, so skip unless a customer is in healthcare-adjacent canvassing.

---

## 5. Door-to-Door Canvassing-Specific Regulations

- **TCPA (federal):** If a rep later texts or auto-dials a homeowner using a number gathered at the door, **prior express written consent (PEWC)** is required for marketing texts/calls to mobile numbers. The FCC's 2024 "one-to-one consent" rule (closing the lead-gen loophole) means consent to one canvassing brand does NOT carry over to affiliates ([ActiveProspect](https://activeprospect.com/blog/tcpa-text-messages/), [Tratta](https://www.tratta.io/blog/tcpa-consent-rule-changes)). Opt-out must be honored within 10 business days ([ActiveProspect](https://activeprospect.com/blog/tcpa-text-messages/)). Penalties: $500–$1,500 per violation, often per message. **Critical:** writing the phone number on a doorstep form is generally NOT sufficient PEWC for autodialed/templated SMS without express disclosure of marketing-text consent.
- **CAN-SPAM:** Email follow-ups must include (1) accurate headers, (2) valid physical postal address, (3) clear opt-out mechanism, (4) opt-out honored within 10 business days. Penalties up to **$51,744 per email** in 2025 ([FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)).
- **Do-not-knock (DNK) registries:** No statewide registries with general legal enforcement. DNK is **municipal**, found in MA (Haverhill, Methuen, Marlborough), NJ (Hamilton, Wyckoff), NY (Harrison), OH (Avon Lake), PA (Murrysville), and growing ([The Jacobs Law](https://thejacobslaw.com/list-of-do-not-knock-towns-is-growing/)). Enforcement via license revocation + fines. **Implication:** KnockIQ should let canvassing customers upload DNK lists per municipality and warn reps when a target address is on one. This is operational mitigation, but the policy should disclose that KnockIQ does not maintain a central DNK registry and customers are responsible for compliance.
- **Solicitor licensing:** Almost every municipality requires door-to-door reps to be licensed; many require background checks and photo ID. Some applications request the data the canvassing operation will collect ([Fairfax County](https://www.fairfaxcounty.gov/cableconsumer/csd/regulation-licensing/canvassers-peddlers-promoters-solicitors)). The Supreme Court in *Watchtower v. Stratton* invalidated overly broad permitting that captures non-commercial speech — relevant only if KnockIQ users include religious/political canvassers.

---

## 6. Children's Privacy

COPPA applies to operators who **knowingly** collect personal information from children under 13. The 2025 FTC amendments (effective 6/23/2025, full compliance 4/22/2026) added biometric identifiers to the definition of personal information and tightened parental-consent rules ([Akin](https://www.akingump.com/en/insights/blogs/ag-data-dive/new-ftc-final-rule-changes-coppa-obligations-for-online-services-collecting-data-from-children), [FTC](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data)).

**Practical risk for KnockIQ:** A minor answering the door whose voice is captured. Defense: KnockIQ does not "knowingly" collect from children and does not direct the service at children. **Policy must say:** the service is not directed at children under 13; reps are instructed not to collect data from minors; if discovered, data will be deleted upon request. This is short — one paragraph.

---

## 7. Geolocation Specifically

- **CPRA:** Precise geolocation = location within an **1,850-foot radius** → sensitive PI, triggering right to limit use ([CPPA FAQ](https://cppa.ca.gov/faq.html), [Clym](https://www.clym.io/blog/handling-requests-to-limit-the-use-of-sensitive-personal-information-under-the-ccpa)). Consumer can direct that sensitive PI be used only for service delivery — no analytics, no profiling.
- **VA, CT, TX, OR, MT, DE, NH, NJ, TN, MN, MD, IN, KY, RI, NE:** Precise geolocation = sensitive data using a **1,750-foot radius** definition → **opt-in required** before processing ([Benesch](https://www.beneschlaw.com/insight/privacy-points-2023-different-sensitive-personal-information-rights-requirements-emerge-in-new-us-state-data-protection-laws/)).
- **Maryland MODPA:** Geolocation collection must be **strictly necessary**, and **sale is banned outright**.
- **Virginia (effective 7/1/2026):** **Sale of precise geolocation banned**.
- **Texas:** Allstate/Arity enforcement action puts geo cases front-and-center ([Byte Back](https://www.bytebacklaw.com/2025/01/texas-files-first-privacy-law-enforcement-action/)).

**Homeowner exposure:** A precise lat/lng of a home, tied to a name, IS precise geolocation of a person (the homeowner). KnockIQ should treat every address+lat/lng record as sensitive PI for state-law purposes.

---

## 8. Cross-Border Transfers

- **Supabase (US):** Most US state laws don't restrict transfers among US locations. For Canadian customers, disclose to Canadian data subjects per PIPEDA transparency and obtain consent per Quebec Law 25 PIA process. For EU customers (if any), Standard Contractual Clauses (SCCs) are required.
- **OpenAI (US):** Disclose as a sub-processor. Confirm OpenAI's enterprise/API terms used (not free ChatGPT) so data is not used for training. For audio sent to OpenAI Whisper or similar, the BIPA exposure travels with it.
- **OpenStreetMap tiles (Germany):** Tile requests from end-user browsers leak IP addresses + viewed coordinates to OSM servers in Germany. This is a transfer **from** US/Canadian users **to** the EU — usually not a regulated direction, but should be disclosed. If EU users are present, OSM is fine as it's an EU recipient.
- **No US state currently restricts cross-border transfers**, but **all** require disclosure of categories of third parties / recipients in the privacy notice.

---

## Flagged: information that may be older than 2025

- The PIPEDA cross-border consent-based model is an OPC consultation — not law yet as of search date. **Monitor.**
- Universal opt-out signal lists were assembled from 2025–2026 sources; one or two additional states may have come online.
- Iowa, Tennessee, Nebraska, Minnesota, Indiana, Kentucky, Rhode Island statutory text reviewed via secondary legal-explainer sources, not primary statute text — recommend attorney verify final text before filing.
- COPPA final rule extended compliance deadline to 4/22/2026 ([FTC](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule)) — confirm whether FTC has issued any 2026 guidance changes.

---

## Policy Must-Haves Checklist (strictest-law baseline)

### Privacy Policy must contain:

1. **Identification of controller(s):** Name KnockIQ as controller for homeowner data and processor for rep data; identify canvassing-company customers as joint/separate controllers for rep data.
2. **Categories of personal data collected** — itemized for (a) reps and (b) homeowners separately, with sources.
3. **Purposes of processing** — narrowly drawn for each category. For homeowner sensitive data (precise geolocation, voice, photos), purposes must satisfy MODPA's "strictly necessary" standard.
4. **Categories of recipients / sub-processors** — Supabase (US), OpenAI (US), OpenStreetMap (DE), any others. Updated list.
5. **Sensitive data section** with explicit:
   - Disclosure that precise geolocation is collected.
   - Disclosure of voice recording, whether voiceprints/embeddings are generated.
   - Photos of property.
6. **Biometric notice** that satisfies BIPA (written notice, purpose, retention schedule) if voice processing produces biometric identifiers; otherwise a statement that no biometric identifiers are generated.
7. **Consumer rights section** with all enumerated rights: access, correction, deletion, portability, opt-out of sale/share/targeted ads/profiling, right to limit use of sensitive PI, **right to appeal denials** (required in CO, CT, VA, TX, OR, MT, DE, NH, NJ, MD, MN, etc.).
8. **Homeowner-specific rights statement** — separate, plain-language page directing homeowners how to view, correct, or delete their data, even though they are not customers.
9. **Universal opt-out / GPC honored** statement, with visible confirmation per 2026 CCPA regs.
10. **No sale of precise geolocation** statement (mandatory for MD and VA after 7/1/2026; recommended nationwide).
11. **Children's privacy** paragraph (service not directed at under-13; deletion on request).
12. **Retention schedule** — required by BIPA, MODPA, and best practice.
13. **Cross-border transfer disclosure** — list of countries (US, Germany, others as applicable).
14. **Breach notification commitment** (PIPEDA + most state laws).
15. **Data Protection Officer / privacy contact** — name, email, mailing address (required for CAN-SPAM and PIPEDA).
16. **Effective date + last-updated date + change-notification mechanism.**
17. **Appeal mechanism** with response timelines (typically 60 days + 45-day appeal).
18. **Recording-consent disclosure** — disclose how the app handles all-party-consent jurisdictions; require customer/rep compliance via ToS.
19. **TCPA / CAN-SPAM acknowledgment** if KnockIQ facilitates SMS/email follow-up — disclose consent requirements and that the canvassing-company customer is responsible for obtaining PEWC.
20. **Quebec Law 25** — separate Quebec addendum or section: PIA summary, list of foreign processors, written agreement reference, transfer-risk acknowledgment.

### Terms of Service must contain (because the privacy posture leans on the customer):

- Customer represents they have lawful basis to capture homeowner data via reps.
- Customer is responsible for obtaining any consents required by state law (all-party-consent jurisdictions, biometric statutes, TCPA PEWC for follow-up).
- Customer responsible for honoring DNK lists and solicitor licensing.
- Customer is the "controller" for any business-use of the data; KnockIQ acts as processor where applicable.
- Indemnification flowing from customer to KnockIQ for unauthorized data capture by reps.
- DPA (Data Processing Agreement) incorporated by reference — required by every Canadian and serious US enterprise customer.
- Sub-processor list with notification mechanism for changes.
- Restrictions on customer's use (no scraping, no resale of homeowner data, no use in regulated decisioning without separate review).
- Termination and data return/deletion obligations.
- Governing law / dispute resolution (consider Delaware or California given enforcement venues).

---

## Sources

- [IAPP — US State Privacy Legislation Tracker](https://iapp.org/resources/article/us-state-privacy-legislation-tracker)
- [IAPP — New year, new rules: US state privacy requirements coming online as 2026 begins](https://iapp.org/news/a/new-year-new-rules-us-state-privacy-requirements-coming-online-as-2026-begins)
- [MultiState — 20 State Privacy Laws in Effect in 2026](https://www.multistate.us/insider/2026/2/4/all-of-the-comprehensive-privacy-laws-that-take-effect-in-2026)
- [Koley Jessen — New State Privacy Laws Effective January 1, 2026](https://www.koleyjessen.com/insights/publications/new-state-privacy-laws-effective-january-1-2026-indiana-kentucky-and-rhode-island)
- [Benesch — Sensitive Personal Information Rights & Requirements](https://www.beneschlaw.com/insight/privacy-points-2023-different-sensitive-personal-information-rights-requirements-emerge-in-new-us-state-data-protection-laws/)
- [FPF — Anatomy of a State Comprehensive Privacy Law (Dec 2025)](https://fpf.org/wp-content/uploads/2025/12/FPF-Anatomy-of-a-State-Comprehensive-Privacy-Law-Report.pdf)
- [Manatt — Maryland MODPA Now in Effect](https://www.manatt.com/insights/newsletters/privacy-and-data-security/now-in-effect-maryland-law-raises-bar-on-sensitive-data-data-minimization-and-children-s-privacy)
- [Captain Compliance — Maryland's Strictly Necessary Standard](https://captaincompliance.com/education/marylands-strictly-necessary-standard/)
- [Regulatory Oversight — Virginia Bans Sale of Precise Geolocation Data (Apr 2026)](https://www.regulatoryoversight.com/2026/04/virginia-becomes-third-state-to-ban-sale-of-consumers-precise-geolocation-data/)
- [CA DOJ — CCPA](https://oag.ca.gov/privacy/ccpa); [CPPA FAQ](https://cppa.ca.gov/faq.html)
- [Recording Law — Two-Party Consent States (2026)](https://www.recordinglaw.com/party-two-party-consent-states/)
- [Recording Law — Connecticut Recording Laws](https://www.recordinglaw.com/party-two-party-consent-states/connecticut-recording-laws/)
- [The Lyon Firm — BIPA Voiceprint Violations](https://thelyonfirm.com/class-action/data-privacy/bipa/voiceprint-violations-lawyer/)
- [Fisher Phillips — AI Meeting Tools Are the Latest BIPA Target](https://www.fisherphillips.com/en/insights/insights/ai-meeting-tools-are-the-latest-target-of-illinois-bipa-class-actions)
- [UMEVO — Biometric Privacy Laws & AI Voice Recorders](https://www.umevo.ai/blogs/ume-all-posts/how-biometric-privacy-laws-like-illinois-bipa-apply-to-ai-voice-recorders)
- [Texas AG — Capture or Use of Biometric Identifier Act](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/biometric-identifier-act)
- [Security Industry Association — Texas HB 149 (TRAIGA) and CUBI](https://www.securityindustry.org/2025/06/24/groundbreaking-texas-ai-law-also-brings-needed-clarity-on-use-of-biometric-technologies-for-security/)
- [OPC Canada — PIPEDA Consent Principle](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/principles/p_consent/)
- [IAPP — Canada's proposed consent requirement for cross-border transfers](https://iapp.org/news/a/is-canadas-proposed-consent-requirement-for-cross-border-transfers-worth-the-risk)
- [WatchDog Security — Quebec Law 25 §17 Cross-Border Transfers](https://watchdogsecurity.io/law25/cross-border-transfers)
- [Upper Harbour — Transfer Impact Assessments Under Law 25](https://www.upperharbour.ca/resources/transfer-impact-assessments-law-25)
- [Upper Harbour — Alberta POPA PIA Requirements for SaaS](https://www.upperharbour.ca/resources/alberta-popa-pia-saas-compliance)
- [ActiveProspect — TCPA text messages: 2026 guide](https://activeprospect.com/blog/tcpa-text-messages/)
- [Tratta — TCPA Consent Rule Changes for 2026](https://www.tratta.io/blog/tcpa-consent-rule-changes)
- [FTC — CAN-SPAM Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [The Jacobs Law — List of Do-Not-Knock Towns Is Growing](https://thejacobslaw.com/list-of-do-not-knock-towns-is-growing/)
- [Fairfax County — Canvassers, Peddlers, Promoters, Solicitors](https://www.fairfaxcounty.gov/cableconsumer/csd/regulation-licensing/canvassers-peddlers-promoters-solicitors)
- [FTC — COPPA Final Rule (Apr 2025)](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule)
- [Akin — New FTC Final Rule Changes COPPA Obligations](https://www.akingump.com/en/insights/blogs/ag-data-dive/new-ftc-final-rule-changes-coppa-obligations-for-online-services-collecting-data-from-children)
- [Nelson Mullins — New CCPA Rules Require Businesses to Prove Opt-Out Compliance](https://www.nelsonmullins.com/insights/alerts/fcc-download/all/show-me-that-you-ve-opted-me-out-new-ccpa-rules-require-businesses-to-prove-compliance)
- [Didomi — Global Privacy Control (GPC) in 2026](https://www.didomi.io/blog/global-privacy-control-gpc-2026)
- [Promise Legal — Texas TDPSA Complete Guide](https://promise.legal/startup-legal-guide/compliance/texas-privacy)
- [Byte Back — Texas Files First Privacy Law Enforcement Action](https://www.bytebacklaw.com/2025/01/texas-files-first-privacy-law-enforcement-action/)
