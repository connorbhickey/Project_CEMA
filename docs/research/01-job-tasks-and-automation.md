# CEMA Mortgage Loan Processor: Job Tasks and Automation Mapping

**Author:** Research agent (Claude)
**Date:** 2026-05-12
**Scope:** New York State Consolidation, Extension, and Modification Agreement (CEMA) workflow, the human roles that execute it today, and the AI/automation capabilities that can compress or replace those roles.

## How to read this document

The "CEMA processor" job title is rare in public job-postings. Searches across Indeed, LinkedIn, ZipRecruiter, and Glassdoor surface dozens of generic "mortgage loan processor" or "closing coordinator" listings in NY that *include CEMA as one workflow* but no dedicated "CEMA processor" title (Indeed.com CEMA-jobs search returns only ~1 truly CEMA-mortgage listing nationally; the rest are unrelated — Connecticut Energy Marketers Association, Cyber & Electromagnetic Activities defense roles, etc.). This matches the operational reality: CEMA work is typically a *specialization within* a bank's "Loan Closing", "Closing Coordination", or "Lender Services" team at a closing-attorney firm, title company, or bank attorney shop. The 2–3 FTEs the client wants to displace are almost certainly doing one of three role-shapes:

1. **Bank-side / lender-side CEMA processor** — works at a wholesale or retail lender (or its outside counsel), drives the deal from rate-lock to recording on every NY loan that has tax-savings potential.
2. **Title-side CEMA coordinator** — at a title agent (e.g., a TIRSA-licensed agent operating in NY), handles the title commitment's mortgage schedule, the 255/275 affidavits, ACRIS/county clerk cover pages, and recording.
3. **Attorney-firm CEMA paralegal/processor** — at a closing-attorney firm on the "Approved CEMA Attorney List" of a national lender like Bank of America / Wells / Chase, handles document drafting and the assigning lender's counsel communication.

A small firm typically has one person wearing two of those hats. A national lender separates them. Sections 2 and 3 below describe both.

---

## 1. End-to-end CEMA deal lifecycle

The following lifecycle merges the procedural guides published by closing-attorney firms (Adam Leitman Bailey P.C., Andelsman Law, Skolnick & Ben-Ezra, Zimmet Law, Friedman Vartolo, Mosheslaw, Avenue365, Davis Team NYC, Hauseit), lender process flows (Nations Direct Mortgage, "The Lender" wholesale, Better Mortgage, RoundPoint servicing), the Freddie Mac NY CEMA chapter (Single-Family Seller/Servicer Guide § 4101.11), Fannie Mae's Selling Guide reference to Form 3172, and the American Association of Private Lenders (AAPL) primer.

The numbering reflects sequence-of-control, not strictly time order — some steps run in parallel.

### Stage A — Intake & Eligibility (Days 0–5)

1. **Application intake & flag for CEMA candidacy.** A loan officer or loan processor identifies that the subject property is in NY and the borrower has an existing first mortgage. At Better Mortgage, this step is automated — "your application is automatically converted into a CEMA" — and a Loan Officer is asked to confirm before rate-lock (Better.com, "CEMA New York"). At most lenders it is a manual checkbox in Encompass.
2. **Eligibility check.**
   - Property type allowed: 1–3 family house, condo unit, PUD. Excluded: **co-ops** (no real property, no mortgage to assign; collateral is shares + proprietary lease secured by UCC-1) — see Section 5 (NYS quirks).
   - Loan-program allowed: Conventional / Fannie / Freddie OK; **VA cannot do CEMA**; FHA can but rarely; jumbo varies by investor.
   - First-lien only; second liens almost always must be paid off, not assigned.
3. **Savings estimate / breakeven analysis.** Processor or LO computes:
   - Existing UPB × applicable NY mortgage recording tax rate (NYC: 1.8% under $500K / 1.925% ≥ $500K; Nassau/Suffolk/Westchester: 1.05%; most upstate: 0.75–1.05%) = tax that *would* be paid without CEMA on that portion.
   - Add'l fees: assigning lender CEMA fee (~$500–$2,000 per AAPL & DigsRealtyNYC), CEMA attorney fee ($400–$1,000), extra title charges, extra recording pages (~$5/page on a 35–45 page CEMA agreement per Avenue365). Net savings = gross tax avoided − incremental cost. Better publishes that average total CEMA fees are ~$2,000.
4. **Borrower CEMA authorization.** Signed authorization to release the loan/collateral file to the new lender. Many big servicers (Chase, Wells, BoA, Mr. Cooper, RoundPoint) have proprietary intake forms — e.g., the **RoundPoint CEMA Request Form (06/25/24)** and the **BoA CEMA Department request package** (Fenton Goldman PDF). The form collects loan number, property address, borrower SSN/signature, new lender name, new lender counsel, fees acknowledged, and shipping address for the collateral file.

### Stage B — Collateral & Payoff Order (Days 5–35; often the binding-constraint path)

5. **Order the collateral file from the prior servicer.** The processor faxes/emails the CEMA Request to the assigning lender's CEMA department with the borrower-signed authorization. The assigning lender's document custodian (often Iron Mountain, Deutsche Bank, US Bank, Wells Fargo doc custody) pulls the physical original Note, Mortgage, all prior CEMA agreements, **all intervening assignments**, **endorsements**, and **allonges** from a warehouse. Per RoundPoint and AAPL: *"The average turn-time to receive the Collateral File is 20–30 business days but can take up to 60 days and will be provided at the day of closing."* This is the single largest source of CEMA timeline pain (HousingWire / industry-blog consensus puts CEMA at ~75 days vs. ~30 for a plain refi).
6. **Order payoff statement.** Separate workflow from collateral-file order; obtained via the same servicer's payoff dept. Must be dated to the expected closing date. "Due to the complexity of the transaction, the first lender may require the provision of the exact closing date several business days in advance before they release a payoff" (AAPL).
7. **Track and chase.** Processor follows up by phone/email weekly (or more often) with the assigning lender. This is most processors' single largest *recurring* time-sink.

### Stage C — Title Work (Days 0–25, parallel to B)

