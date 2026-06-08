# KnockIQ Privacy Policy

**Effective Date:** June 8, 2026
**Last Updated:** June 8, 2026

---

## 1. About This Policy

KnockIQ is a software platform that helps door-to-door canvassing companies coordinate their field sales representatives. This Privacy Policy explains what information we collect, why, who we share it with, how long we keep it, and the rights you have over it.

**This policy applies to three categories of people:**

1. **Sales representatives ("Reps")** who use the KnockIQ application as employees or contractors of a canvassing company.
2. **Canvassing companies ("Customers")** that subscribe to KnockIQ — typically owners, managers, and administrators.
3. **Homeowners and other prospects ("Visited Persons")** whose information is recorded by Reps during canvassing activity, even though Visited Persons do not have a direct relationship with KnockIQ.

If you are a Visited Person and want to understand or exercise your rights, go directly to **Section 14 (Your Privacy Rights — United States)** below.

---

## 2. Who We Are and Our Role Under Privacy Law

**KnockIQ** (KnockIQ, LLC) is a Florida limited liability company with its principal place of business at 4609 N Clark Ave, Tampa, FL 33614, United States.

Under US state privacy laws (California CCPA/CPRA, Virginia VCDPA, Colorado CPA, Connecticut CTDPA, Utah UCPA, Texas TDPSA, Oregon OCPA, Montana MCDPA, Iowa ICDPA, Delaware DPDPA, New Hampshire NHPA, New Jersey NJDPA, Tennessee TIPA, Minnesota MCDPA, Maryland MODPA, Indiana INCDPA, Kentucky KCDPA, Rhode Island RIDTPPA, Nebraska NDPA, and Florida FDBR), Canadian PIPEDA, Quebec Law 25, and Alberta/British Columbia PIPA, our role depends on whose data is in question:

| Data category | Our role | Controller (decides why and how) |
|---|---|---|
| Rep account, location, performance metrics | **Processor / Service Provider** | The Customer (canvassing company) |
| Customer account, billing, configuration | **Controller** | KnockIQ |
| Visited Person address, lat/lng, contact info, notes, photos | **Controller** (jointly with the Customer in most cases) | KnockIQ and the Customer |

---

## 3. Information We Collect

### 3.1 Information about Reps

When you use KnockIQ as a Rep, we collect:

- **Account information** you provide directly: name, email address, phone number (optional), profile photo (optional), password (stored only as a salted hash).
- **Account information** assigned by your Customer or by KnockIQ: role, organization assignment, employment-status flags, manager-assigned commission configuration.
- **Geolocation data**, including precise GPS coordinates, accuracy, speed, heading, and timestamps. We collect this:
  - Continuously, every approximately 30 seconds, while a canvassing session is active on your device, using your browser's geolocation interface.
  - As individual coordinates each time you log a door interaction.
  - Continuously, broadcast to your manager's dashboard in real time while a session is active.
- **Device motion data** (accelerometer readings) captured locally by your browser to classify whether you are walking, in a vehicle, or stationary. This data is processed only in your device memory and is not transmitted to or stored by KnockIQ.
- **Performance data** derived from your activity: doors knocked, conversations, estimates, bookings, revenue booked, hour-of-day patterns, and similar metrics.
- **Device and connection information**, including IP address, browser type and version, operating system, and approximate location from IP (collected automatically by our hosting provider and any embedded map or font services).
- **Local storage on your device** including your authentication session token and, while a canvassing session is active, an offline copy of the session and its logged interactions (which contain Visited Person information).

### 3.2 Information about Customers (canvassing companies)

We collect:

- **Company information**: legal name, billing contact, subscription tier, trial dates, and integrations configured (for example, a webhook URL if the Customer connects an outbound integration such as Zapier, and whether the Pro "Roof Insights" add-on is enabled).
- **Billing information** processed by our payment provider, Stripe: payment card details (handled directly by Stripe; KnockIQ stores only the Stripe customer and subscription identifiers), billing address, subscription status, plan history.
- **Operational configuration**: territories drawn on the map, do-not-knock pins and zones, service catalog, daily goals, branding settings.

### 3.3 Information about Visited Persons

When a Rep logs a door interaction, KnockIQ stores:

