# Purchase-CEMA data model — how a deal represents seller vs. buyer

> **Status:** Proposal for Connor's review · 2026-06-06
> **Author:** Claude Opus 4.8 (1M context)
> **Trigger:** PR #162 made the Doc-Gen Agent plan documents for `purchase_cema`, and flagged a domain assumption about how a Purchase CEMA's _seller_ and _buyer_ are modeled. This doc resolves that assumption against the as-built schema and proposes the conventions + the (small, deferrable) follow-ups.

---

## TL;DR

**The schema already supports Purchase CEMA. No migration is needed.** The `party_role` enum already includes **`seller`** and **`seller_attorney`**, and `existing_loans` are **owned by the deal** (not by a borrower), so "whose mortgage is being assumed" is a _convention_, not a structural coupling. Every agent that reads _existing-loans-by-deal_ + _parties-by-role_ is therefore already type-correct for both CEMA types. The remaining work is (1) a thin validation/convention layer and (2) render-time party-resolution rules — both deferrable, neither blocking the dormant agent layer.

The domain assumption flagged in PR #162 is **confirmed**: a Purchase CEMA's `existing_loans` are the seller's mortgage(s) and the `borrower`/`co_borrower` parties are the buyer — and the schema was clearly built with this in mind.

---

## 1. The Refi vs. Purchase difference (domain)

