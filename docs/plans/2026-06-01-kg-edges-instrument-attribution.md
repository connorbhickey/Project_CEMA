# kg_edges Instrument Attribution — Design Spec

> **Status:** Approved (Connor, 2026-06-01) — implementation pending.
> **Milestone:** Phase 1, M14. Resolves ADR 0015 carry-over #6 (membership interpretation).
> **Authoritative spec:** `docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md` (this is a feature under it).

---

## 1. Goal & scope

Persist a PII-safe `deal → document` knowledge-graph edge (predicate `deal_has_instrument`) for
each IDP-classified collateral instrument on a deal, idempotently — so the KG can traverse from a
deal to its collateral instrument documents (`findNeighbors` / `traverse`).

**In scope:** new `deal_has_instrument` predicate (no migration); a pure edge-mapper; an
RLS-scoped app function that indexes a deal's instruments; a pipeline trigger; tests.

**Out of scope (deferred — noted for a future slice):**

- Chain **structure** edges (document→document assignment/consolidation order). The membership
  model deliberately drops the `assigns_to`/`consolidates` ordering — `ChainEdge` carries party
  **names** (PII), not ids, so structure would need entity resolution or a doc→doc derivation.
- Party-resolved edges (assignor/assignee → party/contact entities).
- A `deal_id` column on `kg_edges` (ADR 0009 #5) — moot here: the deal is the edge **subject**.

## 2. Predicate (no migration)

Add `'deal_has_instrument'` to the `Predicate` union in `packages/kg/src/types.ts` (+ the
schema doc-comment in `packages/db/src/schema/kg-edges.ts`). `kg_edges.predicate` is a free-form
`text` column, so there is **no DB migration**.

## 3. Pure core — `instrumentEdges`

`apps/web/lib/kg/instrument-edges.ts`:

```ts
export function instrumentEdges(
  organizationId: string,
  dealId: string,
  instrumentDocumentIds: readonly string[],
): AddEdgeInput[];
```

Maps each document id to `{ organizationId, subjectId: dealId, subjectType: 'deal',
predicate: 'deal_has_instrument', objectId: docId, objectType: 'document' }`. PII-safe by
construction (ids only — no names, no `extractedData`). Pure + node-testable.

## 4. App function + trigger

`apps/web/lib/kg/index-deal-instrument-edges.ts`:

```ts
export async function indexDealInstrumentEdges(dealId: string): Promise<number>;
```

- Resolve the org via `getCurrentOrganizationId` (mirrors the loaders); return 0 if no org.
- Under `withRls(org.id)`: select `{ id, extractedData }` from `documents WHERE deal_id = dealId`,
  keep rows where `isInstrumentRecord(extractedData)` (reuse the guard from
  `deal-chain-findings.ts`), map to ids, build edges via `instrumentEdges`, and `addEdge(tx, e)`
  each. `addEdge` is already `onConflictDoNothing` (the `kg_edges` unique index) → idempotent.
- Returns the number of edges asserted (for the pipeline span / logging).

**Trigger:** `runCollateralPipeline` calls `indexDealInstrumentEdges(dealId)` right after the IDP
stage when `idp.documents.length > 0` (the instruments now exist on `extractedData`). Idempotent,
so every pipeline run safely re-asserts. A PII-safe span attribute records the edge count.
Best-effort consistent with the pipeline's existing error propagation (the pipeline propagates;
the dispatcher one layer up swallows).

## 5. PII & audit

Edges carry only `dealId` + `documentId` (hard rule #3 safe). **No audit event** — KG edges are
derived, idempotent index data, not a compliance state transition (the existing `addEdge`
index-building in `link-contact-to-party` only audits the _party-link user action_, not the edge
itself; here there is no user action, just derived indexing).

## 6. Testing

- `instrument-edges.test.ts` — pure unit: correct edges for N ids; empty for none; no PII fields
  in the output.
- `index-deal-instrument-edges` — Neon-gated RLS integration (skip-green in CI): creates one edge
  per instrument doc (and none for a non-instrument doc), is idempotent on re-run, the
  deal→instrument edges are reachable via `findNeighbors(deal, 'deal_has_instrument')`, and are
  RLS-isolated from another org. Dedicated `kgie`/`d9e1…` identifier namespace (every
  unique-constrained field namespaced + stable — shared-Neon-branch hazard).

## 7. Files

- **Modify:** `packages/kg/src/types.ts` (+predicate); `packages/db/src/schema/kg-edges.ts`
  (doc-comment); `apps/web/lib/agents/collateral-pipeline.ts` (call indexer + span attr).
- **New:** `apps/web/lib/kg/instrument-edges.ts` (+test);
  `apps/web/lib/kg/index-deal-instrument-edges.ts` (+integration test).
- **No migration, no new package.**
