# ADR 0019: Purchase-CEMA data model — seller vs. buyer, and the D2 seller-completeness check

**Status:** Accepted (D1–D3 confirmed by Connor 2026-06-06; D2 shipped same day)
**Author:** Phase 2.5 Purchase CEMA (Claude Opus 4.8 + Connor Hickey)
**Relates to:** spec §9.7 / §9.11 (Doc-Gen + Exception Triage agents); PR #162 (Doc-Gen Purchase support); ADR 0015 (Collateral IDP — InstrumentRecord); the design proposal `docs/plans/2026-06-06-purchase-cema-data-model.md`
**Spec:** `docs/plans/2026-06-06-purchase-cema-data-model.md`

---

## Context

PR #162 made the Doc-Gen Agent plan documents for `purchase_cema` (it previously refused
anything but `refi_cema`), and surveying the agent layer confirmed Doc-Gen was the **last**
`cemaType`-gated refusal — so Purchase-CEMA _agent code_ became complete. That work flagged
a domain assumption: how does a deal model the **seller** (whose mortgage is assumed) vs. the
**buyer** (the new obligor)?

The design proposal (`docs/plans/2026-06-06-purchase-cema-data-model.md`) answered it against
the as-built schema and recommended three decisions (D1–D3) + four open questions. Connor
confirmed D1–D3. This ADR records that decision and the D2 implementation.

## Decisions

### D1 — Adopt the convention; no schema change

The schema **already** models Purchase CEMA:

- `party_role` already includes **`seller`** and **`seller_attorney`** (`packages/db/src/schema/enums.ts`).
- `existing_loans` are **deal-owned** (FK to `deals`, no party FK), so "whose mortgage is
  assumed" is a _convention_, not a structural coupling.

The adopted convention:

- **`purchase_cema`:** ≥ 1 party with `role = 'seller'` (the exiting owner); `borrower` /
  `co_borrower` = the **buyer**; `existing_loans` = the **seller's** mortgage(s);
  `existing_loans.currentServicerId` = the seller's servicer (Servicer Outreach's chase target).
- **`refi_cema`:** `borrower` / `co_borrower` = the existing obligor; no `seller` party.

Because every agent reads `existing_loans` by `dealId` and parties by `role`, this requires
**no agent changes and no migration** — the buyer/seller distinction only surfaces at render
time (AOM assignor/assignee, consolidated-note obligor), which is downstream of the dormant
DocMagic render seam.

### D2 — A _soft_ well-formedness check via Exception Triage (not a DB CHECK)

A `purchase_cema` deal that has reached an active processing stage but has **no `seller`
party** is malformed (Doc-Gen, the collateral chase, and recording all assume the seller's
side exists). This is surfaced as an exception, **not** enforced by a Postgres CHECK — intake
order varies, and a hard constraint would block legitimate in-progress deals.

Implementation:

- New exception kind **`purchase_missing_seller`** in `@cema/agents-exception-triage`
  (severity `medium` → `processor_review`; static PII-free reason), driven by the
  load-time exhaustiveness guard over the severity/route/reason maps.
- A new **required** `DealSignals.purchaseMissingSeller` field (mirrors `recordingRejected` —
  making it required forces every aggregator/fixture to provide it via `tsc`).
- A pure, stage-gating helper `isPurchaseMissingSeller(cemaType, status, hasSeller)` in
  `apps/web/lib/agents/exception-triage/`: flags only `cemaType === 'purchase_cema'` AND a
  status in `{collateral_chase, title_work, doc_prep, attorney_review, closing, recording}`
  AND no seller. Early stages (intake/eligibility/authorization — seller still being added)
  and terminal stages never flag.
- The RLS-scoped aggregator `getOrgExceptions` computes `hasSeller` from an org-scoped
  `parties` query (role = `seller`, `dealId IN` the org's deals) and feeds the helper's
  boolean to the pure classifier. Recompute-live; no table, **no migration**.

### D3 — Borrower Comms never contacts the seller (invariant)

The Borrower Comms Agent already targets `borrower` / `co_borrower` parties only; the seller
is the counterparty. No change — recorded here as an invariant (a future SMS/voice path must
preserve it).

## Consequences

- **Purchase-CEMA agent code is complete** under the adopted convention; a live Purchase deal
  needs no further agent code — only the same vendor keys + design partner the Refi path needs.
- The **`purchase_missing_seller`** exception makes a malformed Purchase deal visible in the
  cross-deal `/exceptions` inbox (rendered generically, like `rejected_recording`).
- **Open questions carried forward** (from the design doc §6, Connor-owned): Q1 servicer-chase
  parity, Q2 a possible second servicer, Q3 the Purchase §255 tax basis (feeds Intake savings,
  rides the ADR 0010 #4 rate table). **Q4 — intake-UI support for adding a `seller` party +
  the seller's `existing_loans`** is the one genuinely-new _UI_ surface a live Purchase deal
  needs; it is a follow-up, not a blocker for the dormant agents.
- The check is **stage-gated + soft**: it never blocks a transition, and clears the moment a
  seller party is added. Tightening it (e.g. also requiring ≥ 1 `existing_loan`, or firing
  earlier) is a tunable follow-up — `no_existing_loans` is already covered by Doc-Gen's own
  consistency check.
