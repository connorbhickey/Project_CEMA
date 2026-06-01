# Deal-Scoped Review Surface — Design (M14 Slice 3)

**Date:** 2026-05-31
**Status:** Approved for planning
**Milestone:** Phase 1 — M14 Slice 3
**Resolves:** ADR 0015 carry-over #4 (deal-scoped attorney-review surface) + ADR 0016 carry-over #1 (render Chain-of-Title re_chase / attorney_review findings)

---

## 1. Goal

Build the route `/deals/[id]/documents` that renders, for a single deal:

1. **Collateral instruments** — the IDP-classified documents on the deal, with the gate-required ones surfaced for attorney action through the existing claim / approve / reject workflow.
2. **Chain-of-title findings** — the structural validator's `re_chase` and `attorney_review` route decisions, plus the overall chain status.

This turns two pieces of already-computed-but-invisible state into a working processor/attorney surface. The IDP agent already sets `documents.attorneyReviewRequired = true` and writes the `InstrumentRecord` into `documents.extractedData`; the Chain-of-Title agent already classifies breaks and routes them. Nothing renders either today. The IDP run action already calls `revalidatePath('/deals/[id]/documents')` — a no-op until this route exists.

## 2. Non-goals

- **Not** building approval logic from scratch. The pipeline (`submitForReview → claimReview → approveDocument / rejectDocument`, the `canTransition` state machine, the immutable `attorneyApprovals` event store, the `sendEnvelope` hard-rule-#2 gate) already exists and is reused as-is.
- **Not** activating the dormant Chain-of-Title route actuators (`routeReChase` / `openAttorneyReview`) or wiring a real re-chase hand-off to the Outreach Agent. That remains ADR 0016 carry-over #1's actuator half — Slice 3 renders findings; it does not act on them.
- **Not** auto-enqueuing gate-required docs from the IDP agent path (see §5, Decision 2 — deferred as a fast-follow).
- **No** new migration, **no** new external integration, **no** new workspace package.

## 3. Current-state findings (grounding)

| Fact                                                                              | Evidence                                                                                                                                                                                           | Consequence for this slice                                                               |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Approval pipeline exists end-to-end                                               | `apps/web/lib/actions/{submit-for-review,claim-review,approve-document,reject-document}.ts`; `packages/attorney/src/state.ts`; `packages/db/src/schema/{attorney-review,document-review-queue}.ts` | Reuse, do not rebuild.                                                                   |
| **IDP flags but does not enqueue**                                                | `apps/web/lib/agents/collateral-idp/deps.ts:54` sets `attorneyReviewRequired`; no `submitForReview` call anywhere in the IDP path                                                                  | The slice must bridge flag → queue (Decision 2).                                         |
| Existing review route is org-wide + single-item                                   | `apps/web/app/(app)/attorney/queue/[id]/page.tsx` renders one `ReviewDetailPanel` over `listReviewQueue()` (whole org)                                                                             | Slice 3 is **deal-scoped** and **multi-item** — a new surface, not a reuse of that page. |
| Chain findings are audit-counts-only                                              | `ChainAuditEvent` carries `breakCount / reChaseCount / attorneyReviewCount`; per-break `RouteDecision[]` is returned in-memory only, never persisted; actuators are no-ops                         | Recompute on render (Decision 1).                                                        |
| `InstrumentRecord` lives in `documents.extractedData` (jsonb, 1:1 by document id) | `deps.ts:55`; `packages/collateral/src/types.ts`                                                                                                                                                   | The chain recompute source is already persisted — no re-OCR, no blob load.               |
| `assignor` / `assignee` are party names                                           | `packages/collateral/src/types.ts`                                                                                                                                                                 | **Render** to RLS-scoped authenticated users (legitimate); **never log** (hard rule #3). |
| Deal sub-pages are independent RSC segments                                       | `apps/web/app/(app)/deals/[id]/{page,activity/page,files/page,graph/page,communications/page}.tsx`; no tab bar in `layout.tsx`                                                                     | New `/documents` segment + a nav link from the deal overview.                            |

## 4. Architecture

```
/deals/[id]/documents  (RSC page)
├── getDealDocumentsReview(dealId)   ── RLS ──▶ documents ⟕ document_review_queue
│        └── Section 1: Collateral instruments table
│               └── <DealDocumentReviewActions>  (client)
│                      ├── no queue row + gate-required → "Submit for review" → submitForReview()
│                      └── queue row → claim / approve / reject  (existing actions)
└── getDealChainFindings(dealId)     ── RLS ──▶ documents.extractedData
         └── analyzeChain() + route()  (pure, in-memory)
                └── Section 2: Chain-of-title findings (status + grouped RouteDecisions)
```

### 4.1 Data loaders (server, RLS-scoped)

Both follow the established pattern: resolve Clerk org → `withRls(org.id, async (tx) => { … })`, query through `tx`.

**`getDealDocumentsReview(dealId): Promise<DealDocumentReviewItem[]>`**

- Left-join `documents` (where `dealId = [id]`) to `documentReviewQueue` on `(documentId, documentVersion)`.
- Each item: `{ documentId, kind, status, version, attorneyReviewRequired, instrument: InstrumentRecord | null, queueId: string | null, reviewState: ReviewState | null, reviewerIsCurrentUser: boolean }`.
- `instrument` is `extractedData` cast to `InstrumentRecord` (present only after IDP has run; `null` otherwise).
- Ordering: gate-required first, then by `kind`, so attorney items surface at the top.

**`getDealChainFindings(dealId): Promise<DealChainFindings>`**

- Load the deal's `InstrumentRecord[]` from `documents.extractedData` (the same RLS-scoped read).
- If zero instruments → return `{ analyzed: false, status: null, routes: [] }` (empty state; do **not** run analysis on emptiness — an empty chain would falsely report breaks).
- Else: `const analysis = analyzeChain(instruments)` (returns `ChainAnalysis { status, edges, breaks }`), then `const routes = route(dealId, analysis.breaks)` (signature is `route(dealId, breaks)` — it takes the break list, not the whole analysis), and return `{ analyzed: true, status: analysis.status, routes }`.
- No clock, no LLM, no DB write — pure derivation from persisted state.

### 4.2 Page

`apps/web/app/(app)/deals/[id]/documents/page.tsx` — an `async` RSC. Loads both loaders in parallel (`Promise.all`). Renders:

- **Section 1 — Collateral instruments.** A table over `DealDocumentReviewItem[]`: columns `kind`, `version`, document `status` badge, review-state badge (`— / pending / claimed / approved / rejected`). For gate-required rows, an expandable/inline `InstrumentRecord` summary (`assignor → assignee`, `amount`, recording ref / county) and the `<DealDocumentReviewActions>` client island.
- **Section 2 — Chain-of-title findings.** Overall `status` chip (clean / broken / ambiguous / "not yet analyzed"). When `analyzed` and breaks exist: two groups — **Re-chase** (`re_chase`) and **Attorney review** (`attorney_review`) — each a list of `{ reason, linked document }`. When clean: a green "No chain breaks detected" panel (the single `advisory_pass`).

### 4.3 Client component

`apps/web/components/deal-document-review-actions.tsx` — extends the `ReviewDetailPanel` pattern (or wraps it):

- Props: `{ documentId, queueId: string | null, state: ReviewState | null, reviewerIsCurrentUser }`.
- `queueId === null` **and** gate-required → render **"Submit for attorney review"** → `submitForReview(documentId)`.
- `queueId !== null` → defer to the existing claim / approve / reject controls (the current `ReviewDetailPanel` behavior).
- All actions wrapped in `useTransition` with inline error surfacing, mirroring the existing panel.

### 4.4 Navigation

Add a link to `/deals/[id]/documents` from the deal overview page, matching however `activity` / `files` / `graph` / `communications` are currently linked (verified at implementation time).

## 5. Key decisions

### Decision 1 — Render chain findings by **recompute**, not persistence

`analyzeChain` + `route` are pure and clockless, and the `InstrumentRecord[]` is already in `extractedData`. Recomputing on render is microseconds over a typical 5–30-instrument collateral file, yields full per-break fidelity, reuses the agent's pure core, and adds **no migration**. Rejected: a `chain_routes` table + migration + actuator wiring (heavier than this slice needs; the findings are derived data, and the table would duplicate the source of truth); counts-only from audit metadata (can't name the offending document/break — fails the carry-over's intent).

### Decision 2 — Bridge the IDP→queue gap with a **UI-driven submit**

The deal page offers "Submit for attorney review" on gate-required docs lacking a queue row, calling the existing `submitForReview` unchanged. Keeps a human in the loop, smallest blast radius, no agent-path change. Rejected for now: auto-enqueue inside IDP `persistDocuments` (couples the agent to the queue, needs an agent actor user + idempotency handling) — recorded as a fast-follow carry-over.

### Decision 3 — Extend the existing review panel, don't fork it

`ReviewDetailPanel` already encodes claim/approve/reject against the state machine. The deal surface needs one more affordance (submit-when-unqueued), so extend that component (or thinly wrap it) rather than duplicate the transition UI.

## 6. PII & compliance

- **Hard rule #3 (no PII in logs):** `InstrumentRecord.assignor` / `assignee` are party names. They render to the RLS-scoped authenticated user (a legitimate processor/attorney view) but are **never** written to a log line or telemetry attribute. `RouteDecision.reason` is a static PII-free template — safe to render and persist. No new log lines introduce party data.
- **Hard rule #2 (attorney gate):** Slice 3 only ever drives documents _into_ review and renders state; the authoritative gate (`sendEnvelope` requiring an `attorneyApprovals` row) is untouched. No document is marked `executed`/`recorded` by this slice.
- **RLS tenancy:** the `documents` table has no `organizationId`; tenancy flows `documents.dealId → deals.organizationId`, enforced by `withRls`. Both loaders read exclusively through `withRls`.
- **Audit:** no new audit actions needed — `submitForReview` / `approveDocument` / `rejectDocument` already emit their events. The page is read-only except through those existing actions.

## 7. Error handling

- Loaders: missing org → empty result (page renders an empty state); `notFound()` only when the deal id itself resolves to nothing under RLS.
- `getDealChainFindings`: zero instruments → `{ analyzed: false }` empty state (no false breaks).
- Client actions: existing `ReviewDecisionError` / `DocumentNotReviewableError` surfaced inline in the panel; no silent swallow.

## 8. Testing

- **Unit:** `getDealChainFindings` recompute correctness — clean deal → `advisory_pass`; a deal with a missing assignment → `re_chase`; a lost-note deal → `attorney_review`; empty deal → `{ analyzed: false }`. `getDealDocumentsReview` join/ordering shape (gate-required first; `reviewState` null when unqueued).
- **Component:** `DealDocumentReviewActions` — renders "Submit for review" when `queueId === null` + gate-required; renders claim/approve/reject when queued.
- **Integration (Neon-gated):** RLS isolation — deal of org A invisible to org B (mirror `apps/web/tests/integration/m5-rls-isolation.test.ts` + `attorney-review-flow.test.ts`); full deal-scoped submit → claim → approve flow.
- **Reuse:** existing action tests already cover `submitForReview` / `claimReview` / `approveDocument` / `rejectDocument`.

## 9. File structure & decomposition (3 PRs)

**PR-1 — data loaders + tests** (no UI)

- Create `apps/web/lib/queries/deal-documents-review.ts` — `getDealDocumentsReview`.
- Create `apps/web/lib/queries/deal-chain-findings.ts` — `getDealChainFindings`.
- Tests colocated (`.test.ts`).

**PR-2 — page + components + wiring**

- Create `apps/web/app/(app)/deals/[id]/documents/page.tsx`.
- Create `apps/web/components/deal-document-review-actions.tsx`.
- Extend `apps/web/components/review-detail-panel.tsx` if shared.
- Add the deal-overview nav link.
- Neon-gated integration test for the deal-scoped submit→approve flow.

**PR-3 — docs close-out**

- Annotate ADR 0015 carry-over #4 + ADR 0016 carry-over #1 as resolved (with the auto-enqueue fast-follow recorded).
- Update `CLAUDE.md` §2 (Phase line + Next step + test/route counts) + Changelog.
- Update the M14 memory status file.

## 10. Carry-overs created by this slice

1. **Auto-enqueue gate-required docs from the IDP path** (Decision 2 deferral) — so a processor need not manually submit each instrument.
2. **Activate the Chain-of-Title route actuators** — real re-chase hand-off to the Outreach Agent + durable per-break dispatch (the actuator half of ADR 0016 carry-over #1; rendering is done, acting is not).
3. **Persist chain edges to `kg_edges`** (ADR 0015 carry-over #6) remains independent of this slice.
