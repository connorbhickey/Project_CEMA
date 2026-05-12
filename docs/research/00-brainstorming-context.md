# CEMA Project — Brainstorming Context (Saved)

> Captured during initial brainstorming on 2026-05-12 before pivoting to "AI replaces 2–3 CEMA processors" framing.
> This file preserves earlier framing decisions so we don't lose them.

---

## What is CEMA?

**Consolidation, Extension, and Modification Agreement** — a New York State-exclusive
mortgage instrument. When a borrower refinances or purchases, instead of recording a brand-new
mortgage (and paying the full NYS Mortgage Recording Tax of ~1.8–2.05% depending on county),
the new lender takes assignment of the existing mortgage from the old lender, then a CEMA
"gaps" the difference between the existing balance and the new loan amount. Tax is paid only on
the *gap*, not the full new loan.

**Why it matters:** On a $700k refi where the existing loan balance is $500k, the borrower
saves roughly **$3,600–$4,100** in recording tax. Real, immediate, ROI-positive savings.

**Why it's painful in practice:**

- Prior lender must cooperate (assignment of mortgage). Often slow, sometimes refuses.
- Coordination across borrower, broker, title, attorneys, prior servicer, new lender.
- Document-heavy: Consolidation Agreement, consolidated note, allonge, assignment of mortgage,
  gap mortgage/note, NYS-261 (mortgage recording tax form).
- Errors trigger re-recording fees and county-clerk rejections.
- Geographically/legally specific (NYS only, county-level variations).

---

## Original Brainstorming Framing (Now Superseded)

We initially scoped this as a **multi-role workflow SaaS** for:

- Mortgage loan officers / brokers
- CEMA specialists
- Data entry clerks
- Title agents and attorneys
- Lenders
- Other office workers in the CEMA workflow

Identified pain points:

- **A. Quoting & qualification** — fast accurate "how much will you save?"
- **B. Pipeline / case management** — track every CEMA in flight, see what's stuck
- **C. Document preparation & automation** — generate CEMA package from data
- **D. Inter-party coordination** — chasing the prior lender's CEMA team
- **E. Compliance / audit trail** — NYS DTF, title insurance, investor guidelines

User picked **F: all equally broken, integrated platform from day one**, with A/B/C
as most painful.

### Key architectural insight (still valid under new framing)

A + B + C share a single underlying entity — the **CEMA Deal** — which is the
source of truth for existing loan, new loan, property, parties, county. All three
surfaces (calculator, pipeline, doc gen) are different views of the same data.

```
                    ┌─────────────────┐
                    │  CEMA DEAL      │  ← single source of truth
                    │  - existing loan│
                    │  - new loan     │
                    │  - property     │
                    │  - parties      │
                    │  - county       │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   A. Calculator       B. Pipeline           C. Doc Gen
```

This architecture still applies in the new framing — but instead of three UI surfaces
for human users, A/B/C may become inputs/outputs of an AI agent system that automates
end-to-end deliverables.

---

## The Pivot — New Framing (2026-05-12)

**Client brief:** Build AI software that lets the client avoid hiring 2–3 CEMA mortgage
loan processors.

**What this changes:**

| Dimension          | Old framing                         | New framing                              |
|--------------------|-------------------------------------|------------------------------------------|
| Product type       | Workflow SaaS                       | AI automation / vertical AI agent        |
| Primary user       | Multi-role office workers           | Operator / supervisor + AI               |
| Value metric       | Hours saved per user                | FTE replaced ($150–$250k saved annually) |
| Pricing/sales      | Per-seat SaaS                       | Annual license priced vs. saved salary   |
| UI emphasis        | Collaboration screens               | Exception queue, audit trail, oversight  |
| Tech emphasis      | CRUD + forms                        | Doc IDP + LLMs + agentic workflows       |
| Deployment         | Multi-tenant SaaS                   | Single-tenant or small-tenant            |

**Critical design principle going forward:**
Build for **deliverables**, not **tasks**. Humans do hundreds of micro-tasks to
produce a handful of deliverables (the CEMA package, the savings quote, the status
report to the borrower). Automate the deliverables; humans review exceptions.

---

## Research Phase (In Progress)

Two parallel deep-research agents launched:

1. **Job Responsibilities + Automation Potential** — what do CEMA processors actually
   do, at small and large firms, and which tasks/deliverables are automatable with
   2026-state-of-the-art AI?
2. **Competitive Landscape + Uniqueness Check** — what software exists in this space,
   where are the gaps, what hasn't been done?

Results will be written to `docs/research/01-job-tasks-and-automation.md` and
`docs/research/02-competitive-landscape.md`, then synthesized into a design spec.
