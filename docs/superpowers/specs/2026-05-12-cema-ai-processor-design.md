# CEMA AI Processor — Design Spec

**Project codename:** CEMA AI Processor (working title — final brand TBD)
**Status:** Design — pending user review
**Author:** Connor Hickey, with brainstorming assistance from Claude (Opus 4.7)
**Date:** 2026-05-12
**Scope:** End-to-end AI software product that replaces 2–3 CEMA loan processor FTEs at lender clients in New York State. Refi + Purchase CEMA, all four lender sub-types, full document lifecycle from intake through recording.
**Prior art:** See `docs/research/00-brainstorming-context.md`, `docs/research/01-job-tasks-and-automation.md`, `docs/research/02-competitive-landscape.md`.

---

## 1. Executive Summary

**What we are building:** A vertical AI software product that replaces the labor of 2–3 CEMA mortgage loan processors at NY-active lenders. The product is a four-layer system: (1) a CEMA Deal entity with attorney-supervised review; (2) a unified processor workspace that captures every communication, contact, file, calendar event, and deadline a human processor touches; (3) AI agents that execute CEMA-specific tasks (servicer outreach, IDP, chain-of-title, document generation, recording prep) on top of that workspace; (4) an autonomous voice agent that uses the same telephony foundation to dial and converse with prior servicers' CEMA departments.

**Why this exists:** No vendor markets a dedicated CEMA workflow product. The "CEMA processor" labor category exists because the software stack does not solve the multi-party coordination problem. A successful product captures ~$200–400k annual saved-salary per client and builds a moat through a per-servicer playbook library that competitors cannot quickly replicate.

**Primary buyer:** NY-active lenders in any of four sub-types — Independent Mortgage Bankers (IMB), regional banks, community banks / credit unions, wholesale lenders / broker networks. **All four are architecturally supported from day 1** (data model, multi-tenant scaffolding, LOS-adapter interface, billing model). **LOS integrations and onboarding flows ship sequentially**: Encompass (Phase 0–1, covers IMB + most Regional), LendingPad (Phase 1.5, covers Community + some Regional), MeridianLink + Calyx Path (Phase 4, completes coverage). This balances the user's "all four from start" requirement with engineering realism.

**Geographic scope:** New York State only at launch. Multi-state expansion is explicitly out of scope.

**Compliance posture:** Attorney-supervised lender tool. The software produces drafts; the lender's existing approved CEMA attorney reviews and signs every legal document before any borrower-facing release.

**Scope warning (read this):** The chosen scope (all four sub-types + both CEMA types + 50+ integrations + autonomous voice agent) represents a 20–30 month build at typical AI-startup velocity. The phasing in §11 sequences delivery so the wedge (Phase 0 + Phase 1) ships in ~9 months and proves ROI before the full system is feature-complete. Without a design partner identified (see §13.1), there is real risk of building speculative requirements. The phasing hedges this by making Phase 0 useful as a workspace for any loan processor, regardless of CEMA volume.

---

## 2. Goals & Non-Goals

### 2.1 Goals (v1, by end of Phase 3)

1. Replace 2–3 CEMA loan processor FTEs at one lender client, measured by deals closed without human processor intervention except for exception handling and attorney sign-off.
2. Cut average CEMA deal time from ~75 days to ≤45 days by automating the prior-servicer outreach cadence.
3. Capture **every** communication touching a CEMA deal (phone, email, IM, calendar, files) into a single queryable knowledge graph.
4. Generate the full CEMA closing package (Form 3172, Exhibits A–D, gap note, gap mortgage, §255/§275 affidavits, MT-15, ACRIS cover pages, county cover sheets, AOM, allonge) with attorney-review checkpoint before borrower release.
5. E-record the executed package via Simplifile (statewide) and ACRIS direct (NYC boroughs).
6. Support Refi-CEMA and Purchase-CEMA from launch.
7. Integrate with the two highest-priority NY-relevant LOS platforms (Encompass by Phase 1, LendingPad by Phase 1.5). MeridianLink and Calyx Path follow in Phase 4. All four are abstracted behind a single `LosAdapter` interface from day 1 so additions are non-breaking.
8. Run an autonomous voice agent (Phase 3) that dials prior servicers and follows per-servicer playbooks.
9. Achieve SOC 2 Type II within 12 months of first production deployment.

### 2.2 Non-Goals (v1)

1. **Multi-state expansion.** NY-only. NJ, FL, MA tax-savings instruments may be follow-on products but are not in this spec.
2. **Co-op share-loan processing.** Co-ops are UCC-1 collateral, not real property — strictly out of scope. Equity Settlement and similar boutique firms handle these.
3. **VA loans.** VA does not permit CEMA. Marked ineligible at intake.
4. **FHA loans.** Technically eligible but rarely used. Phase 2.5 if demand emerges.
5. **Borrower-facing direct-to-consumer product.** The buyer is the lender. Borrowers interact through a borrower portal embedded inside the lender's brand.
6. **Replacement of the lender's LOS.** We integrate, we do not replace.
7. **Replacement of DocMagic / IDS for document generation.** We generate from templates via DocMagic's API; we do not rebuild their 300,000-form library.
8. **Replacement of Simplifile / Qualia / Encompass.** We integrate, we do not compete.
9. **Personal mobile native call recording.** Excluded by your decision. Personal mobile is reachable via softphone apps only.
10. **Generic mortgage processing.** This is a CEMA-specific product. Non-CEMA refis are _flagged at intake_ and routed back to the lender's normal LOS workflow.

### 2.3 Explicit Trade-offs Made

| We chose                           | We did not choose                      | Reason                                                                 |
| ---------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Attorney-supervised                | Attorney-as-customer                   | Lender is the buyer; attorney is the legal nameplate, not the customer |
| Buy voice infra, own playbooks     | Build voice infra                      | Voice is commodity; per-servicer playbooks are the moat                |
| All four lender sub-types from v1  | IMB-first                              | Per your decision                                                      |
| Both Refi + Purchase from v1       | Refi-first phased rollout              | Per your decision                                                      |
| Vercel + Next.js + Workflow DevKit | AWS-native (Bedrock + Step Functions)  | Faster iteration, better DX, branch-per-PR previews                    |
| Single integrated platform         | Embedded plug-in to Qualia / Encompass | Maximum equity capture, maximum switching cost                         |

---

## 3. Users, Buyers & Personas

### 3.1 The Buyer

The economic buyer is a **VP of Operations, Head of Production, or COO** at an NY-active lender. Sub-types:

| Sub-type                          | Typical org size     | Typical CEMA volume/yr  | Typical LOS                         | Sales cycle                   |
| --------------------------------- | -------------------- | ----------------------- | ----------------------------------- | ----------------------------- |
| Independent Mortgage Banker (IMB) | 50–500 employees     | 500–10,000              | Encompass                           | 6–12 months                   |
| Regional bank                     | 500–10,000 employees | 500–3,000               | Encompass / MeridianLink            | 9–15 months                   |
| Community bank / credit union     | <500 employees       | 50–500                  | LendingPad / MeridianLink / Symitar | 6–9 months                    |
| Wholesale lender / broker network | Varies               | Varies, broker-mediated | Encompass                           | Different motion (broker-led) |

### 3.2 Direct Users

| Persona                                               | Role                          | Primary surfaces used                     |
| ----------------------------------------------------- | ----------------------------- | ----------------------------------------- |
| **Loan Processor** (the FTE being augmented/replaced) | Owns deal end-to-end          | All surfaces; this is the supervised role |
| **Closing Coordinator / Closer**                      | Owns final closing logistics  | Pipeline, document review, calendar       |
| **Approved CEMA Attorney**                            | Legal sign-off, drafts review | Attorney Review queue, redlines           |
| **Title Reviewer**                                    | Title commitment, Schedule A  | Title section of deal                     |
| **Loan Officer (LO)**                                 | Brings deals in               | Calculator, eligibility, borrower portal  |
| **Borrower**                                          | Subject of the deal           | Borrower portal only                      |
| **Lender Operations Manager**                         | Operational oversight         | Pipeline, exception queue, SLA dashboard  |

### 3.3 Indirect Users (the AI agents)

The product employs **agentic users** that operate alongside humans:

| Agent                         | Role                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| **Intake Agent**              | Identifies CEMA candidates from LOS data, computes savings, generates authorizations |
| **Servicer Outreach Agent**   | Email + (Phase 3) voice outreach to prior servicers' CEMA departments                |
| **Collateral IDP Agent**      | OCR/extraction of incoming Note, Mortgage, Assignments, Allonges, prior CEMAs        |
| **Chain-of-Title Agent**      | Builds and reconciles mortgage chain against title commitment, surfaces breaks       |
| **Document Generation Agent** | Drafts Form 3172, Exhibits, §255/§275 affidavits, gap docs, AOM, allonges            |
| **Recording Prep Agent**      | MT-15, ACRIS cover pages, county-specific cover sheets, fee math                     |
| **Borrower Comms Agent**      | Status updates, document requests, scheduling                                        |
| **Internal Comms Agent**      | Pings LO, attorney, title via Slack/email/calendar                                   |
| **Voice Agent (Phase 3)**     | Autonomous outbound calls to servicers, with escalation to human                     |
| **Exception Triage Agent**    | Classifies anomalies; routes to human queue                                          |

---

## 4. The CEMA Domain — Context for New Readers

This section exists so any engineer joining the project has a working mental model of what CEMA is before diving into the system. Detailed mechanics live in `docs/research/01-job-tasks-and-automation.md`.

A CEMA (Consolidation, Extension, and Modification Agreement) is a New York State mortgage instrument used during a refinance (Refi-CEMA) or purchase (Purchase CEMA). Instead of the new lender originating a brand-new mortgage and the borrower paying NYS mortgage recording tax on the full new loan amount, the prior lender _assigns_ its existing mortgage to the new lender. A "gap mortgage" is recorded for only the new money (new loan amount minus existing unpaid principal balance), and recording tax is paid only on that gap.

NYS mortgage recording tax rates: ~1.8–1.925% in NYC, 1.05% in Nassau/Suffolk/Westchester, 0.75–1.05% in most upstate counties. On a $700k refi with $500k UPB, a borrower saves $3,600–$4,100. The savings are real, the mechanics are paperwork-heavy, and the timeline is dominated by waiting on the prior servicer to deliver the collateral file (Note, Mortgage, all intervening Assignments and Allonges). Industry consensus: ~75 days total close, vs. ~30 for a plain refi.

The closing package centers on **Fannie Mae/Freddie Mac Form 3172** with four Exhibits, plus:

- **§255 Affidavit** — claims the supplemental-mortgage exemption under NY Tax Law §255 (the legal linchpin of the tax savings)
- **§275 Affidavit** — proves recording tax was paid on every prior mortgage in the chain
- **Gap Note + Gap Mortgage** — the new-money instrument
- **Consolidated Note** — the merged note signed by borrower
- **Assignment of Mortgage(s) and Allonge(s)** — one per prior mortgage being assigned

Recording happens via NYC ACRIS (Manhattan, Bronx, Brooklyn, Queens, Staten Island) or one of 57 upstate county clerks (with idiosyncratic forms and fees per county). **ALTA 11.1-06** is the typical title insurance endorsement.

---

## 5. Architecture — Four Layers

The system is structured as four layers, each consuming the one beneath it.