8. **Order title commitment.** Title agent runs the search.
9. **Build the Mortgage Schedule (a.k.a. Schedule A / "the chain")**. The title abstractor lists every recorded mortgage that is being consolidated, including all prior CEMAs and all intervening assignments — chronologically, with reel/page or CRFN, dates, mortgagor, mortgagee, and dollar amounts. *"If the transaction is a CEMA, then the entire mortgage chain being consolidated needs to be recited in Schedule A or a Mortgage Schedule attached and referenced."* (Stewart Title NY guidelines summary).
10. **Schedule B exceptions clearance.** Outstanding judgments, UCCs, prior subordinate mortgages must be cleared or subordinated.
11. **Reconcile the collateral file to the title commitment.** Processor or attorney verifies every mortgage and every assignment in the title chain has a corresponding original (or certified copy + Lost Note Affidavit) in the collateral file. *"The underlying collateral is reviewed for, among other things, accuracy as to the parties, loan amounts, and dates and to ensure there are no breaks in the chain of assignments (and allonges to the notes)."* (AAPL). Breaks → either obtain a corrective assignment from a prior lender (slow) or, in worst cases, abandon CEMA and record fresh.

### Stage D — Document Preparation (Days 25–40)

12. **Draft the CEMA package** using **Fannie Mae/Freddie Mac Form 3172** (the Single-Family Uniform Instrument). Per Freddie Mac § 4101.11 and Fannie Mae Selling Guide B8-2-02, the package must contain:
    - **CEMA agreement (Form 3172)** itself.
    - **Original Consolidated Note** executed by borrower and endorsed in blank.
    - **Exhibit A** — list of all obligations being consolidated (every prior Note, mortgage, assignment, consolidation agreement, allonge).
    - **Exhibit B** — property legal description (Schedule A from prior mortgage).
    - **Exhibit C** — copy of the new Consolidated Note (fixed or ARM language as applicable).
    - **Exhibit D** — current NY Single-Family Uniform Security Instrument (Form 3033) with blanks completed.
    - The package typically runs 35–45 pages (Avenue365).
13. **Draft Assignment of Mortgage(s) and Allonge(s)** for each lien being assigned. Counsel for the assigning lender drafts and the new lender's counsel reviews (Adam Leitman Bailey P.C.).
14. **Draft Section 255 Affidavit** (NY Tax Law § 255 — supplemental-mortgage exemption). This is the document that legally claims tax-exempt status on the unpaid-principal-balance portion. *"The 255 affidavit is filed with the amended and restated and consolidated mortgage to prove that no further mortgage recording taxes are due"* (ix-legal.com).
15. **Draft Section 275 Affidavit.** Confirms that mortgage recording taxes were paid on every prior mortgage in the chain and on the new "gap mortgage." (ix-legal.com).
16. **Draft the Gap Note & Gap Mortgage.** This is a separate, new mortgage instrument for just the "new money" (new loan amount − UPB of existing). The gap mortgage is the only piece on which mortgage recording tax is actually paid.
17. **Prepare NY mortgage-tax forms.**
    - **MT-15** — Mortgage Recording Tax Return. Required statewide.
    - **NYC-RPT** — NYC Real Property Transfer Tax Return (Bronx, Kings, NY, Queens). Only needed on transfers (Purchase CEMA), not on refi-CEMAs in isolation, but always assess.
    - **TP-584** — NY Combined Real Estate Transfer Tax Return (Purchase CEMA).
    - **County-specific cover sheets / tax-lot verification.** E.g., Nassau County requires a Tax Lot Verification Letter at $355/document; Suffolk County requires a Mortgage Verification Fee at $300/document (Reltco NY recording requirements).
18. **Prepare ACRIS cover pages** (for the five NYC boroughs) via E-Tax: Recording & Endorsement Cover Page, Tax Return Cover Page, Supporting Documents Cover Page, Payment Cover Page (NYC Finance, ACRIS FAQs).
19. **Prepare title-insurance endorsements.** TIRSA Rate Manual Section 13 covers Mortgage Modification / Construction Mortgage Modification (no new money). For CEMA, **ALTA 11.1-06 (Mortgage Modification with Subordination)** is the most common endorsement — it insures that the modification doesn't invalidate the lien and preserves priority over intervening interests (Virtual Underwriter / Stewart guideline). NY also adds its own TIRSA-specific endorsements per the 2024 rate manual.

### Stage E — Closing (Day ~45–60)

20. **Pre-closing balancing.** CD/HUD-1 reconciled with the lender's wire instructions, payoff figure, CEMA fees, recording fees (recalculated to the actual page count of the executed CEMA — typically 35–45 pages, fee adjusted at the last moment; Avenue365).
21. **Closing & signing.** Borrower signs CEMA, Consolidated Note, gap mortgage, 255 affidavit, 275 affidavit, all assignments where required. Assigning-lender counsel delivers the originals of the collateral file at the closing table (sometimes via FedEx the day before).
22. **Funding.** New lender wires payoff to old lender; old lender issues satisfaction or, in CEMA's case, executes the assignment rather than a satisfaction.

### Stage F — Post-closing (Days 60–90+)

23. **Recording.** Package submitted to ACRIS (NYC boroughs) or the county clerk (every other NY county individually, often via Simplifile e-recording or by paper for hold-out counties).
24. **Wait for return / confirm indexing.** Counsel verifies recording, confirms updated title report, and resolves indexing/priority issues (Andelsman Law).
25. **Final title policy issuance.** With the recorded mortgage's reel/page or CRFN.
26. **Custody handoff.** Originals of the CEMA, Consolidated Note, allonges go to the new investor's document custodian. The package must be delivered with a complete chain of intervening assignments documenting the new investor as last assignee (Freddie Mac Document Custody Procedures Handbook Chapter 4; Ginnie Mae Document Custody Manual Chapter 9).

---

## 2. Day-in-the-life: CEMA processor at a small firm

Sources: small NY closing-attorney firm guides (Skolnick & Ben-Ezra, Mosheslaw, Davis Team NYC, Mekhtiyev Law, CPL Law, Friedman Vartolo, Andelsman Law, Bonfiglio Asterita), AAPL primer, Hauseit guides. Volume estimates triangulated from firm sizes published on those websites and from r/Mortgages threads (limited data — see open questions).

A small firm here means: a 2–8 person boutique closing-attorney shop, a small title agent, or a small mortgage-broker shop. One person (sometimes a paralegal supervised by an attorney) typically handles 4–10 active CEMAs at a time, closing ~8–20 per month.

Typical day (composite):

