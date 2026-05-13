# CEMA Software — Competitive Landscape

**Date:** 2026-05-12
**Author:** Research agent (subagent for Project CEMA)
**Scope:** Software & service providers that touch the New York Consolidation, Extension, and Modification Agreement (CEMA) workflow. Build-vs-buy and uniqueness inputs for an AI-native CEMA product.
**Key finding up front:** No vendor today markets a dedicated, end-to-end CEMA workflow product. CEMA is treated as a state-specific document/edge case inside generalist mortgage/title/closing software. The "CEMA processor" labor category exists precisely because the software stack does not solve the coordination problem. This is the white space.

---

## 1. Existing Software Map — by Category

### 1.1 Loan Origination Systems (LOS)

LOS platforms own the lender-side loan file. They are where a CEMA refinance is opened, disclosed, underwritten, and closed. None ship a "CEMA module"; all rely on lender-built workflows, document overlays, and the closing attorney to do the real CEMA work.

| Product                          | Vendor                  | CEMA Support                                                                                                                                                                                                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encompass                        | ICE Mortgage Technology | None advertised. Lenders build custom workflows via Encompass Developer Connect, KensieMae, etc.                                                                                                                                                                                       | Dominant LOS. Has CEMA-capable document templates via DocMagic / IDS integration but no native CEMA orchestration. ([KensieMae Encompass services](https://www.kensiemaellc.com/encompass-professional-services), [ICE Mortgage Tech](https://mortgagetech.ice.com/index))                                                                                                                                  |
| Point / PointCentral             | Calyx Software          | None advertised                                                                                                                                                                                                                                                                        | Small-broker focus. ([Calyx PointCentral](https://www.calyxsoftware.com/products/point/point-central))                                                                                                                                                                                                                                                                                                      |
| BytePro                          | Byte Software (Calyx)   | None advertised                                                                                                                                                                                                                                                                        | Legacy desktop heritage.                                                                                                                                                                                                                                                                                                                                                                                    |
| LendingPad                       | LendingPad Corp.        | None advertised                                                                                                                                                                                                                                                                        | Cloud-native; migration target from Calyx Point. ([LendingPad docs](https://lendingpad.com/kb/migratedata))                                                                                                                                                                                                                                                                                                 |
| Mortgage Director / MeridianLink | MeridianLink            | None advertised                                                                                                                                                                                                                                                                        | Bank/credit-union niche.                                                                                                                                                                                                                                                                                                                                                                                    |
| Vesta                            | Vesta (a16z, Bain)      | None advertised — markets "AI-native task automation, rules engine, document intelligence." A CEMA refinance is just a loan type with configurable tasks.                                                                                                                              | Won the Pennymac LOS replacement Sept 2025. Probably the most plausible competitive threat if they decide to vertical-slice NY CEMA. ([Vesta](https://www.vesta.com/), [Pennymac press release](https://pfsi.pennymac.com/news-events/press-releases/news-details/2025/Pennymac-Selects-Vesta-to-Supercharge-Its-Mortgage-Platform-Setting-a-New-Industry-Standard-in-Origination-Technology/default.aspx)) |
| Polly                            | Polly                   | PPE / pricing engine — not workflow. Added AI automation May 2025 but for LO experience, not CEMA. ([Polly news](https://www.businesswire.com/news/home/20250515114595/en/Polly-Further-Advances-its-Unrivaled-LO-Experience-with-Full-Mobile-Capabilities-and-AI-powered-Automation)) | Capital markets / product-pricing, not paperwork.                                                                                                                                                                                                                                                                                                                                                           |

**CEMA-relevance rating across the LOS category: 1/5.** The LOS holds the loan file, but everything CEMA-specific (assignment retrieval, NY tax math, attorney coordination) happens outside it.

### 1.2 Title Production / Closing Platforms

This is where CEMA work actually lives today, because the title agent and closing attorney coordinate the assignment chain.

| Product                                | Vendor                     | CEMA Support                                                                                                                                                                                                                                                         | Notes                                                                                                                                                                                                      |
| -------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qualia                                 | Qualia Labs                | No CEMA-dedicated module advertised. Has generic "dynamic workflows" and Qualia Connect for multi-party coordination. ([Qualia](https://www.qualia.com/))                                                                                                            | Acquired ResWare (2020) and RamQuest (Jan 2025). Now the de-facto consolidator of the title-software market. ([CertifID title software guide](https://www.certifid.com/article/title-production-software)) |
| Qualia Shield + Automated Payoff Agent | Qualia                     | **Payoff** is automated end-to-end with a generative-AI agent: identify, authorize, order, verify, import. Does **NOT** mention CEMA or mortgage-assignment retrieval. ([Qualia blog](https://blog.qualia.com/qualia-shield-automates-the-mortgage-payoff-process/)) | This is the closest existing product to what a CEMA-AI agent would look like — but for a different document. Validates the agent-pattern, leaves the CEMA-specific assignment workflow unaddressed.        |
| ResWare                                | Qualia (acquired)          | None advertised                                                                                                                                                                                                                                                      | Mature title production.                                                                                                                                                                                   |
| RamQuest                               | Qualia (acquired Jan 2025) | None advertised                                                                                                                                                                                                                                                      | Title production. Sunsetting into Qualia over several years.                                                                                                                                               |
| SoftPro                                | SoftPro (Delta Solutions)  | None advertised                                                                                                                                                                                                                                                      | ~14,000 customer sites, 60,000 users. Largest installed base. ([Premier One review](https://premier-one.com/the-best-title-production-software-in-2023/))                                                  |
| TitlePoint                             | Black Knight / ICE         | Title-plant search; not CEMA-specific workflow but useful for assignment chain investigation. ([TitlePoint](https://www.titlepoint.com/TitlePoint/About.aspx))                                                                                                       | Source data, not workflow.                                                                                                                                                                                 |
| TitleWave                              | FNF (Fidelity)             | Title search ordering portal. No CEMA-specific feature. ([TitleWave](https://www.titlewaveres.com/home))                                                                                                                                                             | Coverage in NY, 30+ states.                                                                                                                                                                                |
| E-Closing                              | E-Closing                  | None advertised                                                                                                                                                                                                                                                      | Mid-market title production.                                                                                                                                                                               |
| CloseSimple                            | CloseSimple                | Integrations on top of SoftPro/ResWare/RamQuest; communications + wire-fraud + fraud detection. No CEMA feature. ([CloseSimple](https://www.closesimple.com/))                                                                                                       | Add-on, not standalone.                                                                                                                                                                                    |

**CEMA-relevance rating: 2/5.** Title platforms host the workflow but treat CEMA as a free-text task list and document checklist. Strong opportunity for an embedded NY-CEMA module or Qualia-integration partner.

### 1.3 Document Automation / Closing-Doc Generation

| Product                     | Vendor               | CEMA Support                                                                                                                                                                                                                                         | Notes                                                                                               |
| --------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| DocMagic                    | DocMagic             | Generates Form 3172 (NY CEMA) and supporting consolidated note/mortgage/Schedule A. Compliance announcement archive references CEMA changes since 2008. ([DocMagic ML 08-26](https://www.docmagic.com/compliance/regulatory-announcements/ml-08-26)) | 300,000+ form library. Highest commodity CEMA-document support. Form generation only — no workflow. |
| IDS (Mortgage Cadence)      | Wolters Kluwer       | Likely generates Form 3172 (industry-standard form). Not advertised as a differentiator.                                                                                                                                                             | Commodity.                                                                                          |
| Asurity (Mavent / RegCheck) | Asurity Technologies | Compliance testing of loan docs; supports state-specific tests. Not a CEMA module. ([Asurity](https://www.asurity.com/))                                                                                                                             | Compliance, not workflow.                                                                           |

**CEMA-relevance rating: 3/5 for forms generation specifically, 1/5 for workflow.** The CEMA document set itself (Form 3172, consolidated note, Schedule A, allonges, assignment of mortgage) is fully commoditized at the document-generation layer. A new entrant should not try to compete on forms — they should integrate DocMagic.

### 1.4 Mortgage POS / Borrower-Facing

| Product                                   | Vendor                 | CEMA Support                                                                                                                                                                                                                                    | Notes                                                                                                              |
| ----------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Blend                                     | Blend Labs             | None advertised                                                                                                                                                                                                                                 | Enterprise POS for banks/IMBs.                                                                                     |
| Maxwell                                   | Maxwell Financial Labs | None advertised                                                                                                                                                                                                                                 | SMB lender POS.                                                                                                    |
| Floify                                    | Floify (ICE)           | None advertised                                                                                                                                                                                                                                 | Broker / small-lender POS. ([Floify](https://floify.com/))                                                         |
| BeSmartee                                 | BeSmartee              | None advertised                                                                                                                                                                                                                                 | POS + Edge platform.                                                                                               |
| Roostify (now CoreLogic Digital Mortgage) | CoreLogic              | None advertised                                                                                                                                                                                                                                 |                                                                                                                    |
| Better.com                                | Better Holdco          | "Auto-converts refinance application into CEMA" but execution is manual attorney-led. ~3 business days to confirm savings; 2–6 weeks to obtain approval from prior lender. ([Better CEMA guide](https://better.com/content/ny-guide-cema-loan)) | The most CEMA-aware consumer mortgage lender in market, but their tech is just "flag the loan as CEMA in our LOS." |
| Quontic                                   | Quontic Bank           | NY-focused digital bank; offers CEMA via standard workflow. ([Quontic](https://www.quontic.com/))                                                                                                                                               | Lender, not software.                                                                                              |

**CEMA-relevance rating: 1/5.** No POS surfaces CEMA-savings calculations to the borrower in pre-qual in a structured way. Lenders that handle CEMA explain it after application via attorney/LO.

### 1.5 Document Understanding / IDP

Used inside lenders/servicers to read documents. None has a CEMA-specific extraction template marketed publicly.

| Product                             | Vendor       | CEMA Support                                                                                                                                                                                                                                    | Notes                                                                              |
| ----------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Hyperscience                        | Hyperscience | Generic mortgage IDP. Partnered with Plus Platform. ([Hyperscience IDP](https://www.hyperscience.ai/resource/intelligent-document-processing/))                                                                                                 | Enterprise, expensive.                                                             |
| Rossum                              | Rossum       | Transactional-LLM model for multi-doc workflows.                                                                                                                                                                                                | Promising for assignment-chain extraction.                                         |
| Indico Data                         | Indico       | Insurance / underwriting focus.                                                                                                                                                                                                                 |                                                                                    |
| ABBYY Vantage                       | ABBYY        | Strong on extraction accuracy, long-form docs.                                                                                                                                                                                                  | Enterprise.                                                                        |
| AWS Textract + Analyze Lending API  | Amazon       | Mortgage-specific API (classification & extraction). Rocket Close uses Textract + Bedrock. ([AWS](https://aws.amazon.com/blogs/machine-learning/rocket-close-transforms-mortgage-document-processing-with-amazon-bedrock-and-amazon-textract/)) | Best price/perf for a new entrant.                                                 |
| Azure Document Intelligence         | Microsoft    | Generic + custom models.                                                                                                                                                                                                                        | Comparable to AWS.                                                                 |
| Sensible.so                         | Sensible     | Document-extraction primitives for developer teams.                                                                                                                                                                                             | Developer-friendly; LLM-first.                                                     |
| Reducto                             | Reducto      | High-accuracy document parsing API; LLM-first.                                                                                                                                                                                                  | Newer entrant; popular with AI-native fintechs.                                    |
| Vaultedge                           | Vaultedge    | Mortgage-specific IDP. Lists assignment, allonge, payoff among supported docs.                                                                                                                                                                  | Closest to CEMA needs out-of-box.                                                  |
| Indecomm DecisionGenius / IDXGenius | Indecomm     | "Zero-touch" automation with 98–99% data extraction accuracy on mortgage docs; backed by 1,500-person BPO. No CEMA-specific product. ([Indecomm](https://indecomm.com/))                                                                        | Reads as the BPO-plus-AI competitor; can compete on price + accuracy if motivated. |

**CEMA-relevance rating: 2/5.** Extraction is commoditized. None of these vendors has trained models specifically on CEMA document sets (Form 3172, consolidated note, Schedule A mortgage chains, NY allonges). A new entrant can fine-tune in days.

### 1.6 Servicing / Payoff / Assignment Tools

The prior servicer is the bottleneck in every CEMA. None of these tools is built to _respond_ to incoming CEMA assignment requests, only to manage their own loan book.

| Product                                            | Vendor                      | CEMA Support                                                                                                                                                                                                                                                                           | Notes                                                                                                                                               |
| -------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sagent                                             | Sagent Lending Technologies | Generic loan servicing.                                                                                                                                                                                                                                                                | Newer, cloud-native.                                                                                                                                |
| Black Knight MSP (now ICE Mortgage Servicing)      | ICE                         | The market-dominant servicing system. No CEMA-incoming workflow. ([Black Knight MSP](https://www.blackknightinc.com/products/msp-loan-servicing-system/))                                                                                                                              | This is where most CEMA-assignment-document requests get stuck.                                                                                     |
| FICS Mortgage Servicer                             | FICS                        | Bank/CU servicing.                                                                                                                                                                                                                                                                     |                                                                                                                                                     |
| LoanServ / Fiserv                                  | Fiserv                      |                                                                                                                                                                                                                                                                                        |                                                                                                                                                     |
| Closinglock (payoff)                               | Closinglock                 | Automated payoff statement retrieval; insured up to $5M. ~125 hrs/month saved per customer. Lender logos include Chase, Wells Fargo, Mr. Cooper, Rocket. **Does NOT advertise assignment retrieval or CEMA.** ([Closinglock](https://www.closinglock.com/automated-payoff-retrieval/)) | Validates that an outside vendor can automate a multi-lender "ask servicer for something" workflow. Strong template for a CEMA-assignment AI agent. |
| MetaSource Eclipse (AOM + Lien Release)            | MetaSource                  | Proprietary software for assignment-of-mortgage and lien-release generation across all 50 states + 3,600 recording offices. ([MetaSource AOM](https://mortgage.metasource.com/solutions/assignment-of-mortgage-service/))                                                              | This is the servicer-side outbound AOM tool. **Not CEMA-specific** but the most adjacent product in the market.                                     |
| NTC (Nationwide Title Clearing, a Covius solution) | Covius                      | Assignment Verification Reports, AOM execution, exception curative. ([NTC](https://nationwidetitleclearing.com/assignments-of-mortgage/))                                                                                                                                              | Industrial scale. Post-closing focus.                                                                                                               |

**CEMA-relevance rating: 2/5.** The servicing-side automation (MetaSource Eclipse, NTC, Closinglock) is squarely adjacent — these vendors are already executing assignment-of-mortgage workflows but on the _outbound_ side (servicer releasing) rather than the _inbound_ side (new lender requesting). They are likely defensive M&A targets if a CEMA-AI startup gains traction.

### 1.7 AI-Native Mortgage Startups (2023–2026)

| Product                                | Vendor                         | CEMA Support                                                                                                                                                                                                                                                                                                                                      | Notes                                                                                                                     |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Chestnut                               | Chestnut (YC)                  | None mentioned. SF-based; "the first AI mortgage lender," AI-broker model, "0.5%+ lower rate." ([Chestnut](https://chestnutmortgage.com/), [YC](https://www.ycombinator.com/companies/chestnut))                                                                                                                                                  | Vertical mortgage lender, not infra. Could add CEMA as a feature for NY borrowers.                                        |
| Copperlane (YC W26)                    | Copperlane                     | "Penny" AI agent for borrower intake / verification / pricing. No CEMA-specific mention. ([Copperlane](https://www.copperlane.ai/))                                                                                                                                                                                                               | Generic origination AI.                                                                                                   |
| Ralo (Approval.AI)                     | YC                             | Mortgage shopping / negotiation; not CEMA-specific.                                                                                                                                                                                                                                                                                               |                                                                                                                           |
| Tavant TOUCHLESS                       | Tavant                         | "End-to-end AI origination": MAYA AI assistant, AI doc analysis, agentic workflows. Oct 2025 launch. Pilot results claim 12x underwriter productivity, 60% lower ops cost. No CEMA mention. ([Tavant TOUCHLESS](https://www.businesswire.com/news/home/20251020910653/en/Tavant-Launches-Transformative-TOUCHLESS-AI-Mortgage-Origination-Suite)) | The most strategically threatening enterprise vendor — they could ship a CEMA agent inside TOUCHLESS if a customer asked. |
| LoanLogics (LoanBeam)                  | Sourcepoint/LoanLogics         | Income / doc validation automation. No CEMA. ([LoanLogics](https://www.loanlogics.com/products/loanbeam-origination-technologies/))                                                                                                                                                                                                               |                                                                                                                           |
| Maxwell AI                             | Maxwell                        | LO-productivity AI. No CEMA.                                                                                                                                                                                                                                                                                                                      |                                                                                                                           |
| Sagent AI / Cloudvirga / FundingShield | Multiple                       | Servicing AI / digital POS / wire-fraud. No CEMA. ([FundingShield](https://www.fundingshield.com/))                                                                                                                                                                                                                                               |                                                                                                                           |
| AngelAi                                | Celligence / Sun West Mortgage | Consumer-ready AI assistant; broker tool for "TRU Approvals." No CEMA mention. ([AngelAi](https://www.angelai.com/brokerai/))                                                                                                                                                                                                                     |                                                                                                                           |
| Kastle                                 | Kastle                         | AI voice agents for consumer lending — collect payments, qualify inquiries. ([Kastle](https://www.kastle.ai/))                                                                                                                                                                                                                                    | Voice-AI prior-art; not CEMA-aware.                                                                                       |
| Salient                                | Trysalient                     | AI voice agents for consumer lending. ([Salient](https://www.trysalient.com/))                                                                                                                                                                                                                                                                    | Voice-AI prior-art.                                                                                                       |
| Conduit                                | Conduit                        | AI voice/email/text for servicing — including managing payoffs.                                                                                                                                                                                                                                                                                   | The exact stack a CEMA AI agent would use to call prior servicers.                                                        |

**CEMA-relevance rating: 1/5.** Zero AI-native mortgage startup is targeting CEMA. Voice-AI primitives are commoditizing rapidly (Kastle / Salient / Conduit / Retell / Marr Labs all viable) — that means building "the AI that calls the prior servicer" is a 2–4-week build on top of an existing voice-agent platform, not a moat by itself.

### 1.8 NY-Specific / Boutique CEMA Tools

This is the most-searched category and the most disappointing — none are workflow products.

| Product                                                                                 | Vendor                                    | CEMA Support                                                                                                                                                                                           | Notes                                                                                                 |
| --------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Byson Purchase CEMA Calculator                                                          | Byson Real Estate (Long Island brokerage) | **Calculator only.** Lead-gen for their brokerage. ([Byson calculator](https://byson.io/purchase-cema-calculator))                                                                                     | Single-page tool.                                                                                     |
| Hauseit Purchase CEMA Calculator                                                        | Hauseit                                   | Calculator + content marketing. ([Hauseit](https://www.hauseit.com/purchase-cema-savings-calculator-nyc/))                                                                                             | Lead-gen.                                                                                             |
| CATICulator                                                                             | CATIC                                     | Premium calculator for title agents; includes CEMA. ([CATICulator](https://www.caticulator.com/PremiumCalculator/Form?stateCode=NY))                                                                   | Title-insurance underwriter tool.                                                                     |
| Better.com CEMA Guide                                                                   | Better.com                                | Content + auto-flagging. Not standalone software. ([Better.com guide](https://better.com/content/ny-guide-cema-loan))                                                                                  |                                                                                                       |
| Horizon Land Services CEMA / Assignment & Subordination Services                        | Horizon Land Services NY                  | **Manual service** with relationship-based document chase. 20+ years operating. No software product. ([Horizon](https://horizonlandservices.com/cms/cemaassignment-subordination-services/index.html)) | Direct competitor to the labor model the client is trying to displace. They sell hours, not software. |
| Adam Leitman Bailey, Friedman Vartolo, Andelsman Law, Zimmet Law, CPL Law, Febbraio Law | Various NY firms                          | Manual attorney services. ([Friedman Vartolo](https://friedmanvartolo.com/what-is-a-cema/), [Adam Leitman Bailey](https://alblawfirm.com/case-studies/save-with-cema/))                                | The attorneys who own CEMA today.                                                                     |

**CEMA-relevance rating: 5/5 for marketing-page calculators, 0/5 for workflow software.** Every "CEMA solution" online is a calculator. There is no SaaS workflow product. This is the central white-space finding.

### 1.9 County Recording Integrations

| Product                           | Vendor                  | CEMA Support                                                                                                                                                               | Notes                                                                                                                 |
| --------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| NYC ACRIS                         | NYC Dept. of Finance    | Direct e-recording for Manhattan, Bronx, Brooklyn, Queens. Public open-data API. ([ACRIS](https://a836-acris.nyc.gov/CP/), [NYC API portal](https://api-portal.nyc.gov/))  | Required for any NYC closing. Public open data of recorded mortgages — usable as a free assignment-chain data source. |
| Simplifile                        | ICE Mortgage Technology | E-recording network including NY. Covers 90%+ of US population. ([Simplifile NY](https://mortgagetech.ice.com/products/simplifile/erecording/erecording-network/new-york)) | Dominant.                                                                                                             |
| CSC eRecording                    | CSC                     | Competitor to Simplifile.                                                                                                                                                  |                                                                                                                       |
| ePN (eRecording Partners Network) | ePN                     | Competitor to Simplifile.                                                                                                                                                  |                                                                                                                       |

**CEMA-relevance rating: 3/5.** Recording is solved by Simplifile-equivalents. ACRIS's open-data API for the five boroughs is a strategic asset for a new entrant — the entire NY mortgage record back to 1966 is free and queryable.

### 1.10 General Workflow / RPA

| Product                          | Vendor | CEMA Support                                                                                                                                                                                                                                                                        | Notes                   |
| -------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| UiPath Home Mortgage Accelerator | UiPath | Pre-built RPA for mortgage; PRMG, UWM case studies. No CEMA case study. ([UiPath PRMG](https://www.uipath.com/resources/automation-case-studies/prmg), [UWM](https://www.uipath.com/resources/automation-case-studies/uwm-accelerates-loan-processing-with-document-understanding)) | DIY RPA, not a product. |
| Automation Anywhere              | AA     | Generic RPA. No CEMA case study found.                                                                                                                                                                                                                                              | DIY.                    |

**CEMA-relevance rating: 1/5.** RPA + a lender's own dev team could automate CEMA _internally_ — but no off-the-shelf solution.

---

## 2. Patent / IP Landscape

USPTO and Google Patents searches turn up nothing specifically claiming CEMA software. Adjacent prior art:

- **US20080103960A1** — Web-based debt-consolidation tool (generic). No CEMA claims.
- **US8595130B2** — "Modifiable mortgage" — term-modification financial instrument; financial-product patent, not workflow.
- **US8990254B2** — Loan-origination distributed-network patent (generic mortgage origination).
- **USRE47762E1** — Computerized home-sale / mortgage / settlement processes — broad refinancing process patent.
- **US20150026035A1** — Data-analytics model for loan modifications (mod, term ext., principal reduction).

**Verdict:** No CEMA-specific defensive patents exist. The financial instrument itself is governed by NY Tax Law §§ 253, 255 (statutory, not patentable). The workflow ("ask prior lender for the original note, build Schedule A, file Form 3172") is procedural and not novel as a patentable claim. Trademark search returned no "CEMA"-as-software registrations. **IP risk is low; defensive patenting around a CEMA-AI orchestration agent may be worthwhile as a moat-building exercise.**

Sources: [Google Patents search](https://patents.google.com/), [USPTO patent search](https://www.uspto.gov/patents/search), [FHFA Form 3172](https://www.fhfa.gov/mortgage-translations/document/authorized-changes-for-new-york-consolidation-extension-and-modification-agreement-ny-cema-form-3172).

---

## 3. Gap Analysis

### What every existing product does well

- **Document generation of the NY CEMA Form 3172** — fully commodified by DocMagic / IDS / Mortgage Cadence; do not rebuild.
- **Mortgage-tax calculation in NY** — multiple free calculators exist (Byson, Hauseit, CATIC, Better, Rocket).
- **E-recording** — Simplifile / CSC / ePN; ACRIS API for NYC is free.
- **Payoff statement retrieval** — Closinglock + Qualia Shield Automated Payoff Agent solved this in 2024–2025 with AI agents.
- **Outbound assignment-of-mortgage generation** (servicer side) — MetaSource Eclipse, NTC.
- **Generic OCR/IDP for mortgage docs** — Hyperscience, Vaultedge, Textract Lending API.
- **Voice-AI for routine servicer calls** — Kastle, Salient, Conduit, ICE Mortgage Servicing's voice agent.
- **Title workflow coordination** — Qualia, SoftPro.
- **LOS loan-file management** — Encompass etc.

### What NO existing product does

1. **End-to-end orchestration of a CEMA loan.** No platform sequences the multi-party choreography (borrower ⇄ broker ⇄ title agent ⇄ new lender's attorney ⇄ prior servicer ⇄ prior servicer's attorney ⇄ recorder).
2. **AI agent that _receives the inbound CEMA request_ at the prior servicer.** Closinglock and Qualia Shield automate the _outgoing_ ask. Nothing on the incoming side.
3. **Structured extraction of the prior mortgage chain from ACRIS + the title commitment** to auto-build Schedule A.
4. **Auto-drafting Form 3172, the consolidated note, Schedule A, the allonge, and the assignment of mortgage with cross-document consistency checks.** DocMagic generates each one in isolation; nobody enforces that the numbers tie.
5. **Borrower-facing CEMA-savings surfaced in the pre-qual / pricing flow with a "purchase CEMA vs. refi CEMA vs. no CEMA" decision UX.**
6. **Audit trail of every CEMA-specific document hand-off with SLA tracking against the prior servicer.**
7. **A pipeline dashboard for the _processor_ role** — explicitly the labor the client wants to displace.
8. **NY-specific compliance checks (NYS MT-15, MT-15.1, §253/§255 calculation reconciliation, $10,000 residential deduction).**
9. **AI voice/email agent specifically trained on CEMA-document-request scripts** (different from payoff scripts).
10. **Integration with NYC ACRIS / Westchester / Nassau / Suffolk recording systems for both pre-CEMA mortgage-chain discovery _and_ post-CEMA recording.**

### What ONE product does, but poorly (acquisition / displacement targets)

- **Horizon Land Services** — manual NY-only assignment & subordination service. Replicates exactly the labor model the client wants to displace. Likely 5–25 FTEs; potential acqui-target or competitive displacement.
- **MetaSource Eclipse** — built the engine for outbound AOM; could pivot inbound. Most defensible incumbent if motivated.
- **Closinglock Automated Payoff** — proves the AI-agent pattern works on prior-servicer outreach for a different document. They could add an "Automated Assignment Agent" within 6–12 months if the market signals value. Highest competitive risk among adjacent vendors.
- **Qualia Shield** — same logic. Most strategic competitor because they own the title-side workflow.

### White-space opportunities for an AI-native CEMA product

1. **The "CEMA Pipeline" itself** — an opinionated case-management UI for the CEMA processor role, surfacing SLA risk on every file.
2. **AI voice + email agent** that calls/emails prior servicers' loss-mit / payoff / assignment desks with CEMA-document request packets and follow-up cadence.
3. **AI document-set generator** that reads the title commitment and prior ACRIS records, auto-builds Schedule A, drafts Form 3172, allonge, consolidated note, and AOM with reconciliation.
4. **Borrower portal** showing CEMA savings up front, status milestones, and document-collection requests in plain language.
5. **Integrations:** Encompass / LendingPad LOS, Qualia / SoftPro / ResWare title, DocMagic / IDS docs, Closinglock for payoff, Simplifile / ACRIS for recording.
6. **NY-only specialization → expansion to similar instruments**: Florida wraparound mortgages, Massachusetts homestead amendments, and select state-specific tax-saving structures.

---

## 4. Uniqueness Scoring of Common CEMA-Automation Features

Scale: **Commodity (do not build / integrate instead)** → **Differentiated (table stakes for credibility)** → **Genuinely novel (defensible)**.

| Feature                                                                                                             | Status                                                                | Rationale                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CEMA savings calculator                                                                                             | **Commodity**                                                         | Byson, Hauseit, Better, CATIC, Rocket all publish free calculators. Treat as marketing surface, not product.                                                                |
| Form 3172 / Schedule A auto-generation                                                                              | **Commodity (delivery)**, **Differentiated (integration)**            | DocMagic / IDS generate them. Novelty is in _populating them automatically_ from the prior mortgage chain + title commitment without human keying.                          |
| Consolidated note + allonge + AOM drafting                                                                          | **Differentiated**                                                    | Generated in isolation today; cross-document consistency checks are uncommon and valuable.                                                                                  |
| Document extraction from prior mortgage PDFs                                                                        | **Commodity infrastructure**, **Differentiated training data**        | Textract / Sensible / Reducto can do it; nobody publishes a CEMA-tuned model. Fine-tune on NY mortgages = small moat.                                                       |
| AI agent calling prior servicer for payoff                                                                          | **Commodity**                                                         | Closinglock, Qualia Shield, Kastle, Salient, Conduit all do this in 2025–2026.                                                                                              |
| AI agent calling prior servicer for **CEMA assignment package** (note, allonge, mortgage assignment, payoff letter) | **Genuinely novel**                                                   | Distinct script, distinct department contact, escalation playbooks, different SLAs. No vendor advertises this today. **This is the highest-leverage build.**                |
| Pipeline dashboard / case-management for CEMA processor                                                             | **Differentiated**                                                    | Generic case-management exists (Qualia tasks, Salesforce); CEMA-specific milestones, deadlines tied to §253/§255 tax filings, and assignment-chain risk scoring are unique. |
| NYS-261 / MT-15 auto-generation                                                                                     | **Differentiated**                                                    | Forms are public; nobody automates the math + form-fill + e-file end-to-end. The §253/§255 tax math + $10,000 residential deduction is fiddly.                              |
| E-recording integration (Simplifile / ACRIS)                                                                        | **Commodity**                                                         | Simplifile is a buy. ACRIS API is free.                                                                                                                                     |
| Audit trail                                                                                                         | **Commodity**                                                         | Every modern SaaS does this.                                                                                                                                                |
| Borrower portal                                                                                                     | **Commodity infrastructure**, **Differentiated for CEMA-specific UX** | POS vendors solved generic portal; surfacing CEMA savings + assignment-chain progress is novel UX.                                                                          |
| Voice-AI prior-servicer outreach + email + fax fallback                                                             | **Differentiated**                                                    | The fax-fallback is real and unloved. Many prior servicer assignment departments only accept fax or USPS.                                                                   |
| Integration with NYC ACRIS for mortgage-chain pre-discovery                                                         | **Genuinely novel**                                                   | Public data, nobody pre-fetches it for CEMA workflows. Could detect assignability _before_ the borrower applies.                                                            |
| Purchase-CEMA pre-qual surfacing in POS                                                                             | **Genuinely novel**                                                   | Better.com auto-flags after application; no one surfaces it pre-qual based on the _seller's_ mortgage. ACRIS makes this possible.                                           |

---

## 5. Recommended Differentiation Angles

A new entrant should defend on three legs, not one:

1. **"The CEMA AI processor"** — agent + workflow purpose-built for the labor category. Not a generic LOS, not a generic title platform. The narrative "we replace 2–3 processors per lender" is concrete and underwriteable.

2. **"The prior-servicer fetcher"** — AI voice + email + fax agent specialized in extracting CEMA-assignment packages (note, allonge, AOM, payoff) from the top 30 servicers that hold NY mortgages: Mr. Cooper, Pennymac, Chase, Wells Fargo, Rocket, US Bank, Bank of America, Lakeview, Freedom Mortgage, Newrez, Truist, NYCB / Flagstar, Citizens, M&T, etc. Build a per-servicer playbook library — that _is_ the moat over 12–24 months.

3. **"The NY-stack integration"** — pre-built integrations with NYC ACRIS, Westchester / Nassau / Suffolk / Erie / Monroe recording, NY DTF tax forms (MT-15, MT-15.1, NYS-261 where applicable), Simplifile, DocMagic, the top three NY title agents (Stewart, FNF, Old Republic), the top NY LOS (Encompass, LendingPad), Qualia.

**Additional defensibility:**

- Training data: every closed CEMA file becomes a fine-tune sample; per-servicer success-rate benchmarks become a sales asset.
- Network effects: the _more_ prior-servicer playbooks built, the harder for a generic vendor to catch up.
- Geographic moat: NY-only is a feature, not a bug — Encompass / Tavant won't build NY-specific UX, and that's the gap.
- Regulatory expertise: §253 / §255 math, mortgage-recording tax in NYC vs. non-NYC NY, $10,000 residential deduction. Easy to get wrong; visible in the closing disclosure.
- "Acqui-bait" — design the product so Qualia, ICE, MetaSource, or Closinglock would credibly pay to absorb it in 24–36 months.

---

## 6. Open Questions for the Project Owner

1. **Who is the primary buyer — lender, title agent, or law firm?** Each has different willingness-to-pay, different ROI math, different integration paths. The 2–3 processors to displace likely sit at a lender; but the closing attorneys are the gatekeepers. Pick one to start.
2. **What is the existing customer base / pipeline?** Are there 1–3 NY lenders or title agents who would design-partner? Without a CEMA-volume design partner, training data is the bottleneck.
3. **Refi-CEMA only, or also Purchase-CEMA?** Purchase-CEMAs involve seller's mortgage + seller's lender — different sales motion (must also engage selling-side broker/attorney), different (higher) average savings, but lower volume.
4. **Build vs. buy on voice-AI infrastructure?** Kastle, Salient, Conduit, Retell AI, Marr Labs all offer voice-agent infra. The product moat is the per-servicer playbooks + script library + escalation rules, _not_ the voice engine. Recommend a buy-then-extend posture; pivot to ElevenLabs / OpenAI Realtime / Anthropic voice if open-source / model-provider voice matures.
5. **Document extraction approach?** Build on Sensible / Reducto / Textract Lending API for speed-to-market; fine-tune a small open model (Llama / Qwen) on NY mortgage chains later for cost + moat.
6. **Tolerance for being a wedge feature inside a partner like Qualia or Encompass?** Embedded distribution accelerates revenue; standalone preserves equity. Pick.
7. **What is the realistic CEMA volume?** NY annual refinance volume × CEMA-eligible % × CEMA-adoption %. Need to size TAM credibly — public data via ACRIS and NY DTF mortgage-recording-tax receipts.
8. **Has anyone mapped the assignment-department contact playbook at the top 20 NY-loan-holding servicers already?** If yes, that internal artifact is the MVP; if no, that's week-1 work.
9. **Legal/UPL risk** — does generating an AOM and Form 3172 without an attorney's signature constitute the unauthorized practice of law in NY? Need a real estate / bar-counsel opinion before launch. (Some closing services skirt this via "attorney-supervised" or "attorney-as-customer" framings.)
10. **What's the exit thesis?** If acqui-target → optimize for Qualia / ICE / MetaSource fit. If standalone → optimize for multi-state expansion of similar tax-saving instruments and toward an integrated NY-real-estate-closing platform.

---

## Appendix: Source Inventory

**Foundational / regulatory**

- [FHFA Form 3172 NY CEMA](https://www.fhfa.gov/mortgage-translations/document/authorized-changes-for-new-york-consolidation-extension-and-modification-agreement-ny-cema-form-3172)
- [NY DTF Mortgage Recording Tax](https://www.tax.ny.gov/pit/mortgage/mtgidx.htm)
- [NYS DFS OGC Opinion 08-04-17 (mortgage tax guarantee)](https://www.dfs.ny.gov/insurance/ogco2008/rg080417.htm)
- [NYC Property Recording (ACRIS)](https://www.nyc.gov/site/finance/property/property-recording-property-related-documents.page)
- [Freddie Mac CEMA delivery requirements](https://help.sf.freddiemac.com/loan-advisor/lsa/doccust/docsfmreqs_certnycemadel.htm)
- [AAPL — Complexities of NY CEMA Loans](https://aaplonline.com/articles/uncategorized/understanding-the-complexities-of-new-yorks-cema-loans/)

**LOS / origination**

- [ICE Mortgage Technology Encompass](https://mortgagetech.ice.com/index)
- [Calyx Point / PointCentral](https://www.calyxsoftware.com/products/point/point-central)
- [LendingPad](https://lendingpad.com/kb/migratedata)
- [Vesta](https://www.vesta.com/)
- [Pennymac selects Vesta — Sept 2025](https://pfsi.pennymac.com/news-events/press-releases/news-details/2025/Pennymac-Selects-Vesta-to-Supercharge-Its-Mortgage-Platform-Setting-a-New-Industry-Standard-in-Origination-Technology/default.aspx)
- [Polly AI announcement May 2025](https://www.businesswire.com/news/home/20250515114595/en/Polly-Further-Advances-its-Unrivaled-LO-Experience-with-Full-Mobile-Capabilities-and-AI-powered-Automation)

**Title platforms**

- [Qualia](https://www.qualia.com/)
- [Qualia Shield Automated Payoff Agent](https://blog.qualia.com/qualia-shield-automates-the-mortgage-payoff-process/)
- [Qualia acquires RamQuest — Jan 2025](https://www.certifid.com/article/title-production-software)
- [SoftPro overview](https://premier-one.com/the-best-title-production-software-in-2023/)
- [CloseSimple](https://www.closesimple.com/)
- [TitlePoint](https://www.titlepoint.com/TitlePoint/About.aspx)
- [TitleWave](https://www.titlewaveres.com/home)

**Document / compliance**

- [DocMagic CEMA / ML 08-26](https://www.docmagic.com/compliance/regulatory-announcements/ml-08-26)
- [DocMagic homepage](https://www.docmagic.com/)
- [Asurity](https://www.asurity.com/)

**POS**

- [Floify](https://floify.com/)
- [Better.com CEMA guide](https://better.com/content/ny-guide-cema-loan)
- [Quontic](https://www.quontic.com/)

**IDP / AI**

- [Hyperscience IDP](https://www.hyperscience.ai/resource/intelligent-document-processing/)
- [AWS Rocket Close case study](https://aws.amazon.com/blogs/machine-learning/rocket-close-transforms-mortgage-document-processing-with-amazon-bedrock-and-amazon-textract/)
- [Amazon Textract Analyze Lending](https://docs.aws.amazon.com/textract/latest/dg/lending-document-classification-extraction.html)
- [Indecomm DecisionGenius](https://indecomm.com/product/decisiongenius/)
- [Indecomm homepage](https://indecomm.com/)

**Servicing / assignment / payoff**

- [Closinglock Automated Payoff](https://www.closinglock.com/automated-payoff-retrieval/)
- [Closinglock acquires Viking Sasquatch — HousingWire](https://www.housingwire.com/articles/closinglock-adds-automated-payoff-ordering-to-combat-real-estate-title-fraud/)
- [MetaSource AOM service](https://mortgage.metasource.com/solutions/assignment-of-mortgage-service/)
- [MetaSource Eclipse software](https://mortgage.metasource.com/technology/eclipse/)
- [NTC (a Covius solution) — Assignments of Mortgage](https://nationwidetitleclearing.com/assignments-of-mortgage/)
- [NTC Assignment Verification Reports](https://nationwidetitleclearing.com/assignment-verification/)
- [Black Knight / ICE MSP](https://www.blackknightinc.com/products/msp-loan-servicing-system/)

**AI-native mortgage startups**

- [Chestnut](https://chestnutmortgage.com/) and [YC profile](https://www.ycombinator.com/companies/chestnut)
- [Copperlane](https://www.copperlane.ai/)
- [Tavant TOUCHLESS launch](https://www.businesswire.com/news/home/20251020910653/en/Tavant-Launches-Transformative-TOUCHLESS-AI-Mortgage-Origination-Suite)
- [Tavant PRMI case study](https://www.businesswire.com/news/home/20260317275236/en/Tavant-Enables-Vast-Efficiency-Improvement-at-PRMI-with-TOUCHLESS-AI-Mortgage-Automation-Platform)
- [LoanLogics LoanBeam](https://www.loanlogics.com/products/loanbeam-origination-technologies/)
- [AngelAi](https://www.angelai.com/brokerai/)
- [Kastle](https://www.kastle.ai/)
- [Salient](https://www.trysalient.com/)
- [HousingWire — ICE mortgage AI voice/chat](https://www.housingwire.com/articles/ice-ai-voice-chat-servicing/)

**NY-specific / boutique**

- [Byson Purchase CEMA Calculator](https://byson.io/purchase-cema-calculator)
- [Hauseit Purchase CEMA calculator](https://www.hauseit.com/purchase-cema-savings-calculator-nyc/)
- [Hauseit NYC Mortgage Recording Tax calculator](https://www.hauseit.com/nyc-mortgage-recording-tax-calculator/)
- [CATICulator NY](https://www.caticulator.com/PremiumCalculator/Form?stateCode=NY)
- [Horizon Land Services — CEMA / Assignment & Subordination](https://horizonlandservices.com/cms/cemaassignment-subordination-services/index.html)
- [Friedman Vartolo — What is a CEMA?](https://friedmanvartolo.com/what-is-a-cema/)
- [Andelsman Law — CEMA Attorney](https://andelsmanlaw.com/cema-attorney-consolidation-ny-real-estate/)
- [Adam Leitman Bailey — Saving with a CEMA Refi](https://alblawfirm.com/case-studies/save-with-cema/)
- [Adam Leitman Bailey — Purchase CEMA](https://alblawfirm.com/case-studies/purchase-cema/)

**Recording integrations**

- [Simplifile NY](https://mortgagetech.ice.com/products/simplifile/erecording/erecording-network/new-york)
- [NYC ACRIS main](https://a836-acris.nyc.gov/CP/)
- [NYC API portal](https://api-portal.nyc.gov/)
- [ACRIS Real Property Master (NYC Open Data)](https://data.cityofnewyork.us/City-Government/ACRIS-Real-Property-Master/bnx9-e6tj)

**RPA**

- [UiPath PRMG case study](https://www.uipath.com/resources/automation-case-studies/prmg)
- [UiPath UWM case study](https://www.uipath.com/resources/automation-case-studies/uwm-accelerates-loan-processing-with-document-understanding)

**Patent landscape**

- [Google Patents](https://patents.google.com/)
- [USPTO patent search](https://www.uspto.gov/patents/search)
- [US8595130B2 — Modifiable mortgage](https://patents.google.com/patent/US8595130)
- [USRE47762E1 — Computerized home sale/mortgage/settlement](https://patents.google.com/patent/USRE47762E1/en)
- [US20080103960A1 — Debt consolidation web tool](https://patents.google.com/patent/US20080103960)