```
┌───────────────────────────────────────────────────────────────────┐
│  LAYER 4 — AUTONOMOUS VOICE AGENT (Phase 3)                       │
│  • Outbound dialing & conversation via Twilio Voice               │
│  • ElevenLabs TTS, Deepgram STT real-time                         │
│  • Per-servicer playbook execution with confidence scoring        │
│  • Escalation to human on low-confidence turns                    │
└───────────────────────────────────────────────────────────────────┘
                          ▲ uses telephony from L2
┌───────────────────────────────────────────────────────────────────┐
│  LAYER 3 — CEMA AI AGENTS (Phase 1–2)                             │
│  • Intake Agent, Servicer Outreach Agent, Collateral IDP Agent,   │
│    Chain-of-Title Agent, Document Generation Agent,               │
│    Recording Prep Agent, Borrower Comms Agent,                    │
│    Internal Comms Agent, Exception Triage Agent                   │
│  • All agents share the Deal entity and Layer 2 workspace context │
│  • Durable workflows in Vercel Workflow DevKit                    │
└───────────────────────────────────────────────────────────────────┘
                          ▲ uses everything in L2
┌───────────────────────────────────────────────────────────────────┐
│  LAYER 2 — UNIFIED PROCESSOR WORKSPACE (Phase 0)                  │
│  • Telephony: VoIP integration, work-cell softphone, call         │
│    recording + transcription, semantic search                     │
│  • Email: Gmail + Microsoft 365 unified inbox                     │
│  • Internal messaging: Slack + Microsoft Teams                    │
│  • Calendar: Google + Microsoft 365                               │
│  • Files: Drive + OneDrive + Box + SharePoint                     │
│  • Contacts: unified graph across all sources                     │
│  • Deadlines & SLA tracking                                       │
│  • Knowledge graph + vector search across everything              │
└───────────────────────────────────────────────────────────────────┘
                          ▲ persists Deal + entities
┌───────────────────────────────────────────────────────────────────┐
│  LAYER 1 — DEAL ENTITY + ATTORNEY REVIEW (Phase 0)                │
│  • CEMA Deal as the central entity                                │
│  • Multi-tenant org/team/user model                               │
│  • Attorney Review workflow gates document release                │
│  • Audit trail + immutable event log                              │
└───────────────────────────────────────────────────────────────────┘
```

The architectural principle is **shared entity, multiple views**. Every surface (calculator, pipeline, document drafting, voice agent transcript) is a view over the same Deal entity, with consistent state, audit history, and access control.

---

## 6. Data Model

### 6.1 Core Entities

```
Organization (tenant)
  └── Team (e.g., "NYC Refi Desk", "Westchester Closing")
        └── User (Loan Processor, Closer, Attorney, etc.)
              └── operates on
                    Deal (CEMA-specific) ← THE CENTRAL ENTITY
```

### 6.2 The Deal Entity

```
Deal
  ├── id, type (refi_cema | purchase_cema), state (NY only v1)
  ├── status (intake → eligibility → authorization → collateral_chase →
  │            title_work → doc_prep → attorney_review →
  │            closing → recording → completed | exception)
  ├── created_at, target_close_at, sla_breach_at
  │
  ├── Property
  │     ├── street, unit, city, county (NYC borough or upstate)
  │     ├── property_type (1-family | 2-family | 3-family | condo | PUD)
  │     ├── block_lot (NYC) | tax_map_id (upstate)
  │     └── ACRIS_links (pre-fetched mortgage chain for NYC)
  │
  ├── Existing_Loan(s)
  │     ├── upb, original_principal, note_date, maturity
  │     ├── current_servicer (linked to Servicer entity)
  │     ├── investor (Fannie/Freddie/private)
  │     ├── recorded_at (reel/page or CRFN)
  │     └── chain → Array<{ Assignor, Assignee, recorded_at }>
  │
  ├── New_Loan
  │     ├── principal, rate, term, program
  │     ├── new_lender (= our customer)
  │     ├── investor_program (Fannie / Freddie / private)
  │     └── target_funding_date
  │
  ├── Borrower(s)
  │     ├── name, SSN (encrypted), credit_score
  │     ├── identity_verified_at, kyc_provider, kyc_reference
  │     └── authorization (signed CEMA authorization)
  │
  ├── (Purchase CEMA only) Seller(s)
  │     ├── name, contact, seller_attorney, seller_lender
  │     └── cooperation_status
  │
  ├── Parties
  │     ├── LO (loan officer at new lender)
  │     ├── Processor (human or AI agent)
  │     ├── Closing_Attorney (must be on prior-servicer Approved List)
  │     ├── Title_Agent
  │     ├── Seller_Attorney (Purchase CEMA)
  │     └── Investor_Doc_Custodian (Iron Mountain / DB / US Bank / Wells)
  │
  ├── Calculations (denormalized snapshots for audit)
  │     ├── savings_breakdown {gross_tax_avoided, assigning_fee,
  │     │                      attorney_fee, title_incremental, net}
  │     └── breakeven_pass: boolean
  │
  ├── Documents (linked Document entities; see §6.4)
  ├── Communications (linked Communication entities; see §6.5)
  └── Tasks (linked Task entities; see §6.6)
```

### 6.3 Servicer Entity (the playbook library) ⭐

This is the moat. Every servicer that holds NY mortgages has its own per-servicer playbook.

```
Servicer
  ├── id, legal_name, dba_names[]
  ├── nmls_id, mers_org_id
  ├── parent (e.g., NewRez owns Shellpoint)
  ├── CEMA_Department
  │     ├── phone, fax, email, portal_url
  │     ├── intake_form_template (PDF + extracted fields)
  │     ├── accepted_submission_methods[] (fax_only | email | portal)
  │     ├── escalation_path[] (rep names, supervisor emails)
  │     ├── typical_sla_business_days (avg, p50, p95)
  │     ├── common_rejection_reasons[]
  │     └── notes_from_processors (free-text knowledge base)
  ├── Collateral_Custody
  │     └── custodian (Iron Mountain | DB | US Bank | Wells | other)
  ├── playbook_version, last_verified_at
  └── success_metrics
        └── { deals_processed, avg_response_days, exception_rate }
```

After 12 months of operation, this table is the asset competitors cannot match.

### 6.4 Document Entity

```
Document
  ├── id, deal_id, kind (note | mortgage | assignment | allonge |
  │                      cema_3172 | exhibit_a | exhibit_b | exhibit_c |
  │                      exhibit_d | consolidated_note | gap_note |
  │                      gap_mortgage | aff_255 | aff_275 | mt_15 |
  │                      nyc_rpt | tp_584 | acris_cover_pages |
  │                      county_cover_sheet | payoff_letter |
  │                      authorization | title_commitment |
  │                      title_policy | endorsement_111 | other)
  ├── version, status (draft | attorney_review | approved | executed | recorded)
  ├── blob_url (Vercel Blob), checksum, page_count
  ├── extracted_data (structured fields from IDP)
  ├── attorney_review_required (boolean), attorney_review_id (FK)
  ├── source (uploaded | generated | retrieved_from_servicer)
  ├── parties_signed_at[]
  └── recorded_at (reel/page or CRFN, when applicable)
```

### 6.5 Communication Entity (the queryable layer)

```
Communication
  ├── id, deal_id (nullable — some comms aren't deal-linked yet)
  ├── kind (call | email | sms | slack | teams | meeting | letter | fax)
  ├── direction (inbound | outbound)
  ├── from_party_id, to_party_ids[], cc_ids[]
  ├── started_at, ended_at, duration_seconds
  ├── medium (phone_landline | phone_softphone | gmail | m365 |
  │           slack | teams | sms_twilio | …)
  ├── source_thread_id (links related comms in the same thread)
  ├── transcript (full text, indexed for search)
  ├── transcript_embeddings (pgvector or Turbopuffer)
  ├── attachments[] → Document
  ├── ai_summary, ai_action_items[], ai_sentiment
  └── audit_log (immutable trail of who accessed what)
```

### 6.6 Task Entity (deadlines, SLAs)

```
Task
  ├── id, deal_id, assigned_to (user or agent)
  ├── kind (call_servicer | review_doc | sign_off | follow_up | wait_for_event)
  ├── due_at, sla_breach_at
  ├── status (todo | in_progress | waiting | done | escalated)
  ├── depends_on[] (task graph)
  └── related_communication_ids[], related_document_ids[]
```

### 6.7 Knowledge Graph Schema (Apache AGE on Postgres)

The graph layer connects entities for fast traversal:

```
Nodes: Org, User, Deal, Property, Loan, Servicer, Borrower, Seller,
       LO, Attorney, TitleAgent, Document, Communication, Task

Edges:
  (User)-[WORKS_AT]->(Org)
  (User)-[MEMBER_OF]->(Team)
  (Deal)-[ASSIGNED_TO]->(User)
  (Deal)-[ON_PROPERTY]->(Property)
  (Deal)-[HAS_BORROWER]->(Borrower)
  (Deal)-[ASSIGNS_FROM]->(Servicer)
  (Deal)-[CLOSED_BY]->(Attorney)
  (Communication)-[ABOUT]->(Deal)
  (Communication)-[BETWEEN]->(Party)
  (Document)-[ATTACHED_TO]->(Communication)
  (Document)-[OF_KIND]->(DocumentKind)
  (Property)-[HAS_PRIOR_MORTGAGE]->(Loan) [from ACRIS]
  …
```

This allows queries like:

- "Show me every call Chase's CEMA department made to us across all deals in the last 90 days"
- "What's our average chain-break rate on 2007–2010 Wells securitization era mortgages"
- "Which deals are SLA-breach-imminent and waiting on Mr. Cooper"

### 6.8 Audit & Event Log

Every state change (deal status, document revision, attorney approval, communication recorded) emits an event to an append-only event log (Postgres table + optional ClickHouse mirror in Phase 2). Used for compliance, debugging, and feature analytics.

---

## 7. Layer 1 — Deal Entity + Attorney Review

### 7.1 Purpose

Provide the multi-tenant data foundation and the legal-review gate. Nothing else can ship until this exists.

### 7.2 Components

**Auth & Tenancy**

- Clerk for user auth, B2B orgs, JWTs, SCIM
- WorkOS layered for enterprise SSO (SAML, Microsoft Entra, Okta)
- Postgres Row-Level Security as defense-in-depth — every query scoped to org_id

**Deal CRUD + lifecycle state machine**

- Deal status transitions are enforced by a state machine (XState)
- Each transition emits an event to the audit log
- Status changes trigger downstream agents (e.g., "status = collateral_chase" → Servicer Outreach Agent activates)

**Attorney Review workflow**

- Documents marked `attorney_review_required` cannot be released to the borrower or recorded until an approved attorney signs off
- Attorney UI: redline-capable PDF viewer, comment threads, approval button, e-signature via DocuSign
- Audit trail: every approval recorded with timestamp, attorney name, NMLS ID, IP address

**Multi-tenancy model**

- Tenant = `Organization` (a lender, an attorney firm, or a title agent acting as a sub-tenant)
- Inter-tenant data sharing on a per-Deal basis (e.g., the closing attorney sees a Deal owned by the lender)
- Sharing is explicit, time-bound, and audit-logged

### 7.3 Compliance Hooks

- All PII (SSN, DOB, full names) encrypted at rest via Postgres pgcrypto
- All call recordings and document blobs encrypted in Vercel Blob using customer-managed keys (Phase 2)
- GDPR/CCPA data subject access requests via OneTrust integration (Phase 2)
- SOC 2 Type II controls tracked via Vanta

---

## 8. Layer 2 — Unified Processor Workspace ⭐

This is the foundation. The largest single piece of the system.

### 8.1 Purpose

Capture **everything** a loan processor touches into one queryable, AI-accessible system. Without this, the Layer 3 agents are blind.

### 8.2 Sub-system: Telephony

**Inbound & outbound capture from:**

| Source                | Integration                       | Captures                       |
| --------------------- | --------------------------------- | ------------------------------ |
| RingCentral           | RingCentral Phone API             | Calls, voicemail, transcripts  |
| Dialpad               | Dialpad API                       | Calls, voicemail, AI summaries |
| Zoom Phone            | Zoom API                          | Calls, voicemail, transcripts  |
| Microsoft Teams Phone | Microsoft Graph + Teams Calls API | Calls, transcripts             |
| 8x8                   | 8x8 CX API                        | Calls                          |
| Vonage Business       | Vonage API                        | Calls                          |
| GoTo Connect          | GoTo API                          | Calls                          |
| Nextiva               | Nextiva API                       | Calls                          |
| OpenPhone             | OpenPhone API                     | Calls, SMS                     |
| Aircall               | Aircall API                       | Calls, AI insights             |
| JustCall              | JustCall API                      | Calls, AI summaries            |

**Work-cell softphone:** any of the above vendors' mobile softphone apps. Calls placed via the softphone are recorded; calls placed natively on the device are not.