- 08:30–09:30 — Email triage. Status pings on 5–8 deals. Replies to LO and borrower attorneys with collateral-file ETAs. Re-send payoff requests where the prior statement has gone stale.
- 09:30–11:30 — Phone calls to large servicers' CEMA departments. Holds of 20–45 min are routine for Chase, Mr. Cooper, PennyMac, RoundPoint, Shellpoint, Mr. Cooper. Some servicers only accept faxed requests on their own form. This is the single biggest "dead-time" activity. Tracks each call in a spreadsheet.
- 11:30–12:30 — Document reconciliation: open the just-arrived FedEx envelope of a collateral file, lay out the original Note, recorded mortgage, every assignment, every allonge; compare against the title commitment Mortgage Schedule. Flag a missing intervening assignment from 2007 (a common chain-break — Adam Leitman Bailey P.C. notes courts increasingly scrutinize lost-note affidavits).
- 13:30–15:00 — Draft the 255 affidavit and 275 affidavit by hand-editing a Word template per deal; draft the gap mortgage and gap note; draft Exhibit A to Form 3172 listing 4 prior consolidations and 11 prior mortgages. (This is the deal-specific drafting Better.com automated; small firms still do it by hand.)
- 15:00–16:30 — Title work coordination. Call abstractor about a Schedule B exception (an old judgment), order a payoff for it, coordinate satisfaction.
- 16:30–17:30 — ACRIS / county clerk prep. For a Brooklyn deal: open ACRIS E-Tax, key in MT-15 fields, generate cover pages, build payment cover, validate page counts. For a Westchester deal: prepare paper package with NYS-261-style tax affidavit and pay county clerk by check (or e-record via Simplifile if the firm has an account).
- 17:30–18:30 — Closing prep for the next day's deal: produce closing-package binder, confirm wire instructions, confirm collateral file is in-hand or arriving by 9am next morning.

**Tooling at this size:**
- LOS: Encompass (rented seat) if at a broker; **no LOS at attorney firms** — they use Word + Outlook + Excel spreadsheets.
- Title prod system: occasionally **Qualia** or **ResWare** at title agents; many small NY attorneys still use spreadsheets and Word.
- E-recording: **Simplifile** (ICE Mortgage Technology) for upstate counties; **ACRIS direct** for NYC.
- Communication: phone + fax + email. Several major servicers still require fax for the CEMA request.

**Volume:** small firms report ~10–25 CEMA deals/month per processor; ~75–80% of which are refi-CEMAs, ~20–25% Purchase CEMAs (Skolnick & Ben-Ezra, Davis Team NYC, Hauseit).

---

## 3. Day-in-the-life: CEMA processor at a large firm

Sources: Freddie Mac Seller/Servicer Guide § 4101.11, Fannie Mae Selling Guide B8-2-02, Encompass/ICE Mortgage Technology product literature, the Adam Leitman Bailey P.C. lender-representation article, Better Mortgage's published process, Bank of America CEMA Department procedural docs, Iron Mountain document-custody literature.

A large firm here means: a national lender with a NY-CEMA bench (Chase, Wells, BoA, Citibank, HSBC, US Bank, M&T, Mr. Cooper as servicer-only, Better) or a national title underwriter agent operating in NY (First American, Stewart, Fidelity National, Old Republic). Functions are split:

- **CEMA Intake Specialist** — receives borrower authorization, opens a CEMA file in a CRM/case-management system, sends auto-acknowledgement, generates a request packet to the assigning lender.
- **Document Acquisition Specialist** — owns the relationship with the assigning lender's CEMA department; uses templated email blasts and a tickler system to chase collateral-file delivery on a 5/10/15/20 day cadence. Some teams use blanket Service Level Agreements with major counterparties (e.g., monthly bulk-CEMA shipments between Chase and BoA's outside counsel).
- **Document Drafter / Paralegal** — runs an internal templating engine that fills Form 3172 + Exhibits + 255 + 275 + gap docs from LOS data. At a 2026 tech-forward shop this is typically a Word/SmartDocs/DocMagic integration. DocMagic publishes a CEMA module (ML 08-26). Better Mortgage has internalized much of this into their refi pipeline.
- **Title Reviewer** — at the title underwriter, reviews the abstractor's mortgage schedule for the chain, signs off on ALTA 11.1 / TIRSA endorsement, drafts policy.
- **Closer** — handles the closing-table execution and physical handoff of the collateral file.
- **Post-Closing / Recording Clerk** — submits to ACRIS / Simplifile / paper county; tracks return; updates LOS with reel/page/CRFN; triggers final policy.