- **Address** of the residence visited (auto-filled by reverse geocoding the GPS coordinate, editable by the Rep).
- **Precise geographic coordinates** (latitude and longitude) of the doorstep.
- **Outcome** of the visit (no answer, not interested, estimate requested, booked).
- **Contact information** if the Visited Person provided it, including name, phone number, and email address.
- **Service interest and estimated value** for any quoted job, including an optional itemized, per-service breakdown of the estimate.
- **Free-text notes** entered by the Rep, which may include descriptions of the conversation, the residence, and follow-up instructions. Reps type these notes — **we do not collect audio**.
- **Photographs** uploaded by the Rep, typically of structures relevant to the quoted service (roof, siding, gutters, driveway). Reps are contractually prohibited from photographing interiors, identifiable people, license plates, or minors.
- **Property and roof insights** (Pro tier only). If the Customer subscribes to the Pro tier and enables the optional "Roof Insights" add-on, KnockIQ sends the doorstep coordinates of a visited address to Google's Solar API to retrieve property characteristics such as roof area, orientation, and estimated solar potential. These are attributes of the building, not additional personal identifiers, but they are associated with the address record.
- **Do-not-knock entries**: if you have requested not to be solicited, your address (and optionally a reason) may be recorded in a do-not-knock list maintained by the Customer.

**A record is created for every door visited, including doors where no one answered.** This means an entry exists about your residence regardless of whether anyone in your household interacted with the Rep. For no-answer doors, the record contains only the doorstep coordinate, timestamp, and outcome — no address, contact information, notes, or photographs are stored.

---

## 4. Sources of Information

| Category | Source |
|---|---|
| Rep account info | The Rep directly, or the Rep's Customer (when a manager invites the Rep) |
| Rep geolocation, performance metrics | The Rep's device while the application is in use |
| Customer info | The Customer directly during signup or in account settings |
| Visited Person info | A Rep entering the data during a canvassing visit; reverse-geocoding services (Google Maps Geocoding and OpenStreetMap Overpass / Nominatim) translating coordinates into addresses; Google's Solar API returning roof/property insights when the Roof Insights add-on is enabled |
| Billing info | The Customer directly; Stripe via its webhook |

---

## 5. Why We Collect This Information (Purposes of Processing)

We use information for the following purposes:

**To provide the KnockIQ service to Customers and Reps:**
- Authenticate users and maintain accounts.
- Log canvassing activity, render maps, calculate territories, attribute leads to Reps.
- Surface real-time Rep locations to managers for safety, coordination, and oversight.
- Generate performance reports, leaderboards, and analytics for the Customer.
- Provide optional property/roof insights to Customers who enable that add-on.
- Process payments and manage subscriptions.

**To operate, maintain, and improve our platform:**
- Diagnose and resolve technical issues.
- Detect and prevent fraud, abuse, and security incidents.
- Conduct internal analytics about how the product is used, in aggregated and de-identified form.

**To comply with law and protect our rights:**
- Respond to lawful legal process (subpoenas, court orders, regulatory requests).
- Enforce our Terms of Service.
- Establish, exercise, or defend legal claims.

**Sensitive personal information — strict necessity.** For precise geolocation and any data treated as sensitive under applicable state law (including, in Maryland, certain heightened categories), we process it **only as strictly necessary** to provide the canvassing-coordination service the Customer requested. We do not use sensitive personal information for targeted advertising, profiling unrelated to service delivery, training of generative AI models, or any other secondary purpose. We do not sell sensitive personal information.

---

## 6. Legal Bases for Processing (Canada, and where US state law requires)

Where applicable Canadian law requires us to identify a legal basis:

- **Performance of a contract** for processing necessary to provide services Reps and Customers signed up for.
- **Meaningful consent** for collection of geolocation and other personal information from Reps. Reps consent to this collection by accepting their employer's directive to use KnockIQ and by granting the relevant device permissions.
- **Legitimate business interest** for security, fraud prevention, and product analytics.
- **Legal obligation** for tax, accounting, and law-enforcement responses.

For Visited Person information, we rely on the Customer's representation in our Terms of Service that the Customer has the lawful basis required to capture this information through its Reps. **If you are a Visited Person and you want your information removed, see Section 14.**

---

## 7. Who We Share Information With (Sub-Processors and Third Parties)

We rely on the following service providers to operate KnockIQ. Each one receives only the information they need to perform their function and is contractually required to protect that information.