**Personal mobile:** explicitly excluded for native call recording. Personal devices can receive notifications, calendar invites, and emails but cannot record voice calls.

**Compliance:** All recording governed by **two-party consent** (NY is a one-party-consent state, but the product enforces two-party consent for cross-state safety). Beep tones and verbal disclosures configurable per Organization. CallCabinet for compliance-grade recording vault.

**Recording storage:** Vercel Blob (encrypted), 7-year retention (mortgage industry standard), legal-hold flag suspends deletion.

**Transcription:**

- Real-time via Deepgram Nova-3 (during the call)
- Batch via Whisper-Large-v3 for post-call quality + diarization
- Speaker diarization via Pyannote / Deepgram's built-in
- Stored as structured JSON with timestamps and speaker labels

**Programmable telephony (for Phase 3 voice agent):** Twilio Voice as primary, Telnyx as fallback. Both support STIR/SHAKEN attestation, call recording, and programmable IVR.

### 8.3 Sub-system: Email

**Unified inbox via Nylas** abstracts:

- Microsoft 365 / Outlook (Microsoft Graph API)
- Google Workspace (Gmail API)
- iCloud Mail (IMAP — only if a customer demands)

**Outbound transactional email:** Resend (DX + deliverability)

**Email cadences (chase follow-ups):** Built internally; uses Vercel Cron + Vercel Workflow DevKit for stateful sequences with reply-detection breakpoints.

**Email parsing:**

- Headers extracted into structured fields
- Body run through LLM for action-item extraction
- Attachments saved as Documents, kind-classified by IDP

**Email verification on outbound:** NeverBounce (avoid bounces hurting domain reputation)

### 8.4 Sub-system: Internal Messaging

**Slack integration** via Slack App + Bot:

- Read messages from designated channels (e.g., `#cema-pipeline`)
- Post status updates, deal alerts, exception notifications
- Slash commands (e.g., `/cema status DEAL-1234`)
- Permission scopes: minimum viable

**Microsoft Teams** via Bot Framework + Graph API:

- Same surface as Slack
- Tab in Teams for the Pipeline UI

**SMS** via Twilio:

- Outbound deal alerts to processors
- Two-way SMS with prior servicers that prefer SMS (rare but exists)
- Compliant with TCPA via opt-in flow

**WhatsApp Business API** (Phase 1.5):

- Some borrowers/brokers prefer WhatsApp
- Outbound only at first

### 8.5 Sub-system: Calendar & Scheduling

**Calendar APIs** unified via Nylas:

- Microsoft 365 Calendar
- Google Calendar

**Scheduling links via Cal.com** (self-hostable, OSS-licensed):

- Borrower → Loan Officer
- Borrower → Notary / Closer
- Attorney → Internal review meeting

**Calendar-driven automation:**

- Closing-date schedule changes trigger payoff-statement refresh request to prior servicer
- Attorney calendar conflict on a scheduled review → auto-reschedule + notify processor

### 8.6 Sub-system: Files

**File storage backends** (all read-only sync into Vercel Blob):

- Google Drive (Drive API)
- Microsoft OneDrive / SharePoint (Microsoft Graph)
- Dropbox Business
- Box
- Egnyte (mortgage-popular)
- NetDocuments (law-firm popular, for the attorney role) — Phase 2
- iManage Work (law-firm popular) — Phase 2

**Document storage of generated documents:** Vercel Blob, encrypted, versioned

**Document virus scanning** on upload via ClamAV in Vercel Sandbox

**eSignature integration:**

- DocuSign primary (mortgage industry standard)
- Adobe Acrobat Sign secondary
- PandaDoc for non-mortgage internal docs
- Snapdocs for full e-closing (Phase 2)

**Remote Online Notarization (RON):**

- Pavaso primary (deep mortgage roots)
- Stavvy secondary

### 8.7 Sub-system: Contacts & Relationship Graph

**Unified contact entity** across sources:

- CRM: Salesforce (via Merge.dev unified API), HubSpot, Total Expert, Velocify, Surefire, BNTouch
- Email contacts: extracted from Nylas
- Phone contacts: extracted from PBX APIs
- Slack/Teams users: extracted from workspace
- LOS contacts: pulled from Encompass / LendingPad / etc.

**Contact merging:** entity-resolution via deterministic match (email/phone) + ML similarity (name + employer + history) for ambiguous cases. Mem0 stores AI's confidence per merge.

**Enrichment:** Clay or Apollo for business contacts; ZoomInfo as enterprise upgrade.

**Special contact types:**

- **Servicer CEMA-department contacts** — these are gold. Tagged, prioritized, included in the per-servicer playbook.
- **Approved CEMA Attorneys** — tagged by which lender's Approved List they're on.

### 8.8 Sub-system: Tasks, Deadlines & SLA Tracking

