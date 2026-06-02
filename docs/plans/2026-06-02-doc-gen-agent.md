# Doc-Gen Agent (v1) — Design Spec

> **Status:** Approved (Connor, 2026-06-02) — implementation pending.
> **Milestone:** **Phase 2** (the first Phase-2 agent — spec §9.7). Refi-CEMA only.
> **Authoritative spec:** `docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md` §9.7.

---

## 1. Goal & scope

When a deal enters `doc_prep`, plan the **core Refi-CEMA document package**, run a deterministic
numbers-tie consistency check, and persist each document as a **gate-required, enqueued, draft**
`documents` row with a deterministic field-map — behind a **dormant DocMagic render seam** (no PDF
yet). This is the same proven blueprint (pure deterministic core + dormant vendor seam + attorney
gate + review-queue enqueue) the Phase-1 agents use, applied to document _generation_.

**In scope:**

- A pure deterministic core (`planDocuments`) in a new `@cema/agents-doc-gen` package (no
  `@cema/db`/clock/LLM) — decides which documents the deal needs, builds each one's field-map, and
  runs the numbers-tie consistency check.
- A dormant `FixtureDocGenAdapter` behind a `DocGenAdapter` seam (the swap point for real DocMagic
  rendering).
- An app-layer `runDocGen` dispatcher that RLS-reads the deal's data, plans, and (if consistent)
  persists each document + enqueues every gate-required doc into `document_review_queue` (reusing
  the IDP enqueue pattern), with split audit + OTel span. Idempotent.
- Triggered by the `doc_prep` `deal_status` transition via the existing agent dispatcher.

**Out of scope (deferred — carry-overs):**