|                                 | **Refi-CEMA** (~75% of volume)                   | **Purchase CEMA** (~25%)                                                   |
| ------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| Who borrows                     | The existing owner refinances their **own** loan | A **buyer** purchases the property and **assumes** the seller's mortgage   |
| The `existing_loans` obligor    | The borrower (same person)                       | The **seller** (a different person)                                        |
| Who signs the consolidated note | The same borrower                                | The **buyer** (new obligor)                                                |
| Who exits                       | —                                                | The **seller** (and the seller's lender, via an Assignment of Mortgage)    |
| Tax mechanic                    | §255 exempts the assigned UPB; gap = new money   | Same §255 mechanic on the assigned UPB (confirm — see Q3)                  |
| Extra forms                     | —                                                | Transfer-tax: **TP-584**, **NYC-RPT** (Recording Prep's domain, spec §9.8) |

The single structural consequence: in a Refi the borrower and the existing-loan obligor are the **same** entity; in a Purchase they are **different** entities (buyer vs. seller).

---

## 2. As-built schema (what already exists today)

From `packages/db/src/schema/`:

- **`deals.cemaType`** ∈ `{ refi_cema, purchase_cema }` — the discriminator (`enums.ts`).
- **`parties.role`** ∈ `{ borrower, co_borrower, **seller**, loan_officer, processor, closing_attorney, title_agent, **seller_attorney**, doc_custodian }` — the `seller` and `seller_attorney` roles **already exist** (`enums.ts:35`).
- **`existing_loans.dealId`** — existing loans are **deal-owned** (FK to `deals`, `onDelete: cascade`). There is **no party FK** on `existing_loans`, so the loan attaches to the _deal_, and "whose loan" is a convention.
- **`existing_loans.currentServicerId`** — the prior servicer (for a Purchase, the **seller's** servicer — the one Servicer Outreach chases).
- **`existing_loans.upb` / `chainPosition` / recording coords** — the Schedule-A consolidation chain, identical shape for both types.
- **`parties`** carries the TCPA columns (`tcpaOptIn`, …) consulted by `tcpaGuard()` — relevant only to `borrower`/`co_borrower` (the buyer), never the seller.

**Conclusion:** the data model already distinguishes seller from buyer (via `role`) and already decouples the mortgage chain from the borrower (via deal-ownership). Nothing in the schema assumes a Refi.

---

## 3. The model (proposed conventions)

### For a `purchase_cema` deal

- **≥ 1 party with `role = 'seller'`** — the exiting owner. Optionally `role = 'seller_attorney'`.
- **`borrower` / `co_borrower`** = the **buyer** (the assuming party / new obligor).
- **`existing_loans`** = the **seller's** mortgage(s) being assumed — same table, same shape as a Refi.
- **`existing_loans.currentServicerId`** = the seller's servicer (Servicer Outreach chases them — already correct).

### For a `refi_cema` deal (unchanged)

- **`borrower` / `co_borrower`** = the existing obligor. **No `seller` party.**
- `existing_loans` = the borrower's own mortgage(s).

### Why this requires no agent changes

Every agent reads the deal's `existing_loans` by `dealId` and its parties by `role`. Under the convention above:

| Agent                 | Reads                                 | Correct for Purchase because…                              |
| --------------------- | ------------------------------------- | ---------------------------------------------------------- |
| **Intake**            | `cemaType`, property, UPBs            | `eligibility.ts` has no `cemaType` gate; UPB is deal-owned |
| **Servicer Outreach** | `existing_loans.currentServicerId`    | the seller's servicer is the chase target                  |
| **Collateral IDP**    | the collateral file (per document)    | instrument structure is owner-agnostic                     |
| **Chain-of-Title**    | the `InstrumentRecord[]`              | structural validation is owner-agnostic                    |
| **Doc-Gen** (PR #162) | `existing_loans` + `borrower` parties | same document set; obligor resolves at render              |
| **Recording Prep**    | `cemaType`, venue                     | already composes `tp_584` / `nyc_rpt` for Purchase         |
| **Borrower Comms**    | `borrower` / `co_borrower` parties    | targets the **buyer** only — never the seller (correct)    |

---

## 4. Where buyer/seller actually surfaces (render-time, currently dormant)

These are the _only_ places the distinction matters, and all are downstream of the dormant DocMagic render seam — **no code today**:

- **Assignment of Mortgage (AOM):** assignor = the seller's lender, assignee = the new lender. Doc-Gen's field-map carries `existingLoanId`; the assignor/assignee **names** resolve at render.
- **Consolidated Note obligor:** the **buyer** (`borrower`/`co_borrower`). For a Refi this is the same borrower; for a Purchase it is the buyer. Resolves at render.
- **§255 / §275 affidavits:** prior-tax-paid affirmation on the assigned UPB — owner-agnostic in structure.

When the real render adapter lands, it should resolve obligor names from `borrower`/`co_borrower` and assignor from the seller's-lender side — a render-mapping concern, not a schema or planner concern.

---

## 5. Recommended decisions (for Connor)

- **D1 — Adopt the convention in §3.** Seller = `role='seller'`; buyer = `borrower`/`co_borrower`; `existing_loans` are deal-owned and represent the seller's mortgage for a Purchase. **Zero schema change.** _Recommend: YES._
- **D2 — Add a _soft_ well-formedness check, not a DB CHECK.** Before `doc_prep`, a `purchase_cema` deal should have ≥ 1 `seller` party and ≥ 1 `existing_loan`. Surface a violation through **Exception Triage** (a new `DealSignals` field, mirroring `recordingRejected`), _not_ a Postgres CHECK — intake order varies and a hard constraint would block legitimate in-progress deals. _Recommend: a small follow-up PR after D1 is approved._
- **D3 — Confirm Borrower Comms never contacts the seller.** It already targets `borrower`/`co_borrower` only; the seller is the counterparty. _Recommend: no change; documented as an invariant._

---

## 6. Open questions for Connor

- **Q1 — Servicer chase parity.** Servicer Outreach treats the Purchase payoff/collateral chase identically to a Refi (chase `existing_loans.currentServicerId`). Is the seller's-servicer chase materially different in practice (e.g., the seller's cooperation / authorization step)?
- **Q2 — Second servicer.** In a Purchase, is the buyer's new lender's servicer ever involved pre-close in a way the deal must model (a second `currentServicerId`)? Today the chain is single-sided (the seller's).
- **Q3 — Purchase tax basis.** Is the §255/§275 exemption math identical to a Refi (assigned UPB exempt, gap taxed), or does the purchase change the basis? This feeds the Intake savings estimate and rides the same Connor-gated NY recording-tax rate table (ADR 0010 #4).
- **Q4 — Intake UI.** Does the deal-intake form let a processor add a `seller` party + the seller's `existing_loans`? If not, that's the one genuinely-new _UI_ surface a live Purchase deal needs (a follow-up, not a blocker for the dormant agents).

---

## 7. What this unblocks

With **D1** adopted, a live Purchase CEMA flows end-to-end through the agent layer with **no further agent code** — gated only on the same vendor keys + design partner the Refi path already needs. **D2** and **Q4** are small, well-scoped follow-ups; **Q1–Q3** are domain confirmations that ride existing Connor-gated items.

This doc can graduate to an ADR once D1–D3 are confirmed.