| Sub-processor | Function | Location | Information transmitted |
|---|---|---|---|
| **Supabase, Inc.** | Hosted database, authentication, file storage, edge compute | United States | All KnockIQ-stored data |
| **Stripe, Inc.** | Subscription billing | United States | Customer billing identifiers, payment events |
| **Resend** | Email delivery (Rep/manager/closer invitations and account emails) | United States / EU | Recipient email address, name, organization name |
| **Google Maps Platform (Geocoding API)** | Reverse geocoding of doorstep coordinates into addresses | United States | Door coordinates |
| **Google Maps Platform (Solar API)** | Roof/property insights for Customers with the Pro "Roof Insights" add-on enabled | United States | Visited Person address / doorstep coordinates |
| **OpenStreetMap Foundation** (tile servers, Overpass, Nominatim) | Map rendering and fallback reverse geocoding | Germany / EU | IP address and viewport coordinates of the requesting device; door coordinates during reverse geocoding |
| **Customer-configured webhooks** (e.g., Zapier) | Outbound integrations selected by the Customer | Varies (determined by the Customer's endpoint) | Depending on the events the Customer enables: session summary statistics and/or per-interaction records that may include the Visited Person's address, contact name, phone number, email address, service interest, estimated value, and itemized line items |
| **Google Fonts, unpkg.com** | Static asset delivery (fonts, CSS/JS libraries) | United States | IP address and user-agent of the requesting device |

We do not **sell** personal information for monetary consideration, and we do not **share** personal information for cross-context behavioral advertising. We do not currently engage in profiling that produces legal or similarly significant effects.

**Visited Person information specifically.** We transmit address, latitude, longitude, photographs, and doorstep coordinates to the sub-processors listed above as needed to operate the service (for example, coordinates to Google or OpenStreetMap for reverse geocoding, and to Google's Solar API when the Roof Insights add-on is enabled). **If a Customer enables outbound webhook integrations, per-interaction records — which may include a Visited Person's address, contact name, phone number, email address, service interest, estimated value, and itemized line items — are transmitted to the endpoint the Customer configures when a booking, estimate, or appointment event occurs.** The Customer controls whether webhooks are enabled, which events fire, and where the data is sent. We do not sell Visited Person data, we do not use it for advertising, and (consistent with Maryland law and Virginia law effective July 1, 2026) we **do not sell precise geolocation data**.

---

## 8. Sensitive Personal Information

We collect personal information that is treated as "sensitive" under one or more applicable laws:

- **Precise geolocation** — both of Reps (continuously, during active sessions) and of Visited Persons (at the doorstep). Under California law, "precise" means within an 1,850-foot radius; under other state laws, within 1,750 feet. Every coordinate we collect falls within both thresholds.
- **Photographs** uploaded by Reps that may incidentally depict identifiable persons.

We do not knowingly collect:
- Social Security numbers, driver's license numbers, or government-issued identifiers.
- Account credentials beyond those required to use KnockIQ.
- Information about racial or ethnic origin, religion, political beliefs, union membership, health, sexual orientation, or gender identity.
- Genetic information or biometric identifiers used for identification.

**Right to limit use of sensitive personal information (California, Virginia, Colorado, Connecticut, Utah, and other applicable states).** You may request that we limit our use of sensitive personal information about you to the purposes strictly necessary to provide the service. Contact us at privacy@knockiq.com to make this request. Because precise geolocation is essential to canvassing coordination, limiting its use will substantially impair or end your ability to use KnockIQ as a Rep.

---

## 9. Voice Recordings and Biometric Notice

**KnockIQ does not collect audio recordings.** The voice-note feature that previously allowed Reps to dictate notes through their device microphone has been removed from the product. We do not capture audio. We do not transmit audio to any third party. We do not generate voiceprints, run speaker identification or speaker diarization, or produce any "biometric identifier" within the meaning of the Illinois Biometric Information Privacy Act (740 ILCS 14), the Texas Capture or Use of Biometric Identifier Act (Tex. Bus. & Com. Code § 503.001 as amended by HB 149 / TRAIGA effective January 1, 2026), the Washington biometric statute (RCW 19.375), or the New York City biometric ordinance (NYC Admin. Code § 22-1201 et seq.).

If KnockIQ ever reintroduces a voice or audio feature, this Policy will be amended before that feature ships and all of the disclosures and consent flows required by the laws above will be in place. We will also notify existing users by email and post a prominent in-app notice at least 30 days before any such feature is enabled.

---

## 10. Sale and Sharing of Personal Information

**We do not sell personal information** in exchange for money, and **we do not share personal information for cross-context behavioral advertising**, within the meaning of the California Consumer Privacy Act as amended (CPRA) and the comprehensive privacy laws of the other states listed in Section 2.

**We do not sell precise geolocation data**, consistent with Maryland MODPA (effective October 1, 2025; enforced April 1, 2026) and Virginia's geolocation-sale ban (effective July 1, 2026), and we apply this prohibition nationwide.

**Targeted advertising and profiling.** We do not currently engage in targeted advertising, and we do not profile individuals in a manner that produces legal or similarly significant effects. If this changes, we will update this Policy and provide opt-out / opt-in mechanisms as required by your jurisdiction.

---

## 11. Cross-Border Data Transfers

KnockIQ is headquartered in Florida, United States, and our primary database and storage are hosted in the United States by Supabase, Inc. The following cross-border transfers may occur:

- **From all users to the United States:** all data stored in KnockIQ, plus doorstep coordinates and addresses sent to Google Maps Platform (Geocoding and, where enabled, Solar API).
- **From all users to Germany:** map-tile and fallback reverse-geocoding requests directed to OpenStreetMap-operated services.
- **To Customer-designated destinations:** where a Customer enables an outbound webhook integration, the data described in Section 7 is sent to the endpoint the Customer configures, which may be located in any country.
- **Canadian users:** all of the above transfers leave Canada and are stored or processed in the United States and the European Union (Germany).

For Canadian users, we rely on contractual protections in our agreements with each sub-processor and on the disclosure of these transfers as part of obtaining your consent to use KnockIQ.

---

## 12. How Long We Keep Information (Retention)

We retain personal information only as long as needed for the purposes described in this Policy or as required by law. Retention is enforced automatically by a nightly database job.

| Data | Retention period |
|---|---|
| Rep account records | Active while the account exists; deleted within 90 days of account deletion, except records we are required to keep for tax, billing, or audit purposes |
| Canvassing session header + summary statistics | Retained as a business record while the Customer's account is active; deleted within 90 days of account deletion |
| Interaction records (estimates, bookings, conversations) | 24 months from creation, then deleted automatically |
| Interaction records with outcome "no answer" | 180 days from creation, then deleted automatically. These rows contain only the doorstep coordinate, timestamp, and outcome — no address, contact, or notes are stored for no-answer doors |
| GPS breadcrumb data (the rep's path-walked points during a session) | 12 months from creation, then deleted automatically |
| Live rep-location pin shown to managers during an active session | Cleared when the session ends; orphan rows older than 24 hours are deleted automatically by a sweep that runs every 10 minutes |
| Voice recordings, audio, and transcripts | Not collected — the voice-note feature has been removed from the product |
| Photographs uploaded by Reps | Stored with the interaction record they belong to; deleted on the same schedule (24 months general; 180 days if the parent interaction is "no answer" — but no-answer rows do not accept photo uploads) |
| Customer billing records | Retained for 7 years for tax and accounting compliance |
| Do-not-knock entries | Retained indefinitely while the Customer's account is active, because the purpose is precisely to remember the request not to be visited; you may request deletion at any time |
| Logs and security records | 12 months |

---

## 13. Security

We implement administrative, technical, and physical safeguards designed to protect personal information against unauthorized access, disclosure, alteration, and destruction. These include:

- Encryption in transit (TLS) for all communications with our servers and sub-processors.
- Encryption at rest for our primary database and file storage, as provided by Supabase.
- Row-level access controls in our database that restrict each Customer's users to their own organization's data.
- Private file storage for uploaded photographs and avatars, accessed only through short-lived signed URLs.
- Multi-factor authentication on administrative and infrastructure accounts.
- Periodic review of access controls, code, and infrastructure configurations.
- Limited use of a "super admin" role for internal support, with cross-tenant access restricted to authorized personnel.

No security system is perfect. If we become aware of a security incident affecting your personal information, we will notify you as required by applicable law.

---

## 14. Your Privacy Rights — United States

The rights available to you depend on the state in which you reside. KnockIQ provides the following rights to all US residents, regardless of state, and provides additional rights where state law requires:

- **Right to know / right of access** — request the categories and specific pieces of personal information we have about you.
- **Right to correct** — request that inaccurate personal information be corrected.
- **Right to delete** — request deletion of personal information we hold about you.
- **Right to data portability** — receive your information in a portable, machine-readable format.
- **Right to opt out** of any sale or sharing of personal information (we do not currently sell or share, but you may register your preference for future changes).
- **Right to opt out of profiling** with legal or similarly significant effects (we do not currently profile).
- **Right to limit use of sensitive personal information** (California, Virginia, Colorado, Connecticut, Utah, and others) — see Section 8.
- **Right to appeal** a denial of any of the above (Colorado, Connecticut, Virginia, Texas, Oregon, Montana, Delaware, New Hampshire, New Jersey, Maryland, Minnesota, Tennessee, and others). If we deny your request, you may appeal by replying to the denial within 45 days; we will respond to the appeal within 60 days, and where required will provide information on how to contact your state attorney general.

**How to make a request:**
- Email: privacy@knockiq.com
- Mail: KnockIQ, LLC, Attn: Privacy Officer, 4609 N Clark Ave, Tampa, FL 33614, United States
- Phone: (813) 669-0997

We will verify your identity before responding to a request. Verification methods are proportionate to the sensitivity of the request. We will respond to most requests within **45 days**; if we need more time we will notify you within that period.

**No discrimination.** We will not retaliate against you or charge you a different price for exercising your privacy rights, except as permitted by law for bona fide loyalty programs (none currently offered).

**Universal opt-out signals (GPC).** If your browser sends a Global Privacy Control signal, we will treat it as a valid opt-out of any future sale or sharing of personal information from that browser. Per January 2026 California regulations, we will visibly confirm that we have processed the signal.

**Visited Persons.** If you are a Visited Person — meaning a Rep visited your residence and recorded information about you — you have **the same rights** under California CCPA/CPRA and parallel state laws as any other resident of your state. You do not need to have a KnockIQ account. To exercise your rights:

1. Email **privacy@knockiq.com** with the **street address** of the visited residence (so we can locate records) and your contact information for verification.
2. We will acknowledge your request promptly and complete the substantive response within 45 days.
3. We will search the systems where Visited Person data is stored (interaction records, GPS breadcrumbs, do-not-knock lists, photographs) and process your request as you direct.
4. We will notify our sub-processors to delete your data as well, where applicable.

---

## 15. Your Privacy Rights — Canada

If you are a resident of Canada, you have the following rights under the federal Personal Information Protection and Electronic Documents Act (PIPEDA), Quebec's Law 25, Alberta's Personal Information Protection Act, and British Columbia's Personal Information Protection Act, as applicable:

- **Right to be informed** about our collection, use, and disclosure of your personal information.
- **Right to withdraw consent** at any time, subject to legal or contractual restrictions and reasonable notice. Withdrawing consent may end your ability to use KnockIQ.
- **Right of access** to your personal information and an account of its use and disclosure.
- **Right to correct** inaccurate personal information.
- **Right to delete** personal information (a stronger right under Quebec Law 25 than under PIPEDA's federal framework).
- **Right to portability** — to obtain a computerized copy of your personal information (Quebec only, in force).
- **Right to be informed of the use of automated decision-making** that produces legal or similarly significant effects (Quebec Law 25; not currently applicable as we do not engage in such automated decisions).
- **Right to lodge a complaint** with the Office of the Privacy Commissioner of Canada or your provincial commissioner (Quebec: Commission d'accès à l'information; Alberta: Office of the Information and Privacy Commissioner; British Columbia: Office of the Information and Privacy Commissioner).

To exercise these rights, contact our **Privacy Officer**: Zach Tyler, privacy@knockiq.com, (813) 669-0997, 4609 N Clark Ave, Tampa, FL 33614, United States.

We will respond to access and correction requests within **30 days** of receipt, as required by PIPEDA, unless we have notified you of an extension.

---

## 16. Children's Privacy

KnockIQ is not directed at children under 13, and we do not knowingly collect personal information from children under 13.

**Reps must be 18 or older** to use the service, by the terms of their employment with a Customer. **Visited Persons** are typically the adult occupants of a household. Our Terms of Service require Customers to train Reps not to collect information from a minor who answers the door, and to remove any information that may have been collected from a minor.

If you believe we have inadvertently collected information from a child under 13, please contact us at privacy@knockiq.com and we will delete it.

We comply with the Children's Online Privacy Protection Act (COPPA) and its 2025 amendments (which took full effect April 22, 2026), and with applicable state laws governing the personal information of minors.

---

## 17. Cookies and Similar Technologies

KnockIQ uses a small number of cookies and local-storage items to keep you signed in and to remember your settings between visits:

- **Authentication tokens** stored in your browser's local storage so you do not have to sign in on every page load.
- **Session state** (including a temporary cached copy of your active canvassing session) so the app continues to work briefly if you go offline mid-canvass.
- **UI preferences** (such as your last-selected map view).

We do not use third-party advertising cookies, retargeting pixels, or cross-site tracking technologies. We do not currently use analytics SDKs (e.g., Google Analytics, Mixpanel, Segment).

If we add analytics or other tracking technologies in the future, we will update this Policy and provide appropriate opt-out mechanisms.

---

## 18. Do Not Track / Global Privacy Control

Our service responds to Global Privacy Control (GPC) signals as an opt-out of sale and sharing of personal information, per Section 14. We do not currently respond to legacy "Do Not Track" headers, which are not standardized.

---

## 19. Third-Party Links and Integrations

The KnockIQ application may link to or integrate with third-party services that the Customer has enabled (for example, an outbound webhook configured by the Customer's account owner). When you interact with those services, their own privacy policies govern. We are not responsible for the privacy practices of third-party services, including but not limited to Google Maps Platform, OpenStreetMap, Stripe, Resend, and Zapier.

---

## 20. Changes to This Policy

We may update this Policy from time to time. The "Last Updated" date at the top of the Policy reflects the most recent change. If we make material changes, we will:

- Notify you by email (for Reps and Customer administrators) at least **30 days** before the changes take effect, and
- Post a prominent notice on getknockiq.com and in the application.

For Visited Persons, we will post material changes prominently on https://www.getknockiq.com/privacy. Continued use of KnockIQ after the effective date of any change constitutes acceptance of the updated Policy.

---

## 21. Contact Us

**KnockIQ Privacy Team**
KnockIQ, LLC
Attn: Privacy Officer
4609 N Clark Ave
Tampa, FL 33614
United States
Email: privacy@knockiq.com
Phone: (813) 669-0997

**Privacy Officer (United States and Canada):** Zach Tyler, privacy@knockiq.com, (813) 669-0997.

For California-specific requests, you may email privacy@knockiq.com or call us at (813) 669-0997.

---

## State-Specific Disclosures Appendix

### California (CCPA / CPRA)
In the 12 months preceding the date of this Policy, KnockIQ has collected the following categories of personal information about California residents (including Reps and Visited Persons whose addresses are in California): identifiers (name, email, phone, address, IP), commercial information (subscription, transaction history), internet/network activity (logs, device info), **precise geolocation** (Rep and Visited Person), professional/employment information (Rep role, commission), and inferences drawn from the above (performance scoring). Sources, purposes, and recipients are described in Sections 3–7 above. We have **not sold or shared** personal information for cross-context behavioral advertising in this period. California residents have the rights described in Section 14. To exercise these rights or authorize an agent to act on your behalf, see Section 14.

### Virginia (VCDPA)
Virginia residents have the rights to access, correct, delete, and obtain a copy of their personal data, and to opt out of targeted advertising, the sale of personal data, and profiling with legal or similarly significant effects. To appeal a denied request, reply to the denial within 45 days; we will respond to the appeal within 60 days. After completing the appeal process, you may contact the Virginia Attorney General if you remain dissatisfied. Effective July 1, 2026, we do not sell precise geolocation data.

### Colorado (CPA)
Colorado residents have the rights to access, correct, delete, and obtain a copy of their personal data, and to opt out of targeted advertising, sale, and profiling. We recognize the Global Privacy Control signal as a universal opt-out. To appeal a denied request, follow the instructions in Section 14; you may also contact the Colorado Department of Law.

### Connecticut, Delaware, Indiana, Iowa, Kentucky, Maryland, Minnesota, Montana, Nebraska, New Hampshire, New Jersey, Oregon, Rhode Island, Tennessee, Texas, Utah
Residents of these states have similar rights to those described above. State-specific contact procedures and appeal mechanisms are described in Section 14. For Maryland residents, we apply MODPA's heightened protections to sensitive personal information collected from you, including the strict-necessity standard for sensitive data and the prohibition on sale of sensitive data.

### Florida (FDBR)
The Florida Digital Bill of Rights applies to entities meeting specific thresholds. To the extent KnockIQ is covered, Florida residents have rights to access, correct, delete, opt out of sale, opt out of targeted advertising, and opt out of profiling.

---

## End of Policy

**Version:** 2.0

*This Privacy Policy is provided for general informational purposes and does not constitute legal advice. KnockIQ recommends review by qualified counsel before publication and periodically thereafter.*