- A real **DocMagic** render adapter (vendor-gated — adds `packages/integrations/docmagic` + a spec
  §16 row per hard rule #12; one-line swap in the dispatcher). Dormant (`FixtureDocGenAdapter`).
- The **LLM (Claude Opus) cross-document consistency reasoning** (spec step 3) — dormant; the
  deterministic numbers-tie check is the v1 floor.
- **Exhibits A–D** (consolidated-mortgage list, legal description, consolidated note, Form 3033).
- **Purchase-CEMA** (`nyc_rpt` / `tp_584` + the buyer-assumes-chain logic) — Phase 2.5.
- Full per-form field sets (v1 field-maps are thin/representative; real DocMagic templates define the
  complete field list).
- The **Recording Prep Agent** hand-off (spec step 6 / §9.8) — the next Phase-2 agent.
- A finer "chain-of-title clean + data complete" trigger (v1 uses the `doc_prep` lifecycle state).
- A Braintrust eval — the deterministic unit tests are the v1 gate (matching the no-LLM agents).

## 2. Why plan-not-render, why Refi-only

Real PDF rendering needs DocMagic + NY form templates (vendor-gated), so v1 cannot render. But the
**domain logic** is fully buildable now and is where the value sits: which documents a deal needs,
`gap = newPrincipal − ΣUPB`, the numbers-tie check, the per-prior-loan AOM fan-out, and the
hard-rule-#2 attorney gate. Refi-CEMA is the ~75% case; Purchase-CEMA (`cema_type = 'purchase_cema'`)
adds tax forms + buyer-assumes-chain complexity and is Phase 2.5 — so v1 guards to
`cema_type = 'refi_cema'`.

## 3. Pure core — `@cema/agents-doc-gen` (new 28th package)

No `@cema/db`, takes plain data (`DealDocGenInput`), node-testable. Reuses `DocumentKind` +
`GATE_REQUIRED_KINDS` from `@cema/collateral` (type + the runtime gate set — the IDP precedent).

```ts
// types.ts
import type { DocumentKind } from '@cema/collateral';

// Plain data the planner needs (decoupled from @cema/db). Amounts are numbers (the
// loader parses the decimal columns). cemaType is the raw enum value.
export interface DealDocGenInput {
  readonly dealId: string;
  readonly cemaType: string; // 'refi_cema' | 'purchase_cema'
  readonly newPrincipal: number; // newLoans.principal
  readonly existingLoans: ReadonlyArray<{ id: string; upb: number }>;
  readonly county: string;
  readonly borrowerNames: readonly string[];
}

// A planned document: its kind, the hard-rule-#2 gate flag, a human title, and a
// thin deterministic field-map. `fields` is the document's own content (names +
// amounts) — stored in documents.extractedData (the IDP precedent), NOT logged.
export interface PlannedDocument {
  readonly kind: DocumentKind;
  readonly attorneyReviewRequired: boolean;
  readonly title: string;
  readonly fields: Readonly<Record<string, string | number>>;
}

// Deterministic consistency result. `issues` are static PII-free tokens.
export interface ConsistencyResult {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

export interface DocumentPlan {
  readonly documents: readonly PlannedDocument[];
  readonly consistency: ConsistencyResult;
  readonly gap: number;
}

// Dormant render seam (DocMagic later). Fixture returns rendered:false (no blob).
export interface RenderResult {
  readonly rendered: boolean;
  readonly blobUrl?: string;
}
export interface DocGenAdapter {
  render(doc: PlannedDocument): Promise<RenderResult>;
}
```

```ts
// plan.ts (sketch)
import { GATE_REQUIRED_KINDS, type DocumentKind } from '@cema/collateral';

const GATE_SET = new Set<DocumentKind>(GATE_REQUIRED_KINDS);

// Human title per generated kind (load-time exhaustiveness guard over the set we emit).
const TITLE_BY_KIND: Partial<Record<DocumentKind, string>> = {
  cema_3172: 'CEMA (NY Form 3172)',
  consolidated_note: 'Consolidated Note',
  gap_note: 'Gap Note',
  gap_mortgage: 'Gap Mortgage',
  aff_255: 'NY Tax Law §255 Affidavit',
  aff_275: 'NY Tax Law §275 Affidavit',
  mt_15: 'MT-15 Mortgage Recording Tax Return',
  aom: 'Assignment of Mortgage',
};

export function planDocuments(input: DealDocGenInput): DocumentPlan {
  const totalUpb = input.existingLoans.reduce((s, l) => s + l.upb, 0);
  const gap = round2(input.newPrincipal - totalUpb);
  const issues: string[] = [];
  if (input.cemaType !== 'refi_cema') issues.push('not_refi_cema');
  if (input.existingLoans.length === 0) issues.push('no_existing_loans');
  if (input.newPrincipal <= 0) issues.push('new_principal_not_positive');
  if (gap < 0) issues.push('numbers_do_not_tie'); // UPB exceeds the new loan
  const consistency = { ok: issues.length === 0, issues };
  if (!consistency.ok) return { documents: [], consistency, gap };

  const docs: PlannedDocument[] = [
    make('cema_3172', input, {
      county: input.county,
      newPrincipal: input.newPrincipal,
      totalUpb,
      gap,
    }),
    make('consolidated_note', input, { newPrincipal: input.newPrincipal, totalUpb }),
    make('aff_255', input, { totalUpb }),
    make('aff_275', input, { totalUpb }),
    make('mt_15', input, { gap, county: input.county }),
  ];
  if (gap > 0) {
    docs.push(make('gap_note', input, { gap }));
    docs.push(make('gap_mortgage', input, { gap, county: input.county }));
  }
  for (const loan of input.existingLoans) {
    docs.push(make('aom', input, { existingLoanId: loan.id, upb: loan.upb }));
  }
  return { documents: docs, consistency, gap };
}
// make(kind, input, fields) -> { kind, attorneyReviewRequired: GATE_SET.has(kind),
//   title: TITLE_BY_KIND[kind]!, fields: { dealId: input.dealId, ...fields } }
// (throws via the load-time guard if TITLE_BY_KIND lacks an emitted kind.)
```

### The document set (Refi-CEMA core)

| Document                                                        | When                         | Gate-required |
| --------------------------------------------------------------- | ---------------------------- | ------------- |
| `cema_3172`, `consolidated_note`, `aff_255`, `aff_275`, `mt_15` | always                       | ✅            |
| `gap_note`, `gap_mortgage`                                      | `gap > 0` (new money exists) | ✅            |
| `aom`                                                           | one per existing loan        | ✅            |

All are in `GATE_REQUIRED_KINDS` → `attorneyReviewRequired = true` for every generated doc.

## 4. App dispatcher — `apps/web/lib/agents/doc-gen/`

- `deal-data.ts` — `loadDocGenInput(dealId): Promise<DealDocGenInput | null>`: RLS-reads the deal
  (`cemaType`, `newLoanId → newLoans.principal`, `propertyId → properties.county`), its
  `existing_loans` (`upb`, parsed `Number`), and `borrower`/`co_borrower` party names. Returns
  `null` if the deal or required data is missing. A mockable seam (the dispatcher test never touches
  the Drizzle chain).
- `adapter.ts` — `docGenAdapter` = `new FixtureDocGenAdapter()` (the DocMagic swap point).
- `run-doc-gen.ts` — `runDocGen(dealId)`:
  - **Self-resolves** org + actor (`getCurrentOrganizationId`/`getCurrentUser`, like
    `runOutreachFromDeal`); opens span `docgen.run` (PII-safe attrs: `docgen.deal_id`,
    `docgen.document_count`, `docgen.consistent`).
  - **Idempotency:** if a `cema_3172` already exists for the deal → skip (the package was already
    generated). The anchor doc is unique per deal.
  - `loadDocGenInput`; if `null` → return. `planDocuments(input)`.
  - **Split audit** `docgen.evaluated` (`metadata { count, consistent }`) — before any write.
  - If `!consistency.ok` → audit `docgen.inconsistent` (`metadata { issues }` — static tokens) +
    return (persist nothing). Numbers-tie failure must not produce documents.
  - Else, **per planned doc** (co-transactional): insert a `documents` row (`kind`,
    `attorneyReviewRequired`, `status: 'draft'`, `extractedData: fields`, `blobUrl: null`) → enqueue
    into `document_review_queue` (`onConflictDoNothing` on `(documentId, documentVersion)`,
    `submittedById = actorUserId`) + emit `document.submitted_for_review` on a real insert (the IDP
    pattern); then dormant `docGenAdapter.render(doc)` (no-op today).
  - `docgen.generated` (`metadata { count }`) on success.

## 5. Trigger — extend the agent dispatcher

- `on-deal-status-changed-core.ts` — `triggerForStatus`: add `doc_prep → 'doc_gen'` (extend the
  `AgentTrigger` union).
- `on-deal-status-changed.ts` — for the `doc_gen` trigger, `await runDocGen(dealId)` (inherits the
  dispatcher's best-effort swallow + `deal.agent_dispatch_failed` audit).

Spec §9.7's "chain clean + data complete" maps to the `doc_prep` lifecycle state for v1; a finer
chain-clean trigger is deferred.

## 6. Compliance (hard rule #2) + PII (hard rule #3)

- **#2 (attorney gate):** triple-covered — `GATE_REQUIRED_KINDS` drives `attorneyReviewRequired`,
  the `documents_attorney_gate_required` DB CHECK backstops it, and every gated doc is enqueued to
  `document_review_queue`. Documents are created `status: 'draft'` and never auto-`executed`/
  `recorded` (that requires an `AttorneyApproval`).
- **#3 (PII in logs):** generated documents legitimately contain names + amounts in
  `documents.extractedData` (their own content — the IDP precedent); SSN is never in a field-map. The
  audit/logs/spans carry only `kind` / `count` / `dealId` / static issue tokens — never field values.
- Consistency: the deterministic numbers-tie check gates generation (no documents when the numbers
  don't tie).

## 7. Testing

- **Package** (`@cema/agents-doc-gen`):
  - `plan.test.ts` — set composition (the 5 always-docs; `gap_note`/`gap_mortgage` only when
    `gap > 0`; one `aom` per existing loan); consistency pass + each failure case (non-refi, no
    loans, non-positive principal, UPB > principal → `numbers_do_not_tie`); every emitted doc is
    `attorneyReviewRequired: true`; `gap` arithmetic; issues + titles are PII-free (no digits).
  - `adapter.test.ts` — `FixtureDocGenAdapter.render` returns `rendered: false`.
- **App** (`apps/web`):
  - `run-doc-gen.test.ts` — clean refi: inserts N documents + enqueues each + `docgen.evaluated` →
    `docgen.generated`; inconsistent: `docgen.inconsistent` + no insert; idempotent: skips when a
    `cema_3172` exists; missing data: no-op. Mock `loadDocGenInput` + the db/enqueue seam.
  - `on-deal-status-changed` test extended: `doc_prep` runs `runDocGen`; a non-trigger status does
    not.

Target: ~20 tests. **0 migrations.** Package count 27 → **28**.

## 8. File structure

```text
packages/agents/doc-gen/
  package.json            # @cema/agents-doc-gen (+ @cema/collateral dep)
  tsconfig.json
  src/
    types.ts
    plan.ts
    adapter.ts
    index.ts
    plan.test.ts
    adapter.test.ts
apps/web/lib/agents/doc-gen/
  deal-data.ts            # loadDocGenInput RLS loader (mockable seam)
  adapter.ts              # FixtureDocGenAdapter instance (DocMagic swap point)
  run-doc-gen.ts          # runDocGen dispatcher (plan -> persist -> enqueue, split audit, span)
  run-doc-gen.test.ts
apps/web/lib/agents/on-deal-status-changed-core.ts  # + doc_prep -> 'doc_gen'
apps/web/lib/agents/on-deal-status-changed.ts       # + runDocGen for 'doc_gen'
apps/web/lib/agents/on-deal-status-changed.test.ts  # + doc_prep trigger case
apps/web/package.json     # + @cema/agents-doc-gen dep
```