**Internal task engine** (don't add a Monday/Asana dependency for internal tasks):

- Task entity per Deal
- Dependency graph
- SLA breach detection via Vercel Cron + Workflow DevKit
- Visual Kanban + List views

**Mirror external task tools:** Asana, Monday, ClickUp, Linear, Notion, Smartsheet — read-only for capturing what processors do in non-CEMA tools.

### 8.9 Sub-system: Search & Memory (the "interrogatable" interface)

This is where the workspace becomes AI-queryable.

**Full-text search:** Typesense (better DX than Elasticsearch; ~100ms p95 queries on 50M docs)

**Vector search:**

- pgvector for in-database similarity on smaller corpora (per-org)
- Turbopuffer for billion-row global embeddings (all communications, all docs)

**Embeddings model:** OpenAI text-embedding-3-large (3072-dim) with Cohere Embed v4 as fallback

**Knowledge graph queries:** Apache AGE Cypher queries over the graph schema

**Conversational memory:** Mem0 stores agent-level memory (what the AI has learned about a specific servicer rep, a specific attorney's preferences, etc.)

**Query interface:** an AI-powered "Ask anything" search bar in the UI that:

1. Classifies query intent (search vs. action vs. analytics)
2. Routes to the right index (full-text / vector / graph / SQL)
3. Returns results with citations
4. Allows follow-up actions ("call this person", "summarize this thread")

Built using Vercel AI SDK + AI Elements for chat-style UI.

### 8.10 Sub-system: Audit & Compliance Log

Every read access to a Communication, Document, or PII field is logged. Used for:

- SOC 2 Type II evidence
- GDPR/CCPA data-subject requests
- Litigation hold and discovery
- Anomaly detection (unusual access patterns)

---

## 9. Layer 3 — CEMA AI Agents

### 9.1 Purpose

Execute CEMA-specific workflow tasks autonomously, with Layer 2 as context and humans in the loop for high-stakes decisions.

### 9.2 Architecture Pattern

Each agent is a **durable workflow** in Vercel Workflow DevKit (WDK). Steps within the workflow are:

- LLM calls (via Vercel AI Gateway, routed to Anthropic Claude Opus 4.7 / Sonnet 4.6 / OpenAI GPT-5 / Gemini 2.5 Pro per task)
- Tool calls (read from Layer 2, write to Layer 1)
- Human-in-loop pauses (workflow waits for an attorney approval, then resumes)
- External API calls (Servicer portal, ACRIS, DocMagic)

WDK gives us:

- Durable state (workflow survives deploys + region failures)
- Step replay (debug a 40-day-old workflow by stepping through events)
- Automatic retries with backoff
- Distributed locking
- Cron-based triggers

### 9.3 Agent: Intake Agent

**Trigger:** New loan application in the integrated LOS (Encompass / LendingPad / MeridianLink / Calyx)

**Steps:**

1. Read application data via LOS API
2. Eligibility check:
   - State == NY
   - Property type ∈ {1-family, 2-family, 3-family, condo, PUD} (exclude co-op, VA, FHA in v1)
   - First-lien only
   - Has existing UPB to assign
3. ACRIS pre-discovery (NYC properties only):
   - Query ACRIS Open Data API for the property's BBL
   - Pull every recorded mortgage, satisfaction, assignment in chain
   - Pre-build draft Schedule A
4. MERS lookup for current servicer
5. Compute savings: existing UPB × applicable NY recording tax rate − fees
6. Generate borrower CEMA authorization (PDF) and route to DocuSign
7. Create Deal record (status = `intake`)
8. Notify LO via Slack/Teams

**LLM use:** Claude Sonnet 4.6 for eligibility edge-case reasoning, Sonnet 4.6 for borrower-facing savings narrative.

### 9.4 Agent: Servicer Outreach Agent

**Trigger:** Deal status transitions to `authorization_received`

**Steps:**

1. Look up Servicer record for current servicer (from MERS)
2. Load per-servicer playbook
3. Generate CEMA request packet (per the servicer's intake format — PDF, email, portal upload, or fax)
4. Send via the servicer's accepted channel (Resend for email; programmatic fax via Twilio Programmable Fax; portal automation via Sandboxed browser)
5. Set follow-up cadence: T+5 business days, T+10, T+15, T+20
6. **(Phase 3)** Voice agent dials servicer's CEMA department at T+10
7. On response: classify response (delivered | rejected | needs-info | other) and route
8. On collateral file arrival: pass to Collateral IDP Agent

**LLM use:** Claude Opus 4.7 for response classification and playbook adaptation; Sonnet 4.6 for cadence email drafting.

### 9.5 Agent: Collateral IDP Agent

**Trigger:** Collateral file (FedEx envelope) arrives → scanned/uploaded → kicks off

**Steps:**

1. Multi-page PDF received in Vercel Blob
2. Split into individual documents (kind classification)
3. For each:
   - Reducto for general extraction
   - Textract Lending API for mortgage-specific fields
   - Vaultedge for mortgage-tuned models (when available)
4. Extract: parties, dates, dollar amounts, reel/page/CRFN, recording county
5. Build chain-of-title graph
6. Compare against title-commitment Schedule A
7. Flag missing intervening assignments, lost notes, broken chains
8. Pass to Chain-of-Title Agent for resolution

**LLM use:** Claude Opus 4.7 for cross-document reasoning; Sonnet 4.6 for routine kind-classification.

### 9.6 Agent: Chain-of-Title Agent

**Trigger:** IDP agent flags potential break

**Steps:**

1. Build the directed graph of `(Mortgagor)-[MORTGAGE]->(Mortgagee)` and `(Mortgagee_n)-[ASSIGNS_TO]->(Mortgagee_n+1)` edges from extracted data
2. Identify breaks (nodes without an incoming or outgoing edge that should connect)
3. For each break, generate hypotheses:
   - Missing intervening assignment from Servicer X around date Y
   - Lost note — needs §255 lost-note affidavit
   - Securitization-era ambiguity (2007–2010 Wells/BoA/etc. trustee chains)
4. Route hypothesis to:
   - Servicer Outreach Agent to chase missing doc
   - Attorney Review queue for lost-note affidavit decision
5. Log resolution outcome for playbook-library learning

**LLM use:** Claude Opus 4.7 with extended thinking for chain reasoning.

### 9.7 Agent: Document Generation Agent

**Trigger:** Chain-of-title clean + all source data complete

**Steps:**

1. Pull all relevant data: Deal, Property, Existing Loans (with chain), New Loan, Borrower, Servicer, NY tax rates
2. Generate via DocMagic API:
   - Form 3172 (NY CEMA)
   - Exhibits A (consolidated mortgage list), B (legal description), C (consolidated note), D (NY Form 3033)
   - Gap Note + Gap Mortgage
   - Consolidated Note
   - AOM(s) + Allonge(s) for each prior mortgage
   - §255 affidavit, §275 affidavit
3. Cross-document consistency check:
   - Numbers tie (UPB + gap = new principal)
   - Party names consistent
   - Dates consistent
   - Reel/page citations valid
4. Mark all generated docs `attorney_review_required = true`
5. Route to Attorney Review queue
6. On approval, route to Recording Prep Agent

**LLM use:** Claude Opus 4.7 for cross-document consistency reasoning; deterministic templating via DocMagic for the documents themselves.

### 9.8 Agent: Recording Prep Agent

**Trigger:** Attorney-approved closing package

**Steps:**

1. Determine recording venue: ACRIS (NYC borough) or county clerk (upstate)
2. Generate:
   - MT-15 Mortgage Recording Tax Return
   - NYC-RPT + TP-584 (Purchase CEMA only)
   - ACRIS Recording & Endorsement, Tax Return, Supporting Documents, Payment Cover Pages (NYC)
   - County-specific cover sheets (Nassau Tax Lot Verification Letter @ $355, Suffolk Mortgage Verification Fee @ $300, etc.)
   - ALTA 11.1-06 endorsement request to title
3. Calculate exact recording fees from final page count (CEMA packages 35–45 pages → fees vary)
4. Submit via Simplifile (statewide) or ACRIS direct (NYC)
5. Poll for return / acceptance / rejection
6. On acceptance: extract reel/page or CRFN
7. On rejection: route to Exception Triage Agent

**LLM use:** Claude Sonnet 4.6 for routine prep; Opus 4.7 for rejection-reason diagnosis.

### 9.9 Agent: Borrower Comms Agent

**Trigger:** Deal status changes, document available, schedule change

**Steps:**

1. Detect change worth communicating
2. Generate borrower-facing message via Claude Sonnet 4.6 in plain language
3. Route via borrower's preferred channel (email default; SMS opt-in; portal notification)
4. On reply: parse, classify, route to processor or appropriate agent

**Compliance:** TCPA opt-in required for SMS/voice. Borrower portal is opt-out neutral.

### 9.10 Agent: Internal Comms Agent

**Trigger:** Various — exceptions, ready-for-review, awaiting-input

**Steps:**

1. Identify which human(s) need to be notified
2. Choose channel (Slack DM, Teams chat, email, calendar invite)
3. Generate message
4. Send and track read/reply

**LLM use:** Claude Haiku 4.5 for short messages — speed > quality.

### 9.11 Agent: Exception Triage Agent

**Trigger:** Any other agent escalates an exception

**Steps:**

1. Classify exception (chain break | lost note | servicer non-cooperation | rejected recording | borrower lapse | other)
2. Determine severity (low | medium | high | blocking)
3. Route to human queue with proposed remediation
4. Track resolution

**LLM use:** Claude Opus 4.7 for diagnostic reasoning.

---

## 10. Layer 4 — Autonomous Voice Agent (Phase 3)

### 10.1 Purpose

Replace the single largest dead-time activity in a loan processor's day: calling prior servicers' CEMA departments and waiting on hold.

### 10.2 Architecture

```
       Outbound call needed
                │
                ▼
    ┌─────────────────────┐
    │ Twilio Voice (TLS)  │ ← STIR/SHAKEN attestation
    └──────────┬──────────┘
               │ media stream
               ▼
    ┌─────────────────────┐
    │ Deepgram Nova-3     │ ← Real-time STT
    │ (streaming)         │
    └──────────┬──────────┘
               │ transcript chunks
               ▼
    ┌─────────────────────┐
    │ Agent orchestrator  │ ← per-servicer playbook
    │ (Vercel Functions)  │   Claude Opus 4.7 / Sonnet 4.6
    └──────────┬──────────┘
               │ response text + tool calls
               ▼
    ┌─────────────────────┐
    │ ElevenLabs Conv. AI │ ← TTS
    └──────────┬──────────┘
               │ audio
               ▼
       Back to Twilio media stream

Side effects: communication record updated in real-time, observable in UI
```

### 10.3 Decision: Buy vs. Build

**Phase 3 launch: Buy.** Lead vendor: Conduit (or Salient). Reasoning:

- Voice infra is commodity
- Per-servicer playbooks are the moat — we provide those, vendor provides telephony+STT+TTS+turn-taking
- 8–10 week build vs. 6 months DIY

**Phase 4 (optimization): Build.** Once playbook volume justifies, migrate to direct ElevenLabs + Deepgram + Twilio with custom turn-taking. Lower per-minute cost; full control over voice cloning, multilingual support, regional accent handling.

### 10.4 Compliance for Voice Agent

- **STIR/SHAKEN A-attestation** on every outbound call (Twilio handles natively)
- **Caller-ID branding** via First Orion CNAM (the call appears as "ACME Lender CEMA Dept", not as spam)
- **DNC scrubbing** via Gryphon Networks (servicer-to-servicer calls are B2B and generally outside TCPA but cell-carrier spam-flag risk is real)
- **Recording disclosure** in opening greeting ("This call may be recorded for quality and compliance")
- **Human handoff escalation** triggered by: low LLM confidence (<0.7), rep request for human, conversation longer than 8 minutes, novel response not in playbook

### 10.5 Per-Servicer Playbook Structure

```
Playbook (per Servicer)
  ├── opening_script (greeting + verbal authentication if required)
  ├── intent_options[]
  │     ├── "Request CEMA package status"
  │     ├── "Submit CEMA request packet"
  │     ├── "Escalate to supervisor"
  │     └── "Request callback"
  ├── phone_tree_map (DTMF + voice routing)
  │     ├── "If they ask for loan number → reply with deal.existing_loan.servicer_loan_id"
  │     ├── "If they ask for borrower SSN last 4 → reply with deal.borrower.ssn_last4"
  │     └── …
  ├── expected_responses[]
  │     ├── "Package will arrive in X days"
  │     ├── "Cannot locate the loan"
  │     ├── "Need authorization re-faxed"
  │     └── "Speak to a manager"
  ├── failure_modes[]
  └── handoff_triggers[]
```

Playbooks are built deal-by-deal in Phase 1–2 (humans on calls + AI-summarized notes) and operationalized in Phase 3.

---

## 11. Phased Rollout & Roadmap

| Phase                              | Months | Scope                                                                                                                                                                                                                                                                  | Acceptance criteria                                                                                                                             |
| ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Foundation**                 | 1–5    | Layer 1 (Deal entity, auth, multi-tenancy, attorney review) + Layer 2 (telephony for top-5 PBX + work-cell softphone, email unified, Slack+Teams, Calendar Google+M365, file storage for Drive/OneDrive/Box, contact graph, deadline engine, search/memory)            | A loan processor can use the workspace daily for non-CEMA work and find value. Every call, email, file, and meeting is captured and searchable. |
| **1 — Refi-CEMA Agent Layer**      | 6–9    | Intake Agent, Servicer Outreach Agent (email only, no voice yet), Collateral IDP Agent, Chain-of-Title Agent, Borrower Comms Agent, Internal Comms Agent, Exception Triage Agent — for Refi-CEMA only. LOS integration: Encompass primary, LendingPad secondary.       | One real Refi-CEMA processed end-to-end with attorney review, no human processor intervention except exception handling.                        |
| **2 — Documents & Recording**      | 10–13  | Document Generation Agent (Form 3172 + all exhibits + §255/§275 + gap docs + AOM + allonge), Recording Prep Agent (MT-15, ACRIS, county cover sheets), Simplifile + ACRIS direct e-recording. Title platform integration: Qualia primary. DocMagic for doc generation. | One CEMA recorded end-to-end. Reel/page/CRFN captured in deal record.                                                                           |
| **2.5 — Purchase CEMA**            | 13–15  | Purchase CEMA workflows (seller cooperation, transfer tax forms, dual-attorney flow, MLS data integration).                                                                                                                                                            | One Purchase CEMA recorded end-to-end.                                                                                                          |
| **3 — Voice Agent**                | 16–19  | Buy-based voice agent (Conduit or Salient). Per-servicer playbooks for top 20 NY-active servicers. Caller-ID branding via First Orion. STIR/SHAKEN compliance.                                                                                                         | Voice agent successfully completes 50% of routine servicer status calls without human intervention.                                             |
| **4+ — LOS expansion + sub-types** | 20–24  | MeridianLink and Calyx integrations. Wholesale-broker mode. Sub-type onboarding flows for Regional, Community, and Wholesale.                                                                                                                                          | Two additional lender sub-types signed and live.                                                                                                |

### 11.1 Phase 0 Detail (the biggest single phase)

Phase 0 is ~5 months because Layer 2 is large. Sub-milestones:

| Month | Sub-milestone                                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Multi-tenant scaffold; Neon Postgres + Drizzle; Clerk auth; Deal entity schema; basic UI shell (Next.js 16 App Router)                                                                                  |
| 2     | Telephony: RingCentral + Dialpad + Zoom Phone APIs integrated; Twilio Voice for outbound (no agent yet); call recording in Vercel Blob; Deepgram batch transcription                                    |
| 3     | Email + Calendar: Nylas integration for Microsoft 365 + Google; unified inbox UI; thread parsing; attachment auto-classification via Reducto                                                            |
| 4     | Internal messaging + Files: Slack + Teams integration; Drive/OneDrive/Box integration; eSignature (DocuSign); contact graph entity resolution                                                           |
| 5     | Search + Memory: Typesense full-text; pgvector + Turbopuffer; Apache AGE knowledge graph; Mem0 memory layer; "Ask anything" search UI; attorney review workflow; SOC 2 compliance scaffolding via Vanta |

---

## 12. Cross-Cutting Concerns

### 12.1 Security

- All PII encrypted at rest (Postgres pgcrypto)
- All blobs encrypted with envelope encryption; customer-managed keys in Phase 2
- TLS 1.3 everywhere; HSTS headers
- Secrets in Vercel encrypted environment variables (Phase 2: HashiCorp Vault or AWS Secrets Manager for customer-managed keys)
- Vercel Firewall enabled; bot protection on auth surfaces
- Rate limiting via Upstash on all public-facing endpoints
- Penetration testing annual; bug bounty post-SOC 2

### 12.2 Compliance

- **SOC 2 Type II** within 12 months — Vanta automation
- **Mortgage industry compliance:** TRID, Reg Z, Reg X, Reg B, MAP, NY DFS regulations — design constraints, not features
- **GLBA Safeguards Rule** — applies because we handle borrower financial info
- **CCPA / CPRA** — DSR support via OneTrust (Phase 2)
- **Recording compliance:** Two-party consent enforced. Beep tone configurable.
- **TCPA / CFPB** for any borrower-facing voice/SMS — opt-in flow required

### 12.3 Observability

- **App-level:** Sentry for errors; Vercel Observability for traces; OpenTelemetry-compatible
- **LLM-level:** Braintrust for agent run tracing, evals, regressions
- **Business-level:** PostHog for product analytics; custom dashboards for deal throughput, SLA breach rate, exception rate per servicer

### 12.4 Performance Targets

- p95 page load < 1.5s (Vercel Speed Insights)
- p95 search query < 200ms
- p95 LLM call < 4s (most workflows are async, so this is for chat surfaces)
- 99.9% uptime (Vercel SLA-aligned)
- Workflow durability: zero-loss across deploys (WDK guarantee)

### 12.5 Cost Model (rough)

For 1,000 deals/year at one client:

| Line item                                    | Estimate                                            |
| -------------------------------------------- | --------------------------------------------------- |
| Infrastructure (Vercel, Neon, Upstash, Blob) | $2k–5k/mo                                           |
| LLM (Anthropic + OpenAI via Gateway)         | $1.5k–4k/mo (will be material; tracked obsessively) |
| Voice (Twilio, Deepgram, ElevenLabs)         | $1k–3k/mo (after Phase 3)                           |
| IDP (Reducto, Textract, Vaultedge)           | $0.5k–2k/mo                                         |
| Auth + Misc SaaS (Clerk, Sentry, etc.)       | $1k–2k/mo                                           |
| **Total OpEx/mo**                            | **$6k–16k/mo**                                      |
| **Annualized**                               | **$72k–192k/yr**                                    |
| Replaced FTE cost                            | $200k–400k/yr (2–3 processors fully loaded)         |
| **Net savings to client**                    | **$50k–250k/yr**                                    |

### 12.6 Pricing Model (proposed)

- **Annual platform fee:** $50k–150k depending on sub-type, anchored to "less than one FTE"
- **Per-deal usage fee:** $25–75 per CEMA closed, capped at platform-fee equivalent of 2 FTEs replaced
- Net revenue per client target: $150k–400k ARR

---

## 13. Risks & Open Questions

### 13.1 No Design Partner Identified ⚠️ HIGHEST RISK

**Risk:** Without a real lender's CEMA volume to train against, requirements drift from real-world need. Layer 3 agents need real prior-servicer interactions to learn from; without a flow of real deals, the playbook library never accumulates.

**Mitigation:**

- Phase 0 (workspace) is useful to any loan processor regardless of CEMA volume — generic loan processor productivity = our hedge
- Pursue 1–2 design partners during Phase 0 development; prefer mid-size IMBs with 500+ NY CEMAs/yr
- Offer Phase 0 at materially discounted pricing in exchange for direct access to processors and willingness to share anonymized closing data
- Pre-launch outreach: Better.com (consumer Refi-CEMA volume), Quontic (NY-focused), regional IMBs with NY desks

### 13.2 UPL Exposure

**Risk:** Drafting Form 3172 / §255 / §275 / AOM / allonge without an attorney's signature is plausibly unauthorized practice of law in NY.

**Mitigation:**

- Attorney-supervised model from day one — every legal document carries a required attorney-review gate
- Bar opinion from NY bar counsel before Phase 2 ships
- Insurance: E&O policy specifically covering legal-tech UPL claims

### 13.3 Servicer Cooperation Variance

**Risk:** Some servicers are notoriously slow or uncooperative (Mr. Cooper, RoundPoint historically). The "20-30 business day" estimate is an average; tail risk is 60+ days. AI agent doesn't change the servicer's pace.

**Mitigation:**

- SLA dashboards make this visible to operators
- Escalation playbook: bank-level relationship pressure when SLA breached
- "CEMA-decline" path: convert to non-CEMA refi if servicer fails to respond in 45 days

### 13.4 ACRIS API Stability

**Risk:** NYC ACRIS doesn't expose a fully open submit API. We rely on Simplifile for recording, and on browser automation against E-Tax for cover-page generation in some cases.

**Mitigation:**

- Simplifile for recording rails
- Sandboxed browser automation (via Vercel Sandbox) for E-Tax — with fallback to manual upload by human operator
- ACRIS Open Data is stable for read-only mortgage chain discovery

### 13.5 Voice Agent Reception at Servicer CEMA Desks

**Risk:** Major servicer CEMA departments may refuse to accept AI-driven calls or escalate them as suspect. Unverified.

**Mitigation:**

- Pilot Phase 3 with cooperative servicers first (servicers we have business relationships with)
- Caller-ID branding establishes legitimacy
- Falls back to human handoff on confusion

### 13.6 Multi-LOS Integration Complexity

**Risk:** Encompass, LendingPad, MeridianLink, and Calyx all have different data models, auth flows, API maturity. v1 commitment to all four is engineering-heavy.

**Mitigation:**

- Encompass is the must-have; ship Phase 0 + Phase 1 with Encompass-only, add others in Phase 4
- Abstract LOS interface via a `LosAdapter` interface so each implementation is isolated

### 13.7 Data Volume / LLM Cost

**Risk:** Layer 2 captures every call transcript, every email body, every file — that's millions of tokens of embeddings and storage per deal-year.

**Mitigation:**

- Tiered storage: hot for current 90 days, warm for 12 months, cold for legal retention
- Embedding cache deduplication
- AI Gateway routing to cheapest capable model per task

### 13.8 Insurance, Bonding, E&O

- Lenders require E&O coverage on vendors handling loan files
- $2M+ E&O policy needed before first production
- Add to GTM checklist

---

## 14. Success Metrics

### 14.1 Engineering Metrics

| Metric                                                                                        | Target by Phase 3 end                          |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| % of deals processed end-to-end with no human-processor intervention except attorney sign-off | ≥ 60%                                          |
| Average deal time (intake → recording)                                                        | ≤ 45 days (down from ~75)                      |
| Servicer outreach automation rate                                                             | ≥ 90% of touches                               |
| IDP extraction accuracy                                                                       | ≥ 95% on top-15 doc kinds                      |
| Chain-of-title break detection rate                                                           | ≥ 98% of true breaks; ≤ 5% false-positive rate |
| Recording rejection rate                                                                      | ≤ 5% (industry avg ~10%)                       |
| SLA breach rate (own SLA on internal steps)                                                   | ≤ 5%                                           |

### 14.2 Business Metrics

| Metric                              | Target by Phase 3 end           |
| ----------------------------------- | ------------------------------- |
| Net FTE savings per deployed lender | 2–3 processors                  |
| ARR per signed lender               | $150k–400k                      |
| Lender retention (NRR)              | ≥ 110%                          |
| Gross margin                        | ≥ 75% (after LLM + infra costs) |

### 14.3 Moat Metrics

| Metric                                | Target                 |
| ------------------------------------- | ---------------------- |
| Servicers covered in playbook library | 30+                    |
| Playbook success rate (per servicer)  | ≥ 75%                  |
| Deal data accumulated for training    | 1,000+ closed deals/yr |
| Patents filed (defensive)             | 2–3                    |

---

## 15. Out of Scope (Explicitly)

| What                                   | Why                          |
| -------------------------------------- | ---------------------------- |
| Multi-state expansion                  | NY-only is the moat          |
| Co-op share loan workflow              | Different instrument (UCC-1) |
| Borrower-facing standalone calculator  | Lender-branded only          |
| Replacing the LOS                      | We integrate                 |
| Replacing DocMagic                     | We integrate                 |
| Replacing Qualia / SoftPro             | We integrate                 |
| Personal-mobile native call recording  | Legally fraught              |
| Generic mortgage processing (non-CEMA) | Wrong product                |
| VA loans                               | Not eligible for CEMA        |
| FHA loans                              | Phase 2.5 at earliest        |

---

## 16. Appendix — Integration Catalog (the full universe)

This catalog is the working list of every external system the product integrates with. v1 must-haves marked ✓. Phased items marked with the target phase.

### A. Identity / KYC / Risk

- Persona ✓
- Socure (alternative)
- LexisNexis InstantID
- OFAC SDN list ✓
- FinCEN 314(a)

### B. Credit / Income / Asset

- Credit Plus or Avantus (soft pull) ✓
- Truework (4506-C automation) ✓
- The Work Number (Equifax)
- Plaid (assets + identity) ✓
- Finicity, Yodlee, MX

### C. Property / Title Data

- NYC ACRIS Open Data ✓ ⭐
- ATTOM Data ✓
- First American DataTree
- CoreLogic
- Black Knight Property Insights
- Zillow API (Purchase CEMA comps) — Phase 2.5

### D. LOS Integration

- ICE Encompass (Developer Connect, SDK, Web Service) ✓
- LendingPad — Phase 1.5
- MeridianLink Mortgage Director — Phase 2
- Calyx Path — Phase 2
- Vesta — Phase 2 (optional)
- MISMO XML ✓

### E. Title Production

- Qualia (Qualia Connect) ✓
- SoftPro 360 — Phase 2
- ResWare — Phase 2
- RamQuest — Phase 2
- TitlePoint — Phase 2

### F. Document Generation

- DocMagic (Form 3172 + library) ✓
- IDS / Mortgage Cadence — Phase 2
- Asurity RegCheck (compliance) — Phase 2

### G. IDP

- Reducto ✓
- Amazon Textract Lending API ✓
- Vaultedge ✓ (mortgage-tuned)
- Docsumo — Phase 2
- DocVu.AI — Phase 2
- Hyperscience — Phase 4
- ABBYY Vantage — Phase 4

### H. AI/LLM

- Vercel AI Gateway ✓ (routing)
- Anthropic Claude Opus 4.7, Sonnet 4.6, Haiku 4.5 ✓
- OpenAI GPT-5, o-series ✓
- Google Gemini 2.5 Pro — Phase 1
- Cohere Embed v4 ✓
- OpenAI text-embedding-3-large ✓

### I. Telephony / Voice

- RingCentral ✓
- Dialpad ✓
- Zoom Phone ✓
- Microsoft Teams Phone ✓
- 8x8 — Phase 1.5
- Vonage Business — Phase 1.5
- GoTo Connect — Phase 2
- Nextiva — Phase 2
- OpenPhone — Phase 2
- Aircall — Phase 1.5
- JustCall — Phase 2
- Twilio Voice (Phase 3 voice agent) ✓
- Telnyx (fallback) — Phase 3
- CallCabinet (compliance recording vault) ✓
- First Orion CNAM (caller-ID branding) — Phase 3
- Gryphon Networks (TCPA scrubbing) — Phase 3

### J. STT / TTS

- Deepgram Nova-3 ✓
- Whisper Large v3 (batch) ✓
- ElevenLabs Conversational AI — Phase 3
- ElevenLabs TTS — Phase 3
- AssemblyAI (alternative)
- Cartesia (alternative)

### K. Email

- Nylas (unified Gmail + M365) ✓
- Microsoft Graph API ✓
- Google Workspace API ✓
- Resend (outbound transactional) ✓
- NeverBounce (verification) ✓

### L. Messaging

- Slack API ✓
- Microsoft Teams (Bot Framework + Graph) ✓
- Twilio SMS ✓
- WhatsApp Business API — Phase 1.5

### M. Calendar / Scheduling

- Nylas Calendar ✓
- Cal.com ✓
- Calendly (alternative)
- Chili Piper — Phase 2

### N. Files & Storage

- Google Drive ✓
- Microsoft OneDrive / SharePoint ✓
- Dropbox Business ✓
- Box ✓
- Egnyte — Phase 1.5
- NetDocuments — Phase 2
- iManage Work — Phase 2

### O. eSignature & Notarization

- DocuSign ✓
- Adobe Acrobat Sign — Phase 1.5
- PandaDoc — Phase 2
- SignNow — Phase 2
- Snapdocs — Phase 2
- Pavaso (RON) ✓
- Stavvy (RON alternative)

### P. CRM

- Salesforce (via Merge.dev) ✓
- HubSpot (via Merge.dev) ✓
- Total Expert ✓
- Velocify (ICE) — Phase 2
- Surefire (ICE) — Phase 2
- BNTouch — Phase 2

### Q. Contact Enrichment

- Clay ✓
- Apollo (alternative)
- ZoomInfo — Phase 2 (enterprise upsell)

### R. Task / PM (read-only mirror)

- Asana ✓
- Monday ✓
- ClickUp ✓
- Linear ✓
- Notion ✓
- Smartsheet ✓

### S. Recording Rails

- Simplifile ✓
- CSC eRecording (fallback) — Phase 2
- ePN (fallback) — Phase 2
- NYC ACRIS direct (via Simplifile) ✓

### T. Document Custody

- Iron Mountain ✓
- Deutsche Bank — Phase 2
- US Bank — Phase 2
- Wells Fargo Doc Custody — Phase 2

### U. Public Data

- NYC ACRIS Open Data ✓ ⭐
- MERS Servicer ID Lookup ✓
- NYS DOS UCC database — Phase 2.5
- NYS Court WebCivil — Phase 2
- HMDA Platform (CFPB) — Phase 2

### V. Auth / SSO

- Clerk ✓
- WorkOS (SAML SSO + SCIM) ✓
- Microsoft Entra ID (via WorkOS)
- Okta (via WorkOS)

### W. Database & Storage

- Neon Postgres ✓
- pgvector ✓
- Turbopuffer ✓
- Apache AGE ✓
- Vercel Blob ✓
- Upstash Redis ✓
- ClickHouse — Phase 2 (analytics warehouse)

### X. Compute & Workflow

- Vercel Functions (Fluid Compute) ✓
- Vercel Workflow DevKit ✓
- Vercel Queues ✓
- Vercel Cron ✓
- Vercel Sandbox ✓
- Inngest (fallback / additional) ✓
- Trigger.dev (alternative)

### Y. Observability

- Sentry ✓
- Vercel Observability ✓
- OpenTelemetry ✓
- Braintrust (LLM evals) ✓
- Langfuse (alternative)

### Z. Product / Analytics

- PostHog ✓
- Vercel Web Analytics ✓
- Vercel Speed Insights ✓

### AA. Notifications

- Knock ✓
- Pusher Beams (mobile push) — Phase 2
- OneSignal (alternative)

### BB. Billing / Customer Mgmt

- Stripe Billing ✓
- Metronome (usage-based) ✓
- Plain (B2B support) ✓

### CC. Compliance

- Vanta (SOC 2) ✓
- OneTrust (DSR) — Phase 2
- Drata (alternative)

### DD. Feature Flags

- Vercel Flags SDK ✓
- PostHog Feature Flags ✓
- LaunchDarkly (alternative)

### EE. Mortgage Public Forms

- NY DTF MT-15, MT-15.1, NYS-261 ✓
- ACRIS Recording & Endorsement, Tax Return, Supporting Documents, Payment Cover Pages ✓
- Nassau Tax Lot Verification Letter ✓
- Suffolk Mortgage Verification Fee ✓
- Westchester county clerk forms ✓
- ALTA 11.1-06, 11.2-06 endorsements ✓
- Each upstate county clerk — Phase 1.5

---

## 17. Decisions Locked

| Decision                                 | Value                                                                                                                                  | Locked at  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Approach                                 | Option B — End-to-End AI Processor                                                                                                     | 2026-05-12 |
| Primary buyer                            | Lender                                                                                                                                 | 2026-05-12 |
| FTE being replaced                       | Loan Processor                                                                                                                         | 2026-05-12 |
| Lender sub-types — architectural support | All 4 from day 1 (IMB, Regional, Community/CU, Wholesale) — via LosAdapter interface, multi-tenant scaffolding, sub-type-aware billing | 2026-05-12 |
| Lender sub-types — go-to-market sequence | Encompass (Phase 0–1, covers IMB + most Regional) → LendingPad (Phase 1.5, covers Community/CU) → MeridianLink + Calyx (Phase 4)       | 2026-05-12 |
| CEMA types in v1                         | Both Refi + Purchase                                                                                                                   | 2026-05-12 |
| Geographic scope                         | NY only                                                                                                                                | 2026-05-12 |
| Personal-mobile scope                    | Excluded except via softphone app                                                                                                      | 2026-05-12 |
| Voice-AI strategy                        | Buy in Phase 3 (Conduit / Salient), reassess Phase 4                                                                                   | 2026-05-12 |
| UPL posture                              | Attorney-supervised lender tool                                                                                                        | 2026-05-12 |
| Foundation-first approach                | Layer 2 workspace before Layer 3 agents                                                                                                | 2026-05-12 |
| Tech stack                               | Vercel + Next.js 16 + Workflow DevKit + AI SDK + Neon + Drizzle + Anthropic-primary                                                    | 2026-05-12 |

---

## 18. Pending Decisions

| #   | Item                                                                                | Owner                | Needed by       |
| --- | ----------------------------------------------------------------------------------- | -------------------- | --------------- |
| 1   | Identify 1–2 design-partner lenders                                                 | Connor               | Phase 0 month 3 |
| 2   | NY bar opinion on UPL posture                                                       | External counsel     | Phase 2 start   |
| 3   | E&O insurance broker engagement                                                     | Connor               | Phase 1 end     |
| 4   | Decision: build internal Servicer ID database vs. license MERS data feed            | Engineering          | Phase 1 start   |
| 5   | Decision: in-house attorney role vs. partner law firm of record                     | Connor + counsel     | Phase 1 end     |
| 6   | Branding: product name + domain                                                     | Connor               | Phase 0 end     |
| 7   | Decision: Phase-3 voice agent vendor (Conduit vs. Salient vs. Marr Labs vs. Retell) | Engineering + Connor | Phase 2 end     |

---

## 19. Next Step

Once this spec is approved by the user (Connor), the next step is to invoke the `superpowers:writing-plans` skill to produce a detailed implementation plan for Phase 0 (months 1–5). The implementation plan will:

- Break Phase 0 into 2-week iterations
- Define week-by-week deliverables
- Identify the critical path
- Surface technical risks per work-item
- Specify the day-1 repo structure (monorepo, packages, apps)
- List immediate hires and contractor needs
- Estimate Phase 0 budget
- Bootstrap the GitHub repository and CI/CD pipeline per §20
- Initialize Vercel projects via the `vercel:bootstrap` skill

The implementation plan is _not_ an architecture document. This spec is the architecture document. The implementation plan is the build sequence.

---

## 20. Development Workflow, GitHub, and CI/CD

This section specifies the repository, branching, commit, PR, and automation strategy. All of it is provisioned during the Phase 0 month-1 work-stream.

### 20.1 Repository

| Item                | Value                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| **GitHub org**      | `connorbhickey` (per global CLAUDE.md)                                   |
| **Repo name**       | `Project_CEMA` (matches local folder exactly)                            |
| **Visibility**      | Private until launch; private-with-NDA for design partners; never public |
| **License**         | Proprietary (placeholder LICENSE file declares all-rights-reserved)      |
| **Default branch**  | `main`                                                                   |
| **Topology**        | Single monorepo (Turborepo) with `apps/*` and `packages/*`               |
| **Package manager** | pnpm via Corepack                                                        |
| **Node version**    | Pinned in `.nvmrc` and `package.json` engines                            |

**Creation command** (run during Phase 0 month 1):

```bash
gh repo create connorbhickey/Project_CEMA --private --source=. --remote=origin --push
```

### 20.2 Branch Strategy

- **Trunk-based.** `main` is always deployable; preview deploys per PR substitute for long-lived `develop` / `staging` branches.
- **Branch naming:** `feat/<scope>`, `fix/<scope>`, `chore/<scope>`, `docs/<scope>`, `refactor/<scope>`, `test/<scope>`, `perf/<scope>`, `ci/<scope>`. The `<scope>` matches the affected package or app (e.g., `feat/agents-servicer-outreach`).
- **PR scope:** small, single-purpose. Aim for ≤ 400 LOC diff. Larger changes get split.
- **Branch lifetime:** ≤ 5 business days. Stale branches auto-flagged.

### 20.3 Commit Convention

- **Conventional Commits** enforced via `@commitlint/cli` + `@commitlint/config-conventional`. Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`.
- **Signed commits required.** GPG or SSH signing. Unsigned commits rejected by branch protection.
- **DCO sign-off** not required (proprietary).
- **Format:** `<type>(<scope>): <subject>` with optional body and footer. Example:

  ```
  feat(agents/servicer-outreach): add Mr. Cooper fax fallback path

  Mr. Cooper rejects email submissions on ~30% of CEMA requests
  per playbook v0.3. Add programmatic fax via Twilio with retry
  on transient failures.

  Closes #142
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

### 20.4 PR Workflow

| Element                        | Detail                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Template**                   | `.github/pull_request_template.md` with Summary, Test Plan, Screenshots, Breaking Changes, Migration Notes, Compliance Checklist |
| **Required reviewers**         | 1 human (CODEOWNERS-routed) + 1 AI reviewer (CodeRabbit by default; Greptile alternate)                                          |
| **Required status checks**     | See §20.7 — must all pass                                                                                                        |
| **Squash-and-merge default**   | PR title becomes the commit message                                                                                              |
| **Auto-delete branch**         | Enabled after merge                                                                                                              |
| **Linear history**             | Enforced on `main`                                                                                                               |
| **Up-to-date branch required** | Enabled before merge                                                                                                             |
| **Conversation resolution**    | All review threads must resolve before merge                                                                                     |

### 20.5 Auto-Merge

Auto-merge is enabled when **all** of the following are true:

1. All required status checks pass
2. ≥ 1 CODEOWNERS approval (or Dependabot/Renovate-authored)
3. PR has the `auto-merge` label OR is from a bot identity (`dependabot[bot]`, `renovate[bot]`)
4. No unresolved review comments

Merge method: squash. Branch deleted on merge.

### 20.6 Dependency Auto-Updates

**Renovate** preferred over Dependabot for monorepo grouping:

| Update type          | Schedule | Auto-merge if tests pass |
| -------------------- | -------- | ------------------------ |
| Security patches     | Daily    | Yes                      |
| Patch versions       | Weekly   | Yes                      |
| Minor versions       | Weekly   | Yes (after smoke tests)  |
| Major versions       | Monthly  | No — human review        |
| Lockfile maintenance | Weekly   | Yes                      |

Group rules:

- All `@types/*` together
- All ESLint plugins together
- All Vercel SDKs together
- All Anthropic / OpenAI SDKs together
- Vercel AI SDK group separately

### 20.7 GitHub Actions Workflows

Workflows live in `.github/workflows/`. Each workflow uses GitHub Actions OIDC to authenticate to Vercel and cloud providers (no long-lived secrets).

| Workflow file           | Trigger                                                   | Purpose                                                                                        |
| ----------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ci.yml`                | PR + push to `main`                                       | Lint (ESLint + Prettier check), typecheck (`tsc --noEmit`), unit tests (Vitest), package build |
| `e2e.yml`               | PR (label-gated) + nightly cron                           | Playwright integration tests against preview deploy                                            |
| `db-migrate-check.yml`  | PR touching `packages/db/migrations`                      | Drizzle migration safety check; preview branch DB creation/apply                               |
| `security-scan.yml`     | PR + weekly cron                                          | CodeQL static analysis, Snyk vulnerability scan, GitGuardian secret scan                       |
| `llm-eval.yml`          | PR touching `packages/agents/**` or `packages/prompts/**` | Braintrust eval suite — agent quality regression gate                                          |
| `auto-format.yml`       | push to feature branch                                    | Auto-commits Prettier + ESLint --fix; bot-signed commit                                        |
| `auto-sync.yml`         | nightly cron                                              | Rebases stale feature branches against `main`                                                  |
| `auto-release.yml`      | push to `main`                                            | Generates release notes via changesets; tags release                                           |
| `stale.yml`             | weekly cron                                               | Flags stale PRs (≥ 5 days no activity) and issues                                              |
| `codeql.yml`            | PR + weekly                                               | CodeQL security analysis                                                                       |
| `dependency-review.yml` | PR                                                        | GitHub native dependency-review action                                                         |
| `license-check.yml`     | PR                                                        | Validates no GPL/AGPL transitive deps                                                          |
| `bundle-size.yml`       | PR touching `apps/web`                                    | Size-limit report posted as PR comment                                                         |

**Vercel deployments** are handled natively via the Vercel GitHub integration — no custom workflow needed. Preview deploys on every PR; production deploys on merge to `main`.

### 20.8 Pre-commit Hooks (Local)

Husky + lint-staged + commitlint:

| Hook                 | Action                                                                           |
| -------------------- | -------------------------------------------------------------------------------- |
| `pre-commit`         | Runs Prettier + ESLint --fix on staged files; runs typecheck on changed packages |
| `commit-msg`         | commitlint validates Conventional Commit format                                  |
| `pre-push`           | Runs the full unit-test suite for affected packages                              |
| `prepare-commit-msg` | Optionally prepends issue ID parsed from branch name                             |

### 20.9 Secrets & Environment Management

| Location                     | Use                             | Tooling                                                |
| ---------------------------- | ------------------------------- | ------------------------------------------------------ |
| `.env.local`                 | Local dev only                  | Gitignored; per-dev secrets                            |
| `.env.example`               | Template committed to repo      | Documents required vars; no real values                |
| GitHub Actions Secrets       | CI-only secrets per environment | Scoped to `development`, `preview`, `production`       |
| Vercel Environment Variables | Runtime                         | Linked to git environments; OIDC-bound where supported |
| HashiCorp Vault (Phase 2)    | Customer-managed key escrow     | For high-sensitivity tenants                           |
| GitGuardian                  | Secret-scan on every push       | Slack alert on detection                               |

**Never commit:** `.env*` (except `.env.example`), `*.pem`, `*.key`, `*credentials*`, `*secret*`, `*token*`. Enforced via `.gitignore` + pre-commit hook + GitGuardian.

### 20.10 CODEOWNERS

`.github/CODEOWNERS` routes review requests:

```
# Global owner — fallback
*                              @connorbhickey

# Apps
/apps/web/                     @connorbhickey
/apps/api/                     @connorbhickey
/apps/admin/                   @connorbhickey

# Domain packages
/packages/agents/              @connorbhickey
/packages/idp/                 @connorbhickey
/packages/doc-gen/             @connorbhickey
/packages/integrations/        @connorbhickey
/packages/db/                  @connorbhickey

# Infrastructure
/infrastructure/               @connorbhickey
/.github/                      @connorbhickey
/.changeset/                   @connorbhickey

# Compliance & security
SECURITY.md                    @connorbhickey
LICENSE                        @connorbhickey
/docs/compliance/              @connorbhickey

# Specs & research
/docs/superpowers/             @connorbhickey
/docs/research/                @connorbhickey

# AI agent configuration
CLAUDE.md                      @connorbhickey
/.cursorrules                  @connorbhickey
```

### 20.11 Issue & PR Templates

**Issue templates** under `.github/ISSUE_TEMPLATE/`:

- `bug_report.yml` — repro steps, expected vs. actual, environment, severity
- `feature_request.yml` — problem statement, proposed solution, alternatives
- `security_disclosure.yml` — coordinated disclosure (also routes to `SECURITY.md`)
- `compliance_issue.yml` — UPL, TCPA, PII, audit concerns
- `playbook_update.yml` — servicer playbook revision

**PR template** (`.github/pull_request_template.md`):

```markdown
## Summary

<one-sentence purpose>

## Changes

- bullet list

## Test plan

- [ ] Unit tests for new logic
- [ ] Integration tests if cross-package
- [ ] Manual verification steps

## Compliance checklist

- [ ] No PII in logs
- [ ] No bypass of attorney-review gate
- [ ] TCPA-relevant changes reviewed
- [ ] Audit trail unchanged or extended (never weakened)

## Screenshots / Demos (UI changes only)

<images / loom>

## Breaking changes

- [ ] None
- [ ] Yes — migration notes below

## Migration notes (if any)

<details>
```

### 20.12 Repository Hygiene Files

Required at repo root from day 1:

| File                     | Purpose                                                 |
| ------------------------ | ------------------------------------------------------- |
| `README.md`              | Quickstart, links to spec/research, dev commands        |
| `CLAUDE.md`              | AI assistant instructions (see §20.13)                  |
| `CONTRIBUTING.md`        | Branch / commit / PR / review conventions               |
| `SECURITY.md`            | Responsible disclosure (security@<domain>)              |
| `LICENSE`                | Proprietary all-rights-reserved                         |
| `CODE_OF_CONDUCT.md`     | Internal conduct expectations                           |
| `.editorconfig`          | Cross-editor consistency                                |
| `.nvmrc`                 | Node version pin                                        |
| `.gitignore`             | Comprehensive (Node, Next.js, Vercel, IDE, OS, secrets) |
| `.gitattributes`         | Line-ending normalization, LFS hooks                    |
| `.prettierrc`            | Code formatting                                         |
| `.eslintrc.cjs`          | Lint rules                                              |
| `tsconfig.json`          | TS strict mode                                          |
| `turbo.json`             | Turborepo task graph                                    |
| `pnpm-workspace.yaml`    | Monorepo workspace                                      |
| `.changeset/config.json` | Release tooling                                         |
| `vercel.json`            | Vercel build config                                     |

### 20.13 CLAUDE.md (AI Assistant Instructions)

A repo-root `CLAUDE.md` instructs Claude Code (and any other AI coding assistant) on:

- Project identity & current phase
- Tech stack and conventions
- Repository structure and where things live
- Critical rules (never-dos)
- Common commands
- Skills to invoke proactively (Vercel, superpowers, brand)
- Compliance constraints
- Testing & deployment workflow
- Glossary of CEMA-domain terms

The CLAUDE.md is co-located with the repo and travels with the codebase. It is updated via the `claude-md-management:revise-claude-md` skill as the project evolves.

### 20.14 Branch Protection on `main`

| Setting                                  | Value               |
| ---------------------------------------- | ------------------- |
| Require PR before merging                | ✅                  |
| Require approvals                        | 1                   |
| Dismiss stale approvals on new commits   | ✅                  |
| Require review from CODEOWNERS           | ✅                  |
| Require signed commits                   | ✅                  |
| Require linear history                   | ✅                  |
| Require status checks to pass            | ✅ (list per §20.7) |
| Require branches to be up to date        | ✅                  |
| Require conversation resolution          | ✅                  |
| Restrict pushes (admin override allowed) | ✅                  |
| Restrict force pushes                    | ✅                  |
| Restrict deletions                       | ✅                  |

### 20.15 Release & Versioning

- Semantic versioning per package via **Changesets**
- Auto-release workflow on merge to `main`:
  - Reads `.changeset/*.md` files
  - Bumps versions
  - Generates release notes
  - Tags git
  - (Future) publishes to internal registry
- Production deploy: only from tagged release; promote from preview to prod via Vercel

### 20.16 Observability of the Pipeline Itself

- GitHub Actions metrics: workflow duration, success rate, p95 → exported to PostHog
- Failed-workflow Slack alerts via Knock
- Slow workflows (> 10 min) flagged weekly
- Dependency-update success rate tracked per Renovate group

### 20.17 Disaster Recovery for the Repo

- Daily GitHub repo backup via `gh-backup` to S3 (Phase 1+)
- Issue + PR + Wiki backup nightly
- Branch protection + 1-week recovery window on accidental deletion
- Vercel project export weekly

### 20.18 AI Assistant Skill Ecosystem (proactive invocation catalog)

This project is developed with significant AI assistance (Claude Opus 4.7 / Sonnet 4.6). To ensure consistent, high-quality output, the following free Claude Code plugins and skills MUST be invoked proactively at the appropriate moments. CLAUDE.md §9 contains the operational invocation table; this section documents the strategic _why_ per plugin and where each provides leverage.

#### 20.18.1 Superpowers plugin (process discipline)

| Skill                                        | Used during                   | Why it matters here                                      |
| -------------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| `superpowers:using-superpowers`              | Every session start           | Auto-loaded; bootstraps the skill discipline             |
| `superpowers:brainstorming`                  | Pre-spec phase                | Hard gate against jumping to code before design approved |
| `superpowers:writing-plans`                  | Post-spec, pre-implementation | Translates approved spec into TDD-disciplined task list  |
| `superpowers:executing-plans`                | Inline plan execution         | Batched execution with checkpoints                       |
| `superpowers:subagent-driven-development`    | Multi-task implementation     | Fresh subagent per task; protects main context           |
| `superpowers:dispatching-parallel-agents`    | Independent parallel work     | Research, multi-integration scaffolding                  |
| `superpowers:using-git-worktrees`            | Plan execution isolation      | Keeps risky implementation work out of main worktree     |
| `superpowers:test-driven-development`        | Every feature/bugfix          | Enforces failing-test-first; prevents drift              |
| `superpowers:systematic-debugging`           | Bug discovery                 | Reproduce → isolate → diagnose → fix loop                |
| `superpowers:verification-before-completion` | End of every task             | Prevents false "done" claims before commit               |
| `superpowers:requesting-code-review`         | Before merging                | Triggers structured review request                       |
| `superpowers:receiving-code-review`          | When review feedback arrives  | Disciplined feedback intake                              |
| `superpowers:finishing-a-development-branch` | Branch close-out              | Standardized merge / squash / cleanup                    |
| `superpowers:writing-skills`                 | If we author new skills       | For project-specific skill packs                         |

#### 20.18.2 Vercel plugin (platform-native guidance)

Already covered in CLAUDE.md §9. Every Next.js / Workflow DevKit / AI SDK / storage / cron / middleware change must invoke the corresponding Vercel skill _before_ writing code. The training-data-may-be-outdated risk for Vercel APIs is real — the skill loads current documentation references.

#### 20.18.3 Engineering plugin (operational rigor)

| Skill                           | Used during                                                    |
| ------------------------------- | -------------------------------------------------------------- |
| `engineering:architecture`      | Major architecture decisions → output is an ADR in `docs/adr/` |
| `engineering:system-design`     | Designing new subsystems within a phase                        |
| `engineering:testing-strategy`  | Designing test plans for new modules                           |
| `engineering:code-review`       | Before opening a PR (self-review)                              |
| `engineering:debug`             | Structured debugging session                                   |
| `engineering:documentation`     | Writing READMEs, runbooks, handbooks                           |
| `engineering:tech-debt`         | Quarterly debt audits                                          |
| `engineering:incident-response` | Production incident — triage, comms, postmortem                |
| `engineering:deploy-checklist`  | Pre-deploy verification                                        |
| `engineering:standup`           | Daily / weekly status                                          |

#### 20.18.4 Product management plugin

| Skill                                      | Used during                            |
| ------------------------------------------ | -------------------------------------- |
| `product-management:write-spec`            | Phase 1+ feature specs                 |
| `product-management:product-brainstorming` | Already used for v1                    |
| `product-management:sprint-planning`       | Phase 1+ sprint planning               |
| `product-management:roadmap-update`        | Quarterly roadmap                      |
| `product-management:metrics-review`        | Weekly/monthly KPI reviews             |
| `product-management:stakeholder-update`    | Investor / lender client updates       |
| `product-management:competitive-brief`     | Already used for v1; refresh quarterly |
| `product-management:synthesize-research`   | Distilling design-partner interviews   |

#### 20.18.5 Operations plugin

| Skill                            | Used during                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `operations:runbook`             | Document operational procedures (servicer escalation, recording rejection recovery) |
| `operations:process-doc`         | Formal SOPs (attorney-review workflow, exception triage)                            |
| `operations:risk-assessment`     | Vendor risk, deal risk                                                              |
| `operations:compliance-tracking` | SOC 2 evidence collection                                                           |
| `operations:vendor-review`       | Every one of the 50+ integrations needs vendor due-diligence                        |
| `operations:change-request`      | Production environment / infra changes                                              |
| `operations:status-report`       | Weekly leadership status                                                            |
| `operations:capacity-plan`       | When forecasting LLM cost, infra scale                                              |

#### 20.18.6 Legal plugin (mandatory for compliance posture)

| Skill                         | Used during                                                             |
| ----------------------------- | ----------------------------------------------------------------------- |
| `legal:compliance-check`      | Any code touching legal documents, voice/SMS to borrowers, or audit log |
| `legal:legal-risk-assessment` | UPL exposure decisions, TCPA risk decisions                             |
| `legal:triage-nda`            | Design-partner NDAs                                                     |
| `legal:review-contract`       | Vendor MSAs (Twilio, Anthropic, Neon, Clerk, DocMagic)                  |
| `legal:vendor-check`          | Existing vendor agreement status                                        |
| `legal:signature-request`     | E-signature workflows for internal docs                                 |
| `legal:meeting-briefing`      | Pre-counsel meetings                                                    |
| `legal:brief`                 | Daily / topic / incident legal briefings                                |

#### 20.18.7 Design + frontend plugins

| Skill                             | Used during                                            |
| --------------------------------- | ------------------------------------------------------ |
| `design:design-system`            | Building / extending shadcn-based design system        |
| `design:accessibility-review`     | WCAG 2.1 AA audits on processor UI                     |
| `design:design-critique`          | UI review before shipping                              |
| `design:ux-copy`                  | Empty states, error messages, borrower-facing language |
| `design:user-research`            | Design-partner interviews with loan processors         |
| `design:research-synthesis`       | Post-interview thematic synthesis                      |
| `design:design-handoff`           | Dev specs from designs                                 |
| `frontend-design:frontend-design` | Distinctive UI for processor workspace                 |

#### 20.18.8 Data + analytics plugins

| Skill                         | Used during                                                           |
| ----------------------------- | --------------------------------------------------------------------- |
| `data:sql-queries`            | All complex Postgres queries                                          |
| `data:write-query`            | Analytics queries on the warehouse                                    |
| `data:explore-data`           | ACRIS data exploration, HMDA, NY DTF data                             |
| `data:analyze`                | Ad-hoc data questions (servicer SLA distributions, deal-flow metrics) |
| `data:validate-data`          | QA an analysis before publishing                                      |
| `data:statistical-analysis`   | Distribution / outlier / trend analysis                               |
| `data:create-viz`             | Charts for internal dashboards                                        |
| `data:build-dashboard`        | Executive overview dashboards                                         |
| `data:data-visualization`     | All chart work                                                        |
| `data:data-context-extractor` | Distilling SME knowledge into queryable skills                        |

#### 20.18.9 PR review toolkit (free code-review agents)

| Skill / Agent                             | Used during                                          |
| ----------------------------------------- | ---------------------------------------------------- |
| `pr-review-toolkit:review-pr`             | Every non-trivial PR (orchestrates the agents below) |
| `pr-review-toolkit:code-reviewer`         | General-purpose review                               |
| `pr-review-toolkit:silent-failure-hunter` | After any try/catch or fallback change               |
| `pr-review-toolkit:type-design-analyzer`  | After new type or schema introduction                |
| `pr-review-toolkit:pr-test-analyzer`      | PRs with new functionality (test-coverage QA)        |
| `pr-review-toolkit:comment-analyzer`      | PRs adding documentation comments                    |
| `pr-review-toolkit:code-simplifier`       | After any logical chunk of new code                  |
| `coderabbit:code-review`                  | Automated AI review (also fires via GitHub workflow) |
| `code-review:code-review`                 | Free-standing slash command for ad-hoc reviews       |

#### 20.18.10 Commit commands

| Skill                            | Used during                                  |
| -------------------------------- | -------------------------------------------- |
| `commit-commands:commit`         | Every commit (enforces Conventional Commits) |
| `commit-commands:commit-push-pr` | Commit + push + open PR in one step          |
| `commit-commands:clean_gone`     | Periodic [gone] branch cleanup               |

#### 20.18.11 Anthropic skills (document & artifact handling)

| Skill                                    | Used during                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `anthropic-skills:pdf`                   | Any PDF input (collateral files, recorded mortgages, prior CEMAs, NYS-261, MT-15) — CORE to Phase 1 IDP work |
| `anthropic-skills:docx`                  | Word doc input (some lenders still use .docx CEMA templates)                                                 |
| `anthropic-skills:xlsx`                  | Spreadsheet input (processor pipelines, servicer playbooks, analytics)                                       |
| `anthropic-skills:pptx`                  | Investor / client presentations                                                                              |
| `anthropic-skills:mcp-builder`           | Building project-specific MCP servers (e.g., ACRIS MCP, Servicer Playbook MCP)                               |
| `anthropic-skills:skill-creator`         | Creating new project-specific skills                                                                         |
| `anthropic-skills:doc-coauthoring`       | Long-form internal docs                                                                                      |
| `anthropic-skills:web-artifacts-builder` | Internal admin UI prototypes                                                                                 |
| `anthropic-skills:theme-factory`         | Slide themes / report themes                                                                                 |
| `anthropic-skills:internal-comms`        | Team/company-wide announcements                                                                              |
| `anthropic-skills:brand-guidelines`      | When/if we adopt Anthropic-style brand surfaces                                                              |
| `anthropic-skills:consolidate-memory`    | Periodic memory audit                                                                                        |
| `anthropic-skills:schedule`              | Scheduled tasks beyond Vercel Cron                                                                           |

#### 20.18.12 Plugin development plugins

| Skill                            | Used during                                                     |
| -------------------------------- | --------------------------------------------------------------- |
| `plugin-dev:create-plugin`       | If we author Project_CEMA plugin extensions                     |
| `plugin-dev:skill-development`   | Project-specific skills (e.g., a CEMA-domain skill bundle)      |
| `plugin-dev:hook-development`    | Custom hooks (e.g., pre-commit PII scan)                        |
| `plugin-dev:command-development` | Custom slash commands (e.g., `/new-deal`, `/check-eligibility`) |
| `plugin-dev:agent-development`   | Custom subagents (e.g., a CEMA-specialist code reviewer)        |
| `plugin-dev:mcp-integration`     | Integrating MCP servers into the plugin                         |
| `plugin-dev:plugin-settings`     | Plugin configuration management                                 |
| `plugin-dev:plugin-structure`    | Plugin architecture guidance                                    |
| `skill-creator:skill-creator`    | Alternative skill-creator entry point                           |

#### 20.18.13 Hookify plugin (hook automation)

| Skill                   | Used during                                  |
| ----------------------- | -------------------------------------------- |
| `hookify:hookify`       | When we identify repeat behaviors to prevent |
| `hookify:writing-rules` | Authoring new hook rules                     |
| `hookify:configure`     | Enabling/disabling rules                     |
| `hookify:list`          | Auditing active rules                        |

Concrete first hooks we'll author:

- Pre-commit PII scan (block commits containing SSN-like patterns even if redactPii missed)
- Pre-push attorney-review-bypass detector (scan diff for code mutating Document.status to executed/recorded without an AttorneyApproval row)
- Pre-commit audit-log-skip detector (any DB mutation in `apps/web/lib/actions/` must call `emitAuditEvent` in the same function)

#### 20.18.14 Firecrawl plugin (web operations)

| Skill                     | Used during                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `firecrawl:firecrawl-cli` | Scraping public servicer CEMA-request guides, county clerk fee schedules, NY DTF guidance |
| `firecrawl:skill-gen`     | Auto-generating skills from servicer documentation                                        |

#### 20.18.15 Enterprise search plugin

| Skill                                   | Used during                                                              |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `enterprise-search:search`              | "Find that doc about Mr. Cooper's CEMA process" across connected sources |
| `enterprise-search:digest`              | Daily/weekly cross-system digest                                         |
| `enterprise-search:knowledge-synthesis` | Synthesizing multi-source answers with citations                         |
| `enterprise-search:search-strategy`     | Decomposing complex search queries                                       |
| `enterprise-search:source-management`   | Managing connected MCP sources                                           |

#### 20.18.16 Brand voice plugin (when we have brand identity)

| Skill                                 | Used during                           |
| ------------------------------------- | ------------------------------------- |
| `brand-voice:enforce-voice`           | Borrower-facing comms, marketing copy |
| `brand-voice:generate-guidelines`     | Initial brand voice guidelines        |
| `brand-voice:discover-brand`          | Pre-guideline brand asset discovery   |
| `brand-voice:brand-voice-enforcement` | Compliance check on outbound content  |
| `brand-voice:guideline-generation`    | Alternative entry point               |

#### 20.18.17 Marketing plugin (post-launch GTM)

| Skill                          | Used during                                         |
| ------------------------------ | --------------------------------------------------- |
| `marketing:competitive-brief`  | Refreshed quarterly                                 |
| `marketing:content-creation`   | Blog, case studies, white papers                    |
| `marketing:draft-content`      | Draft any single piece                              |
| `marketing:campaign-plan`      | Launch / phase-rollout campaigns                    |
| `marketing:email-sequence`     | Onboarding email sequences for new lender customers |
| `marketing:seo-audit`          | Marketing-site optimization                         |
| `marketing:brand-review`       | Brand compliance before publishing                  |
| `marketing:performance-report` | Marketing performance dashboards                    |

#### 20.18.18 Hugging Face skills (Phase 2+ — fine-tuning)

| Skill                                             | Used during                                                    |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `huggingface-skills:hf-cli`                       | Managing fine-tuning runs and datasets                         |
| `huggingface-skills:hugging-face-datasets`        | NY mortgage chain dataset curation                             |
| `huggingface-skills:hugging-face-model-trainer`   | Fine-tune Llama / Qwen on extracted-mortgage corpora (Phase 2) |
| `huggingface-skills:hugging-face-vision-trainer`  | Fine-tune vision models on NY mortgage scan images (Phase 2)   |
| `huggingface-skills:hugging-face-evaluation`      | Tracking fine-tune eval results                                |
| `huggingface-skills:transformers-js`              | In-browser ML for borrower portal niceties                     |
| `huggingface-skills:huggingface-gradio`           | Internal demo UIs                                              |
| `huggingface-skills:hugging-face-trackio`         | Experiment tracking                                            |
| `huggingface-skills:hugging-face-jobs`            | Running training jobs                                          |
| `huggingface-skills:hugging-face-tool-builder`    | Tool/agent assembly using HF                                   |
| `huggingface-skills:hugging-face-paper-publisher` | If we publish research                                         |

#### 20.18.19 Feature dev plugin

| Skill                     | Used during                                            |
| ------------------------- | ------------------------------------------------------ |
| `feature-dev:feature-dev` | Guided feature development with codebase understanding |

#### 20.18.20 Finance plugin (internal SOX / accounting)

| Skill                                                  | Used during                               |
| ------------------------------------------------------ | ----------------------------------------- |
| `finance:audit-support`                                | SOC 2 + future SOX                        |
| `finance:reconciliation`                               | Stripe + Metronome billing reconciliation |
| `finance:variance-analysis`                            | Budget vs. actual on LLM spend            |
| `finance:financial-statements`                         | Internal monthly statements               |
| `finance:close-management`                             | Month-end close                           |
| `finance:journal-entry` / `finance:journal-entry-prep` | Bookkeeping                               |
| `finance:sox-testing`                                  | Once SOX applies                          |

#### 20.18.21 Productivity plugin

| Skill                            | Used during                              |
| -------------------------------- | ---------------------------------------- |
| `productivity:task-management`   | Team-wide TASKS.md tracking              |
| `productivity:memory-management` | Shorthand / nickname / acronym decoding  |
| `productivity:update`            | Pulling new assignments + memory refresh |
| `productivity:start`             | First-time productivity setup            |

#### 20.18.22 Claude Code setup + management plugins

| Skill                                             | Used during                                   |
| ------------------------------------------------- | --------------------------------------------- |
| `claude-md-management:revise-claude-md`           | Every meaningful project shift                |
| `claude-md-management:claude-md-improver`         | Periodic CLAUDE.md audit                      |
| `claude-code-setup:claude-automation-recommender` | Periodic re-audit of automation opportunities |

#### 20.18.23 Figma plugin (if/when design moves to Figma)

| Skill                                    | Used during                                       |
| ---------------------------------------- | ------------------------------------------------- |
| `figma:figma-use`                        | Mandatory prerequisite for all Figma tool use     |
| `figma:figma-implement-design`           | Translating Figma → production code               |
| `figma:figma-generate-design`            | Generating Figma from spec / page                 |
| `figma:figma-generate-library`           | Building a Figma design system from this codebase |
| `figma:figma-code-connect-components`    | Mapping Figma components to code                  |
| `figma:figma-create-design-system-rules` | Codifying design rules                            |

#### 20.18.24 Playground plugin

| Skill                   | Used during                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `playground:playground` | Self-contained interactive explorers for parameter exploration (e.g., interactive CEMA savings calculator demo for sales) |

#### 20.18.25 Free MCP servers worth installing

In addition to the plugin skills above, install these MCP servers (from `.mcp.json` once authored, or via the Claude Code marketplace):

| MCP          | Purpose                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `context7`   | Up-to-date library docs (Next.js, Drizzle, Clerk, AI SDK) — critical because training data lags |
| `github`     | PR / issue / CI operations from inside Claude Code                                              |
| `playwright` | Browser automation for testing and ACRIS browser-automation paths                               |
| `serena`     | Semantic code analysis across the monorepo                                                      |
| `firecrawl`  | Web scraping for servicer documentation and county clerk pages                                  |
| `pinecone`   | Vector search ops (optional alongside pgvector)                                                 |

These give Claude direct tool access to live systems and enable many of the skills above to do their work autonomously.

#### 20.18.26 Subagent types worth invoking

| Subagent                                  | When to invoke                                                       |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `Explore`                                 | Codebase exploration > 3 grep/glob queries                           |
| `Plan`                                    | Complex implementation planning (alternative to writing-plans skill) |
| `general-purpose`                         | Multi-step research with web fetches                                 |
| `feature-dev:code-architect`              | Architecting new feature within existing patterns                    |
| `feature-dev:code-explorer`               | Deep analysis of existing feature                                    |
| `feature-dev:code-reviewer`               | High-confidence review filtering                                     |
| `pr-review-toolkit:code-reviewer`         | PR-time code review                                                  |
| `pr-review-toolkit:silent-failure-hunter` | Error handling review                                                |
| `pr-review-toolkit:type-design-analyzer`  | New types/schemas                                                    |
| `pr-review-toolkit:pr-test-analyzer`      | Test coverage audit                                                  |
| `superpowers:code-reviewer`               | Major step review against plan                                       |
| `coderabbit:code-reviewer`                | Specialized CodeRabbit analysis                                      |
| `claude-code-guide`                       | Questions about Claude Code itself, SDK, or API                      |

---

_End of design spec._