**Tooling at this scale:**
- LOS: **ICE Encompass** (the de facto standard for retail/wholesale; Encompass Persona-Based Training has a dedicated Processor course); some Black Knight/ICE LoanSphere at servicers.
- Title production: **Qualia** (which now owns ResWare and RamQuest, and acquired E-Closing in 2025 per Qualia's site).
- Document automation: **DocMagic** (has an explicit CEMA module), **Black Knight LoanDynamix**, occasional in-house Word+SmartDocs.
- IDP/OCR pipeline: **Amazon Textract + Bedrock** (Rocket Close's published case study reports "15× faster" processing of mortgage documents at ~90% accuracy), **Vaultedge** (LLM-based; categorizes 500+ document types, extracts 2,000+ fields), **Docsumo**, **DocVu.AI**.
- E-recording: **Simplifile** (most upstate counties), **ACRIS direct integration** (5 boroughs).
- Voice/communications: emerging — **Kastle**, **Salient**, **Brilo AI**, **Marr Labs**, **Voiceflow**, **Retell AI** are 2025/26 vendors marketing TCPA/CFPB-compliant voice agents for mortgage servicing inquiries, payoff verification, and milestone updates.
- Document custody: **Iron Mountain**, **Deutsche Bank**, **US Bank**, **Wells Fargo Doc Custody**.

**Volume:** at a top-10 NY refi lender, a single processor often manages 30–60 open CEMA files, closing ~30–50 per month with the workflow split described above. Better has stated they auto-opt-in every NY refinance applicant, generating thousands of CEMAs/year.

---

## 4. Task-by-task automation potential

Each row reflects the *current human task* and the AI/automation tier it maps to. Tiers: **FULL** (fully automatable, near-zero human review), **AUG** (AI-augmented, exceptions only), **HIL** (human-in-loop required for compliance/legal sign-off), **HUMAN** (resists automation). Confidence column reflects how strongly the sources support the feasibility claim (H/M/L).

| # | Task | Frequency per deal | Approx time (small firm) | Tier | AI capability needed | Confidence |
|---|------|---|---|------|---------------------|---|
| 1 | Identify NY refi/purchase as CEMA candidate at intake | 1× | 5 min | FULL | Rule engine over LOS data (state = NY, has 1st lien, property type allowlist, loan-program allowlist) | H |
| 2 | Compute breakeven (gross tax avoided − assigning-lender fee − attorney fee − incremental title/recording) | 1× | 10–20 min | FULL | Deterministic calculator with current county tax tables (rates: 1.8%/1.925% NYC; 1.05% Nassau/Suffolk/Westchester; 0.75–1.05% upstate; $10K residential deduction); fee lookup keyed by assigning servicer | H |
| 3 | Generate borrower CEMA authorization, e-sign capture | 1× | 5 min | FULL | Doc-gen + DocuSign/Adobe Sign workflow | H |
| 4 | Identify the correct CEMA department / fax/email for each major servicer | 1× | 5–15 min (lookup or recall) | FULL | Maintained directory of servicer CEMA depts (Chase, Wells, BoA, Mr. Cooper, RoundPoint, Shellpoint, Citi, HSBC, M&T, US Bank, PennyMac, NewRez/Shellpoint, Freedom, LoanCare, Cenlar — small set, well-known) | H |
| 5 | Submit CEMA request to assigning lender on their proprietary form | 1× | 10–30 min | AUG | Doc-gen + fax/email send + intake-form mapping (some servicers still require fax; many now accept email/portal); needs maintained per-servicer templates | M (some servicers reject non-human submissions) |
| 6 | Chase the assigning lender for collateral file & payoff | 4–15× (weekly) | 10–45 min each, often on hold | AUG | Voice agent for outbound payoff/status calls + email cadence orchestrator; Kastle/Salient/Brilo/Marr Labs targeting exactly this; TCPA/CFPB compliance layer required | M (vendor maturity exists; humans still better at servicer-rep relationships) |
| 7 | OCR/IDP intake of arriving collateral file (Note, Mortgage, prior assignments, allonges, prior CEMAs) | 1× per deal, 5–50 docs | 30–120 min | AUG | Mortgage IDP (Textract+Bedrock pipeline, Vaultedge, Docsumo, DocVu.AI) with CEMA-specific document classes; extract parties, dates, dollar amounts, reel/page/CRFN | H |
| 8 | Reconcile collateral-file documents against title commitment Mortgage Schedule (find gaps in chain) | 1× | 30–90 min | AUG | Cross-document reasoning: build chain graph from extracted entities → diff against title-schedule list → flag missing assignments or allonges | H |
| 9 | Spot a "lost note" or "broken chain" and identify which prior lender must issue corrective | 1× (in ~10–20% of deals) | 30–60 min | HIL | Diagnostic LLM + targeted email/voice action; final call needs counsel sign-off (case law scrutiny of lost-note affidavits per Adam Leitman Bailey P.C.) | M |
| 10 | Order title commitment + Mortgage Schedule | 1× | 5–10 min | FULL | API integration to Qualia/ResWare/RamQuest | H |
| 11 | Order payoff letter | 1×, sometimes 2× (refresh) | 10–20 min | AUG | Voice agent + email; refresh on closing-date change | M |
| 12 | Draft CEMA agreement Form 3172 + Exhibits A/B/C/D | 1× | 60–120 min | AUG | Document-generation engine (DocMagic already does this); requires LOS data + extracted prior-mortgage chain from IDP | H |
| 13 | Draft Consolidated Note, Gap Note, Gap Mortgage | 1× | 30–60 min | AUG | Doc-gen from templates | H |
| 14 | Draft Assignment of Mortgage + Allonge(s) | 1–N× (one per prior mortgage) | 15–30 min each | AUG | Doc-gen; review by counsel | H |
| 15 | Draft NY Tax Law § 255 affidavit | 1× | 15–30 min | AUG | Doc-gen from boilerplate + IDP-extracted UPB figures; review by counsel | H |
| 16 | Draft NY Tax Law § 275 affidavit | 1× | 15–30 min | AUG | Doc-gen; reviewer-signed | H |
| 17 | Prepare MT-15 mortgage recording tax return | 1× | 15–30 min | FULL | Form-fill with deterministic tax-table calculation; e-file in jurisdictions that accept it | H |
| 18 | Prepare county-specific cover sheets / verification letters (Nassau Tax Lot, Suffolk Mtg Verification, etc.) | 1× per county | 15–30 min | AUG | County-specific form-fill; some counties require physical paper still | M |
| 19 | Prepare ACRIS E-Tax cover pages (Recording & Endorsement, Tax Return, Supporting, Payment) | 1× for NYC deals | 30–60 min | AUG | ACRIS API/E-Tax integration; deterministic + form-fill | M (ACRIS lacks a fully open API, some screen-scrape required) |
| 20 | Order ALTA 11.1 / TIRSA mortgage modification endorsement, calculate premium | 1× | 5–15 min | FULL | Qualia/ResWare integration; TIRSA 2024 rate manual lookup | H |
| 21 | Quality-check / red-line the entire closing package | 1× | 30–90 min | HIL | LLM diff vs. checklist + counsel sign-off | M |
| 22 | Coordinate closing date with borrower + counsel + assigning-lender counsel + title | 1× per deal, 2–5 reschedules | 30–60 min | AUG | Scheduling agent + email orchestration | H |
| 23 | Reconcile final CD/HUD-1 page count adjustment (CEMA varies 35–45 pages → recording fee changes) | 1× | 10–20 min | FULL | Page-count from generated PDF → fee recalculation → CD line update | H |
| 24 | Closing-table execution (signatures, ID, hand-off of original collateral) | 1× | 30–90 min (notary/attorney time) | HUMAN | Remote online notarization (RON) is legal in NY but adoption is uneven; in-person notary still common; hand-off of physical originals is unavoidable until full e-notes accepted | M |
| 25 | Funding wire issuance & confirmation | 1× | 15–30 min | AUG | Treasury workflow + wire-fraud-prevention controls (CertifID etc.) — established mortgage automation | H |
| 26 | E-record to ACRIS (NYC) or county clerk (rest of state) | 1× | 15–60 min | AUG | Simplifile API (covers most counties) + ACRIS direct for boroughs; few outliers may still be paper | H |
| 27 | Monitor recording return; capture reel/page/CRFN | 1× | varies, can be days/weeks | AUG | Polling + IDP of returned cover sheet | H |
| 28 | Resolve recording rejection (page count, missing affidavit, fee mismatch) | 1× in ~10% of deals | 30–120 min | HIL | LLM diagnoses rejection reason from returned-rejection notice; re-submit; humans confirm | M |
| 29 | Final title policy issuance | 1× | 30–60 min | FULL | Title-prod integration | H |
| 30 | Custody handoff to document custodian (Iron Mountain etc.) | 1× | 30 min + shipping | AUG | Doc-shipping orchestration; many custodians have APIs (e.g., Iron Mountain Smart Sort) | M |
| 31 | Servicing system updates (loan boarding to new servicer's system) | 1× | varies | AUG | Standard MISMO data exchange — already automated at large lenders | H |
| 32 | Customer status updates ("where is my closing?") | 5–20× per deal | 5–15 min each | FULL | Brilo/voice agent + portal/email cadence; Brilo specifically markets milestone updates as core use case | H |
| 33 | Negotiation: convince a reluctant prior lender to assign vs. payoff | 1× in ~5% of deals | 30 min – many hours | HUMAN | Relationship work; some shops have escalation playbooks | H |
| 34 | Exception triage: deal-killers (broken chain, VA loan, co-op, servicing transfer mid-deal, broken-and-restated chain from 2008–2010 securitization era) | 1× in ~10–15% of deals | varies | HIL | LLM advisor + counsel decision | M |

---

## 5. NYS-specific quirks

### 5.1 Mortgage recording tax structure
- **Statewide base** = $0.50/$100 of principal (0.50%) + special additional tax $0.25/$100 (0.25%) + additional tax $0.25–0.30/$100 (NY Tax Dept., mtgidx.htm).
- **Local add-ons** stack on top — NYC adds enough to bring the total to **1.8% under $500K / 1.925% $500K+** on residential 1–6 family; Yonkers, Westchester, Nassau, Suffolk each add their own (Nassau/Suffolk/Westchester land at ~1.05% combined).
- **$10,000 residential deduction**: "If the real property is principally improved or to be improved by a one- or two-family residence or dwelling, the first $10,000 of principal debt or obligation secured by the mortgage is deducted in computing the additional tax." (NY Tax Dept.).
- This rate table must be a live, county-keyed lookup in any AI system, with NYC's borough-level rate as a special case.

### 5.2 Section 255 and Section 275 affidavits (the linchpin)
- **§ 255** is the *exemption* affidavit. It tells the recording officer that the consolidation does not constitute a new mortgage and is therefore tax-exempt on the assumed-UPB portion. *"If an exemption is claimed under this section at the time of recording, there must be filed with the recording officer a statement under oath of the facts on which the claim for exemption is based"* (NY Tax Law § 255).
- **§ 275** is the *proof-of-prior-tax-paid* affidavit. It evidences that prior mortgage recording taxes were paid on all the consolidating mortgages plus the gap mortgage.
- Errors here are tax-savings-killing and can trigger audits. Per Andelsman Law, "incorrect tax affidavits — compliance errors that invalidate expected savings" are a top failure mode. → Strong case for an LLM-augmented draft with mandatory counsel review (HIL).

### 5.3 NYC ACRIS vs. upstate county clerks
- **ACRIS** (Bronx, Brooklyn, Manhattan, Queens) — online recording via the City Register, fully e-recordable. Cover-page generation handled in **ACRIS E-Tax**: Recording & Endorsement, Tax Return (NYC-RPT for transfers), Supporting Documents, Payment Cover Pages. No fully open public API — current best practice is E-Tax web-form automation + Simplifile relay for e-recording.
- **Staten Island** = Richmond County — uses ACRIS too (it's a NYC borough).
- **Westchester, Nassau, Suffolk, Rockland, Orange, Dutchess, Putnam, Erie, Monroe, Onondaga, Albany, etc.** — each county clerk operates independently. Most accept **Simplifile e-recording**; some require paper. Counties have idiosyncratic requirements:
  - **Nassau**: Tax Lot Verification Letter, $355/document, before recording.
  - **Suffolk**: Mortgage Verification Fee, $300/document.
  - Document-formatting rules (page size, margin, font size, recording-mark zones) vary per county. Failures get rejected and returned.
- Implication: a CEMA automation system must encode 62 county-clerk rule sets plus ACRIS; Simplifile gives broad coverage but per-county templates are still required.

### 5.4 Co-op CEMA: a different animal
- Co-ops are **personal property** (shares + proprietary lease), not real property. They are encumbered by **UCC-1 financing statements** (Article 9), not mortgages.
- Strictly, "CEMA" does not apply because there's no mortgage recording tax on a UCC-1. However, the *co-op share loan analog* exists: the lender can do an **Assignment of the Share Loan and Recognition Agreement** rather than originate a fresh loan, with the **co-op corporation** as the third party to the tri-party recognition agreement (Hauseit, Lasser Law Group).
- Most CEMA explainers explicitly **exclude co-ops** (Friedman Vartolo, Better.com, PropertyClub). For an AI product targeting the broad 1–3 family / condo CEMA market, co-ops can be marked **"out of scope, route to human"**.
- For a future co-op-share-loan product line, the analog process is real and Equity Settlement publishes a brochure on combined CEMA & Co-op processing.

### 5.5 Purchase CEMA vs. Refi CEMA
- **Refi CEMA**: same borrower; new lender pays off old, but lender assigns instead of satisfies. Same-lender refi CEMAs are *much* easier — no inter-lender assignment cooperation needed. ~75% of CEMA volume.
- **Purchase CEMA**: buyer assumes seller's mortgage chain. Requires *seller cooperation* (the seller signs documents to release their mortgage to the buyer), seller's lender cooperation, and additional savings on **NY State transfer tax** as well. Hauseit / PropertyClub note that selling-side broker engagement is needed up-front because sellers often refuse to cooperate without compensation. Restricted to 1–3 family houses and condos (no co-ops).
- **Eligibility filter**: Fannie/Freddie's NY CEMA program (Form 3172, § 4101.11) covers only refinances — Purchase CEMA structures still use Form 3172 but rely on private-investor / lender-specific guidelines.

### 5.6 Wholesale vs. retail
- **Retail lenders** (e.g., Better, JPM Chase retail) own the entire workflow end-to-end and have the strongest incentive to automate.
- **Wholesale lenders** (e.g., "The Lender" wholesale, UWM where they support CEMA) push CEMA work to a *broker's* closing attorney; lender publishes a "CEMA Refinance Closing Process" PDF and an approved-attorney list.
- An AI product can be sold to: (a) retail lenders directly (replace internal FTEs); (b) wholesale brokers (offer CEMA-as-a-service); (c) closing attorney firms (replace paralegals); (d) title agents (replace title-side CEMA coordinators). Each has different ICP nuances.

### 5.7 Approved CEMA attorney lists
- National lenders (BoA, Wells, Chase, Citi) maintain **approved-attorney lists** and will only honor CEMAs closed by those firms (Andelsman Law: *"Only certain law firms designated as Approved CEMA Attorney firms are allowed to close CEMA transactions."*). An AI vendor probably needs to partner with such an approved firm to be the system of record at closing, *or* sell the automation behind the attorneys' nameplate.

### 5.8 Title insurance: TIRSA-regulated
- NY title insurance rates are set by the **Title Insurance Rate Service Association (TIRSA)** rate manual (current effective 10/1/2024). Section 13 covers Mortgage Modification (with and without new money). CEMA premiums use modification-rate logic rather than full-amount logic, which itself is part of the savings story.
- The applicable endorsement is typically **ALTA 11.1-06 (Mortgage Modification with Subordination)** plus NY-specific TIRSA endorsements. Stewart Title guideline GL00000033 governs ALTA 11; ALTA 11.2 covers modification with additional amount of insurance.

---

## 6. Top 10 highest-leverage automation targets

Ranked by **(estimated annual hours saved per processor) × (feasibility / vendor-maturity)**, assuming a processor handles ~300 deals/year and the system is built on 2026 SOTA. Hours/year column is best-estimate; bands rather than point values.

| Rank | Target | Why it's high leverage | Annual hrs saved per processor (est.) | Tier | Vendor / capability example |
|---|---|---|---|---|---|
| 1 | **Collateral-file chase (calls + emails + ticklers)** | Single largest dead-time activity; processors burn 20–45 min/call on hold with major servicers, 4–15× per deal | 400–900 hrs | AUG | Kastle, Salient, Marr Labs (voice); custom email orchestrator; Brilo for borrower-facing status |
| 2 | **OCR/IDP of incoming collateral files and title commitments** | Manual document reconciliation against title schedule is 30–120 min/deal; mortgage IDP at 90%+ accuracy is published commodity tech | 200–500 hrs | AUG | Textract + Bedrock pipeline (Rocket Close model), Vaultedge, Docsumo, DocVu.AI |
| 3 | **Chain-of-title diff & break detection** | Highest skill task; LLM + graph reasoning is now feasible; biggest source of unresolvable failures discovered too late | 100–250 hrs + cost-of-aborted-deals saved | AUG | Custom LLM agent + extracted-entity graph |
| 4 | **Document generation: CEMA Form 3172 + Exhibits A–D, gap docs, 255/275 affidavits, assignment + allonge** | Templated work, deal-specific data fill; DocMagic already partially does this. Replaces 3–5 hrs/deal | 200–500 hrs | AUG → HIL (counsel review) | DocMagic CEMA module, custom Doc-gen + Anthropic/OpenAI for boilerplate variation |
| 5 | **MT-15 + county recording cover sheets + ACRIS E-Tax preparation** | Form-fill from already-known data; deterministic; county-specific rules are encodable | 100–250 hrs | FULL → AUG | Custom form-fill + Simplifile integration + ACRIS E-Tax browser automation |
| 6 | **Borrower & broker status communications** | 5–20 inquiries per deal; current handling is text/email/phone | 100–300 hrs | FULL | Brilo (voice), email/SMS cadence, status portal |
| 7 | **Savings & breakeven analysis at intake** | Replaces a 10–20 min manual calc; also enables product cross-sell to refis that lender didn't flag | 50–100 hrs + lift in CEMA take-rate | FULL | Calculator with county tax-table service; surfaced via LO portal |
| 8 | **Closing-package QA & rejection-resolution loop** | Recording rejections happen in ~10% of deals; re-work is high-friction | 60–150 hrs | HIL | LLM diagnostic over rejection-notice + checklist |
| 9 | **Payoff & assignment-fee verification** | Voice/email task; reconciles to actual closing math | 50–150 hrs | AUG | Same voice/email stack as #1 |
| 10 | **Approved-attorney/title-agent routing & order management** | Reduce manual handoffs and clerical "send to firm X" emails | 30–100 hrs | FULL | Workflow engine + maintained directory |

**Composite headline:** 1,500–3,000 hours/year/processor are squarely AI-tractable. With 2–3 processors today and ~1 attorney-reviewer remaining, this is consistent with the client's framing of replacing 2–3 FTEs.

---

## 7. Open questions for the project owner

1. **Who is the buyer/seller in the client's business?** Is the client a (a) lender, (b) broker, (c) closing-attorney firm, (d) title agent, or (e) a SaaS vendor selling to all four? The economic case and the data-ownership model differ sharply across these.
2. **Approved-attorney-list status.** If the client is a lender or planning to sell to lenders, do they already have a closing attorney firm on the Approved CEMA Attorney lists of Chase / BoA / Wells / Citi? If not, partnership is a near-term blocker.
3. **Refi-only or Purchase CEMA too?** Refi-CEMA is 75%+ of volume and 100% covered by Fannie/Freddie Form 3172. Purchase CEMA is meaningfully different (seller cooperation, transfer-tax savings) and could be Phase 2.
4. **Co-op share-loan product line?** Strictly not CEMA, but the assignment + recognition agreement workflow is analogous and the NYC market opportunity is substantial.
5. **Voice-agent compliance.** Outbound calls to servicer CEMA departments are B2B and likely outside TCPA "consumer" rules, but borrower-facing voice agents are squarely under TCPA + CFPB. What is the client's risk tolerance and which call-paths are in scope?
6. **System-of-record integration.** Will the product be a standalone workflow tool, or does it need to write back into Encompass / Qualia / ResWare / a particular client's LOS? The latter is more sticky but more vendor-relationship work.
7. **NYC ACRIS API status.** ACRIS does not currently publish a fully open ingestion API for cover-page generation — recording via Simplifile is the practical path. Confirm whether the client is willing to depend on Simplifile or wants direct ACRIS integration (which is brittle browser-automation against the City Register's site).
8. **Volume sourcing.** What's the client's projected annual CEMA throughput and from which lenders/firms? This dictates whether the architecture is multi-tenant SaaS, single-tenant white-label, or a pure-AI back-office staffing model.
9. **Document-custody handoff in scope?** Physical collateral-file movement (FedEx, custody firm intake) is still partly analog. Does the client need to own that, or hand off to existing custody vendors?
10. **State expansion risk.** CEMA is NY-only by construction, but adjacent products (e.g., NJ Fee Assignment Affidavit savings, FL doc-stamp avoidance) could be follow-ons. Worth a strategic discussion early.
11. **What exactly were the 2–3 FTEs *titled*** at the client's customer? (CEMA processor / closing coordinator / paralegal / loan-closing analyst / lender-services associate). Their titles in HR systems will drive how the client narrates ROI.
12. **Lost-note / chain-break unblocking.** Roughly 5–15% of CEMAs hit unresolvable chain issues that require attorney judgment (case law has tightened around lost-note affidavits per Adam Leitman Bailey P.C.). The AI product needs an escalation path; how is the client staffing the residual attorney-of-record role?

---

## Sources (inline-cited above; consolidated list)

- American Association of Private Lenders (AAPL), "Understanding the Complexities of New York's CEMA Loans" — https://aaplonline.com/articles/uncategorized/understanding-the-complexities-of-new-yorks-cema-loans/
- Adam Leitman Bailey, P.C., "Lender Representation, CEMAs & Section 255 of the NY Tax Law" — https://alblawfirm.com/articles/lender-representation-cemas-section-255-of-the-ny-tax-law/
- Adam Leitman Bailey, P.C., "Understanding How to Save a Bundle of Money by Obtaining a CEMA Refinance Loan" — https://alblawfirm.com/case-studies/save-with-cema/
- Skolnick & Ben-Ezra, PLLC, "Purchase CEMA" — https://nyplg.com/services/purchase-cema/
- Zimmet Law Group, "Purchase CEMA" — https://www.zimmetlaw.com/new-york-city-real-estate-attorney/purchase-cema/
- Andelsman Law, "CEMA Attorney: Key Insights on Consolidation in NY Real Estate" — https://andelsmanlaw.com/cema-attorney-consolidation-ny-real-estate/
- Andelsman Law, "Smarter CEMA New York" — https://andelsmanlaw.com/smarter-cema-new-york/
- Friedman Vartolo LLP, "What is a CEMA?" — https://friedmanvartolo.com/what-is-a-cema/
- Davis Team NYC, "Purchase CEMA" — https://davis-nyc.com/purchase-cema
- Hauseit, "Purchase CEMA Mortgage" — https://www.hauseit.com/purchase-cema-mortgage/
- Hauseit, "The UCC Financing Statement for a Coop in NYC" — https://www.hauseit.com/ucc-financing-statement-coop-nyc/
- Lasser Law Group, "Cooperative vs Condominium Lien Priority and Collections Strategy" — https://lasserlg.com/cooperative-vs-condominium-lien-priority-and-collections-strategy/
- PropertyClub, "CEMA Mortgage Loan Guide (2024)" — https://propertyclub.nyc/article/what-is-a-cema-loan
- Better Mortgage, "CEMA New York" — https://better.com/content/ny-guide-cema-loan
- Rocket Mortgage, "CEMA Loans: Everything you need to know" — https://www.rocketmortgage.com/learn/cema
- Quicken Loans, "What Is A CEMA Loan?" — https://www.quickenloans.com/learn/cema-loans
- Cardinal Financial, "CEMA Loans: What to Know Before You Refinance in New York" — https://www.cardinalfinancial.com/blog/cema-loan/
- Avenue365, "CEMAs New York" — https://avenue365.com/2015/02/cemas-new-york/
- Artisan Home Mortgage, "New York mortgage assignment aka CEMA" — https://www.artisanhomemortgage.com/news/new-york-mortgage-assignment-aka-cema/
- Brick Underground, "What is a CEMA loan?" — https://www.brickunderground.com/buy/bricktionary-whats-a-cema
- Mosheslaw, "Refinancing Your House? How a 'CEMA' Mortgage Can Help" — https://mosheslaw.com/cema-mortgage/
- ix-legal.com, "Minimizing Mortgage Recording Taxes in New York" — https://www.ix-legal.com/blog/2023/july/minimizing-mortgage-recording-taxes-in-new-york/
- Mondaq, "Minimizing Mortgage Recording Taxes In New York" — https://www.mondaq.com/unitedstates/charges-mortgages-indemnities/1339616/
- NY Dept. of Taxation & Finance, "Mortgage recording tax" — https://www.tax.ny.gov/pit/mortgage/mtgidx.htm
- NY Dept. of Taxation & Finance, "$10,000 Residential Property Exclusion on Certain Mortgages" — https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/mrt/10,000_residential.htm
- NY Dept. of Taxation & Finance, "Form MT-15: Mortgage Recording Tax Return" — https://www.tax.ny.gov/pdf/current_forms/mortgage/mt15.pdf
- NY Senate, "TAX Law § 255" — https://www.nysenate.gov/legislation/laws/TAX/255
- FindLaw, NY Tax Law TAX § 255 — https://codes.findlaw.com/ny/tax-law/tax-sect-255/
- Lexis Section 255 Affidavit (Mortgage Recording Tax Exemption) (NY) — https://advance.lexis.com/open/document/lpadocument/?pddocfullpath=/shared/document/forms/urn:contentItem:5K13-HMB1-JGBH-B0T4-00000-00
- NYC Dept. of Finance, "Mortgage Recording Tax" — https://www.nyc.gov/site/finance/property/property-mortgage-recording-tax-mrt.page
- NYC Dept. of Finance, ACRIS FAQs (e-tax) — https://home4.nyc.gov/site/finance/property/acris-faq-etax.page
- NYC Dept. of Finance, ACRIS E-recording Document Submission Guide — https://www.nyc.gov/assets/finance/downloads/pdf/land_records/erecording_submission_cards.pdf
- NYC Dept. of Finance, Checklist for Document Recording — https://www.nyc.gov/assets/finance/downloads/pdf/land_records/doc_recording_checklist.pdf
- Yoreevo, "The Complete Guide to the NYC Mortgage Recording Tax" — https://yoreevo.com/blog/mortgage-recording-tax-nyc
- HelpNewYork.com, "NYC Mortgage Recording Tax Explained" — https://helpnewyork.com/nyc-mortgage-recording-tax-closing-taxes-2026-buyer-guide/
- Reltco, NY Recording Requirements — https://www.reltco.com/recording/NY.pdf
- Stewart Title NY Guidelines — https://www.stewart.com/content/dam/stewart/Microsites/new-york/pdfs/ny-guidelines-for-out-of-state-and-new-agents-12-13-2022.pdf
- New York Title Insurance Rate Service Association (TIRSA), 2024 Rate Manual — https://tirsa.org/__static/4dca82db7768ac3d338b334acdc8020f/tirsa-rate-manual-approval-june-10-2024-effective-date-october-1-2024.pdf
- Virtual Underwriter, ALTA Endorsement 11 (Mortgage Modification) Guideline — https://www.virtualunderwriter.com/en/guidelines/2008-6/GL00000033.html
- Virtual Underwriter, ALTA Endorsement 11.2 — https://www.virtualunderwriter.com/guidelines/2014/2/gl139273989400000005
- AAPL, "Title Policy Endorsements 101" — https://aaplonline.com/articles/legal/title-policy-endorsements-101/
- Suffolk County Clerk, Mortgage Fee Schedule — https://suffolkcountyny.gov/Elected-Officials/County-Clerk/Recording/Mortgage-Fee-Schedule
- ICE / Simplifile, Suffolk County e-recording — https://mortgagetech.ice.com/products/simplifile/erecording/erecording-network/new-york/suffolk-county
- Freddie Mac, NY CEMA Origination & Delivery (§ 4101.11), as summarized at — https://homebuyer.com/guidelines/freddie-mac/origination-and-delivery-of-mortgages-using-a-new-york-consolidation-extension-and-modification-agreement-the-ny-cema-4101-11
- Fannie Mae Selling Guide, Special-Purpose Security Instruments (B8-2-02) — https://selling-guide.fanniemae.com/sel/b8-2-02/special-purpose-security-instruments
- DocMagic, ML 08-26 New York CEMA — https://www.docmagic.com/compliance/regulatory-announcements/ml-08-26
- Nations Direct Mortgage, CEMA Refinance Closing Process Flow — https://myndm.com/downloads/resources/CEMA-Refinance-Closing-Process-Flow-Nations-Direct-Mortgage.pdf
- The Lender wholesale, Lender CEMA Refinance Closing Process — https://wholesale.thelender.com/wp-content/uploads/2023/01/CEMA-Refinance-Closing-Process-004-1.pdf
- RoundPoint Mortgage Servicing, CEMA Request Form — https://roundpointmortgage.com/wp-content/uploads/2024/10/RoundPoint-CEMA-Request-Form-062524.pdf
- Bank of America CEMA Department request package (via Fenton Goldman Title) — http://www.fentingoldman.com/uploads/1/0/5/2/105285929/boa_cema_request_forms_-_fgtd.pdf
- Equity Settlement, "Equity Settlement: The New York CEMA & Co-op Process" — https://www.equitysettlement.com/marketing/equity/intro(tempRemoved%20BofA%20logo).pdf
- Iron Mountain document custody — https://www.ironmountain.com/resources/solution-guides/d/document-custody-solution
- Qualia / ResWare / RamQuest title-production platforms — https://www.qualia.com/resware/ ; https://www.qualia.com/resware-comparison/ ; https://sourceforge.net/software/compare/Qualia-vs-RamQuest-One-vs-ResWare/
- ICE Mortgage Technology, Encompass and Persona-Based Training (Processor) — https://mortgagetech.ice.com/products/encompass ; https://www.kmu.education/courses/loan-processor-training-in-encompass
- Robert Half, "Mortgage Processor Salary in New York, NY (2026)" — https://www.roberthalf.com/us/en/job-details/mortgage-processor/new-york-ny
- ZipRecruiter, "Mortgage Processor Salary in New York" — https://www.ziprecruiter.com/Salaries/Mortgage-Processor-Salary-in-New-York,NY
- Indeed, "Mortgage Loan Processor Jobs in New York, NY" — https://www.indeed.com/q-mortgage-loan-processor-l-new-york,-ny-jobs.html
- Indeed, "Mortgage Processor Job Description (2026)" — https://www.indeed.com/hire/job-description/mortgage-processor
- Salary.com, "Mortgage Loan Processor I Salary in New York" — https://www.salary.com/research/salary/benchmark/mortgage-loan-processor-i-salary/new-york-ny
- AWS Machine Learning blog, "Rocket Close transforms mortgage document processing with Amazon Bedrock and Amazon Textract" — https://aws.amazon.com/blogs/machine-learning/rocket-close-transforms-mortgage-document-processing-with-amazon-bedrock-and-amazon-textract/
- AWS Machine Learning blog, "Process mortgage documents with intelligent document processing using Amazon Textract and Amazon Comprehend" — https://aws.amazon.com/blogs/machine-learning/process-mortgage-documents-with-intelligent-document-processing-using-amazon-textract-and-amazon-comprehend/
- DocVu.AI, "The Mortgage Document Processing Workflow" — https://www.docvu.ai/the-mortgage-document-processing-workflow-intake-extraction-and-validation-explained/
- Vaultedge, "Top 5 IDP Tools for Mortgage Processing" — https://vaultedge.com/resource/ungated/blog/top-5-intelligent-document-processing-tools-for-mortgage-processing-in-2024
- Docsumo, "IDP for Lending" — https://www.docsumo.com/solutions/idp-for-lending
- Kastle.ai, AI Voice Agents for Lending — https://www.kastle.ai/
- Salient (trysalient.com), AI Voice Agents for Consumer Lending — https://www.trysalient.com/
- Brilo AI, AI Voice Agent for Mortgage Industry — https://www.brilo.ai/industry/ai-voice-agent-for-mortgage-industry
- Marr Labs — https://www.marrlabs.com/
- Voiceflow, AI Agent for Mortgage Brokers — https://www.voiceflow.com/ai/mortgage-brokers
- Retell AI — https://www.retellai.com/industry/financial-services
- Hauseit, "A Guide to the Coop UCC Financing Statement in NYC" — https://hauseit.medium.com/a-guide-to-the-coop-ucc-financing-statement-in-nyc-a588d7bca596
- NY Dept. of State, UCC Financing Statement Cooperative Addendum (Form UCC1Cad) — https://dos.ny.gov/new-york-ucc-financing-statement-cooperative-addendum-form-ucc1cad
- KGAbstract Title Insurance Agency, NY Recording Fees — https://kgabstract.com/recording-fees/

---

## Notes on confidence and gaps

- **Strong evidence base** for: lifecycle steps, document set, NY tax-form set, county-clerk + ACRIS recording, turn-times (20–30 business days for collateral file; ~75 days total close), Form 3172 + 4 Exhibits, § 255 / § 275 affidavits, ALTA 11.1 endorsement, co-op exclusion, VA exclusion, vendor landscape for IDP and voice.
- **Moderate evidence base** for: exact volume per FTE (no public benchmark — triangulated from firm sizes and Better's published auto-conversion practice; explicit data ask in Open Questions §7.11).
- **Weak / inferred** for: precise time-per-task at small firms (estimated from job-listing duties and process flows, not from time-and-motion studies); ACRIS API openness (no public docs found indicating an open submit API beyond Simplifile relays); voice-agent acceptability at large servicers' CEMA departments (vendor maturity exists, real-world acceptance at BoA/Wells CEMA desks unverified — needs pilot).
- **No primary "CEMA processor" job listing** was located on Indeed/LinkedIn/ZipRecruiter/Glassdoor in this research; the workflow is real but the title is internal. Confirm with the project owner whether the client's customer has a literal "CEMA processor" title or whether the FTEs sit under generic "loan processor", "closing coordinator", or "lender-services associate" titles.
