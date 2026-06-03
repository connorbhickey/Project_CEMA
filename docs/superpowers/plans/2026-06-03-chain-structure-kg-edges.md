# Chain-Structure doc→doc KG Edges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the Chain-of-Title agent's recorded assignment sequence into the knowledge graph as PII-free `document -[chain_precedes]-> document` edges, so the chain of title becomes traversable.

**Architecture:** A new pure agent function `chainSequenceEdges(instruments)` resolves the recording-order assignment sequence (reusing chain.ts's existing `byRecordedAt` + `ASSIGNMENT_SET`) and returns doc-id-only edges (no party names — PII stays in the agent). The app mirrors the PR #113 instrument-edges pair: a pure `chainEdges` mapper + an effectful `indexDealChainEdges` loader (which stamps the authoritative `documents.id` onto each instrument before calling the agent), wired into the collateral pipeline beside `indexDealInstrumentEdges`.

**Tech Stack:** TypeScript (strict), Vitest, Drizzle, `@cema/kg` (`addEdge`/`findNeighbors`, Apache AGE). 0 migrations (free-form `predicate`, PR #113 pattern). PII-safe by construction.

---

## File Structure

**Agent package (`packages/agents/chain-of-title/src/`):**

- Modify `types.ts` — add the `ChainSequenceEdge` interface.
- Modify `chain.ts` — add `chainSequenceEdges(instruments)` (reuses the private `byRecordedAt` + `ASSIGNMENT_SET`).
- Modify `index.ts` — export `chainSequenceEdges`.
- Create `chain-sequence.test.ts` — unit tests for the new function.

**App (`apps/web/lib/`):**

- Create `kg/chain-edges.ts` — pure mapper `chainEdges(orgId, sequence) → AddEdgeInput[]`.
- Create `kg/chain-edges.test.ts` — unit test.
- Create `kg/index-deal-chain-edges.ts` — effectful loader (stamps `documents.id`, calls the agent, persists).
- Modify `agents/collateral-pipeline.ts` — call `indexDealChainEdges` after `indexDealInstrumentEdges`.
- Create `tests/integration/kg-chain-edges.test.ts` — Neon-gated, mirrors `kg-instrument-edges.test.ts`.

**Branch:** `feat/chain-structure-kg-edges`. Sign every commit (`git commit -S`).

---

## Task 1: agent — `chainSequenceEdges`

**Files:**

- Modify: `packages/agents/chain-of-title/src/types.ts`
- Modify: `packages/agents/chain-of-title/src/chain.ts`
- Modify: `packages/agents/chain-of-title/src/index.ts`
- Test: `packages/agents/chain-of-title/src/chain-sequence.test.ts`

- [ ] **Step 1: Add the `ChainSequenceEdge` type to `types.ts`**

Insert after the `ChainEdge` interface (after the `ChainEdge` block that ends at line ~77):

```ts
// A PII-free doc->doc structural edge: the assignment instrument `fromDocumentId`
// is recorded immediately before `toDocumentId` in the recorded assignment
// sequence (recordedAt order). Document ids ONLY -- never party names. The app
// persists these to the KG as `document -[chain_precedes]-> document`. Descriptive
// (recording-order), like ChainEdge -- it does not assert a verified succession.
export interface ChainSequenceEdge {
  readonly fromDocumentId: string;
  readonly toDocumentId: string;
}
```

- [ ] **Step 2: Write the failing test — `chain-sequence.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { chainSequenceEdges } from './chain';
import type { InstrumentRecord } from './types';

// Minimal InstrumentRecord builder — only the fields chainSequenceEdges reads
// (documentId, instrumentKind, recordedAt) carry meaning; the rest are inert.
function inst(
  documentId: string,
  instrumentKind: InstrumentRecord['instrumentKind'],
  recordedAt: string | null,
): InstrumentRecord {
  return {
    documentId,
    instrumentKind,
    assignor: 'PARTY-SHOULD-NOT-LEAK',
    assignee: 'PARTY-SHOULD-NOT-LEAK',
    executedAt: null,
    recordedAt,
    amount: null,
    recordingRef: { reelPage: null, crfn: null },
    county: null,
    references: null,
  };
}

describe('chainSequenceEdges', () => {
  it('returns no edges for zero or one assignment', () => {
    expect(chainSequenceEdges([])).toEqual([]);
    expect(chainSequenceEdges([inst('a1', 'aom', '2020-01-01')])).toEqual([]);
  });

  it('links consecutive assignments in recordedAt order', () => {
    // Deliberately unsorted input — the function sorts by recordedAt.
    const edges = chainSequenceEdges([
      inst('a3', 'aom', '2020-03-01'),
      inst('a1', 'aom', '2020-01-01'),
      inst('a2', 'allonge', '2020-02-01'),
    ]);
    expect(edges).toEqual([
      { fromDocumentId: 'a1', toDocumentId: 'a2' },
      { fromDocumentId: 'a2', toDocumentId: 'a3' },
    ]);
  });

  it('orders undated assignments last (nulls last)', () => {
    const edges = chainSequenceEdges([inst('aN', 'aom', null), inst('a1', 'aom', '2020-01-01')]);
    expect(edges).toEqual([{ fromDocumentId: 'a1', toDocumentId: 'aN' }]);
  });

  it('ignores non-assignment instruments (anchors, notes)', () => {
    const edges = chainSequenceEdges([
      inst('m1', 'mortgage', '2020-01-01'),
      inst('a1', 'aom', '2020-02-01'),
      inst('n1', 'note', '2020-03-01'),
      inst('a2', 'aom', '2020-04-01'),
    ]);
    expect(edges).toEqual([{ fromDocumentId: 'a1', toDocumentId: 'a2' }]);
  });

  it('emits document ids ONLY — never party names (hard rule #3)', () => {
    const edges = chainSequenceEdges([
      inst('a1', 'aom', '2020-01-01'),
      inst('a2', 'aom', '2020-02-01'),
    ]);
    for (const e of edges) {
      expect(Object.keys(e).sort()).toEqual(['fromDocumentId', 'toDocumentId']);
    }
    expect(JSON.stringify(edges)).not.toContain('PARTY');
  });
});
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `pnpm --filter @cema/agents-chain-of-title exec vitest run src/chain-sequence.test.ts`
Expected: FAIL — `chainSequenceEdges` is not exported from `./chain`.

- [ ] **Step 4: Implement `chainSequenceEdges` in `chain.ts`**

Add the `ChainSequenceEdge` type to the type import at the top of `chain.ts` (line 8) — change:

```ts
import type { ChainAnalysis, ChainBreak, ChainEdge, ChainStatus, InstrumentRecord } from './types';
```

to:

```ts
import type {
  ChainAnalysis,
  ChainBreak,
  ChainEdge,
  ChainSequenceEdge,
  ChainStatus,
  InstrumentRecord,
} from './types';
```

Then append this function to the END of `chain.ts` (it reuses the file-private `byRecordedAt` + `ASSIGNMENT_SET`):

```ts
/**
 * PII-free doc->doc structural edges: the recorded assignment sequence. Filters
 * to assignment instruments (aom/allonge), sorts by recordedAt (the SAME order
 * analyzeChain pass E uses; nulls last), and links each consecutive pair. Returns
 * document ids only -- party names never leave the agent. Pure + deterministic.
 * Descriptive: emitted regardless of breaks (recording-order adjacency, not a
 * claim of valid succession), mirroring the ChainEdge graph.
 */
export function chainSequenceEdges(instruments: readonly InstrumentRecord[]): ChainSequenceEdge[] {
  const assignments = instruments.filter((i) => ASSIGNMENT_SET.has(i.instrumentKind));
  const ordered = [...assignments].sort(byRecordedAt);
  const edges: ChainSequenceEdge[] = [];
  for (let n = 0; n < ordered.length - 1; n += 1) {
    const cur: InstrumentRecord | undefined = ordered[n];
    const next: InstrumentRecord | undefined = ordered[n + 1];
    if (cur === undefined || next === undefined) continue;
    edges.push({ fromDocumentId: cur.documentId, toDocumentId: next.documentId });
  }
  return edges;
}
```

- [ ] **Step 5: Export it from `index.ts`** — change line 2:

```ts
export { analyzeChain } from './chain';
```

to:

```ts
export { analyzeChain, chainSequenceEdges } from './chain';
```

- [ ] **Step 6: Run the test — expect PASS**

Run: `pnpm --filter @cema/agents-chain-of-title exec vitest run src/chain-sequence.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/agents/chain-of-title/src/types.ts packages/agents/chain-of-title/src/chain.ts packages/agents/chain-of-title/src/index.ts packages/agents/chain-of-title/src/chain-sequence.test.ts
git commit -S -m "feat(chain-of-title): add chainSequenceEdges (PII-free doc->doc assignment sequence)"
```

---

## Task 2: app — pure `chainEdges` mapper

**Files:**

- Create: `apps/web/lib/kg/chain-edges.ts`
- Test: `apps/web/lib/kg/chain-edges.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { chainEdges } from './chain-edges';

describe('chainEdges', () => {
  it('maps each sequence edge to a document -> document chain_precedes KG edge', () => {
    const out = chainEdges('org-1', [
      { fromDocumentId: 'a1', toDocumentId: 'a2' },
      { fromDocumentId: 'a2', toDocumentId: 'a3' },
    ]);
    expect(out).toEqual([
      {
        organizationId: 'org-1',
        subjectId: 'a1',
        subjectType: 'document',
        predicate: 'chain_precedes',
        objectId: 'a2',
        objectType: 'document',
      },
      {
        organizationId: 'org-1',
        subjectId: 'a2',
        subjectType: 'document',
        predicate: 'chain_precedes',
        objectId: 'a3',
        objectType: 'document',
      },
    ]);
  });

  it('returns no edges for an empty sequence', () => {
    expect(chainEdges('org-1', [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter web exec vitest run lib/kg/chain-edges.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `chain-edges.ts`**

```ts
import type { ChainSequenceEdge } from '@cema/agents-chain-of-title';
import type { AddEdgeInput } from '@cema/kg';

/**
 * Pure mapper: one PII-safe `document -> document` KG edge (predicate
 * `chain_precedes`) per recorded assignment-sequence edge. Carries only document
 * ids (hard rule #3). Node-testable; the effectful addEdge runs in
 * index-deal-chain-edges.
 */
export function chainEdges(
  organizationId: string,
  sequence: readonly ChainSequenceEdge[],
): AddEdgeInput[] {
  return sequence.map((e) => ({
    organizationId,
    subjectId: e.fromDocumentId,
    subjectType: 'document',
    predicate: 'chain_precedes',
    objectId: e.toDocumentId,
    objectType: 'document',
  }));
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm --filter web exec vitest run lib/kg/chain-edges.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/kg/chain-edges.ts apps/web/lib/kg/chain-edges.test.ts
git commit -S -m "feat(kg): add chainEdges mapper (document chain_precedes edges)"
```

---

## Task 3: app — `indexDealChainEdges` loader + integration test

**Files:**

- Create: `apps/web/lib/kg/index-deal-chain-edges.ts`
- Test: `apps/web/tests/integration/kg-chain-edges.test.ts`

- [ ] **Step 1: Implement `index-deal-chain-edges.ts`**

```ts
import { getCurrentOrganizationId } from '@cema/auth';
import { chainSequenceEdges, type InstrumentRecord } from '@cema/agents-chain-of-title';
import { documents, getDb, organizations } from '@cema/db';
import { addEdge } from '@cema/kg';
import { eq } from 'drizzle-orm';

import { chainEdges } from './chain-edges';

import { isInstrumentRecord } from '@/lib/queries/deal-chain-findings';
import { withRls } from '@/lib/with-rls';

/**
 * Indexes a deal's recorded assignment sequence into the knowledge graph as
 * PII-safe `document -[chain_precedes]-> document` edges, so the chain of title
 * is traversable. Reads the InstrumentRecord[] the IDP enriched onto
 * documents.extractedData; the authoritative documents.id is stamped onto each
 * record (the KG node id), not trusted from extractedData. Idempotent: addEdge
 * uses onConflictDoNothing on the kg_edges unique index. Returns the edge count.
 */
export async function indexDealChainEdges(dealId: string): Promise<number> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return 0;

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({ id: documents.id, extractedData: documents.extractedData })
      .from(documents)
      .where(eq(documents.dealId, dealId));

    // Build InstrumentRecord[], stamping the authoritative documents.id as the
    // node id (defense-in-depth: do not trust extractedData.documentId).
    const instruments: InstrumentRecord[] = rows
      .filter((r) => isInstrumentRecord(r.extractedData))
      .map((r) => ({ ...(r.extractedData as InstrumentRecord), documentId: r.id }));

    const edges = chainEdges(org.id, chainSequenceEdges(instruments));
    for (const edge of edges) {
      await addEdge(tx, edge);
    }
    return edges.length;
  });
}
```

- [ ] **Step 2: Write the Neon integration test — `tests/integration/kg-chain-edges.test.ts`**

```ts
import { deals, documents, getDb, kgEdges, organizations, users } from '@cema/db';
import { findNeighbors } from '@cema/kg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

let currentClerkOrgId = 'kgce_org_a';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
}));

const { indexDealChainEdges } = await import('../../lib/kg/index-deal-chain-edges');
const { withRls } = await import('../../lib/with-rls');

// Own namespace: ids `c4a1…`, names `kgce_…` — every unique-constrained field is
// namespaced + stable so the suite survives the shared Neon dev branch.
const ORG_A = 'c4a10000-0000-0000-0000-0000000000a1';
const ORG_B = 'c4a10000-0000-0000-0000-0000000000b1';
const USER_A = 'c4a10000-0000-0000-0000-0000000000c1';
const DEAL_A = 'c4a10000-0000-0000-0000-0000000000f1';
const DOC_AOM_1 = 'c4a10000-0000-0000-0000-0000000000d1';
const DOC_AOM_2 = 'c4a10000-0000-0000-0000-0000000000d2';
const DOC_AOM_3 = 'c4a10000-0000-0000-0000-0000000000d3';
const DOC_MORT = 'c4a10000-0000-0000-0000-0000000000d4'; // anchor — not an assignment
const DOC_PLAIN = 'c4a10000-0000-0000-0000-0000000000d5'; // no InstrumentRecord

// extractedData WITHOUT documentId — the loader stamps documents.id authoritatively.
const instrument = (kind: string, recordedAt: string | null): Record<string, unknown> => ({
  instrumentKind: kind,
  assignor: null,
  assignee: null,
  executedAt: null,
  recordedAt,
  amount: null,
  recordingRef: { reelPage: null, crfn: null },
  county: null,
  references: null,
});

describe.skipIf(skip)('indexDealChainEdges (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'kgce_org_a', name: 'KGCE A', slug: 'kgce-a' },
        { id: ORG_B, clerkOrgId: 'kgce_org_b', name: 'KGCE B', slug: 'kgce-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_A, clerkUserId: 'kgce_user_a', email: 'kgce-a@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_A,
        organizationId: ORG_A,
        cemaType: 'refi_cema',
        status: 'title_work',
        createdById: USER_A,
      })
      .onConflictDoNothing();
    await db
      .insert(documents)
      .values([
        // Inserted OUT of recorded order — the sequence is derived from recordedAt.
        {
          id: DOC_AOM_3,
          dealId: DEAL_A,
          kind: 'aom',
          status: 'draft',
          attorneyReviewRequired: true,
          version: 1,
          extractedData: instrument('aom', '2020-03-01'),
        },
        {
          id: DOC_AOM_1,
          dealId: DEAL_A,
          kind: 'aom',
          status: 'draft',
          attorneyReviewRequired: true,
          version: 1,
          extractedData: instrument('aom', '2020-01-01'),
        },
        {
          id: DOC_AOM_2,
          dealId: DEAL_A,
          kind: 'allonge',
          status: 'draft',
          attorneyReviewRequired: true,
          version: 1,
          extractedData: instrument('allonge', '2020-02-01'),
        },
        {
          id: DOC_MORT,
          dealId: DEAL_A,
          kind: 'mortgage',
          status: 'draft',
          attorneyReviewRequired: false,
          version: 1,
          extractedData: instrument('mortgage', '2019-01-01'),
        },
        {
          id: DOC_PLAIN,
          dealId: DEAL_A,
          kind: 'mortgage',
          status: 'draft',
          attorneyReviewRequired: false,
          version: 1,
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // kg_edges is not append-only; clean this suite's exclusive org.
    const db = getDb();
    await db.delete(kgEdges).where(eq(kgEdges.organizationId, ORG_A));
  });

  const nextOf = (orgId: string, docId: string) =>
    withRls(orgId, (tx) =>
      findNeighbors(tx, {
        organizationId: orgId,
        nodeId: docId,
        nodeType: 'document',
        predicate: 'chain_precedes',
      }),
    );

  it('creates a chain_precedes edge per consecutive assignment, in recordedAt order', async () => {
    currentClerkOrgId = 'kgce_org_a';
    const count = await indexDealChainEdges(DEAL_A);
    expect(count).toBe(2);

    expect((await nextOf(ORG_A, DOC_AOM_1)).map((n) => n.nodeId)).toEqual([DOC_AOM_2]);
    expect((await nextOf(ORG_A, DOC_AOM_2)).map((n) => n.nodeId)).toEqual([DOC_AOM_3]);
    expect(await nextOf(ORG_A, DOC_AOM_3)).toHaveLength(0); // last hop
    expect(await nextOf(ORG_A, DOC_MORT)).toHaveLength(0); // anchor is not in the sequence
  });

  it('is idempotent — a second run creates no duplicate edges', async () => {
    currentClerkOrgId = 'kgce_org_a';
    await indexDealChainEdges(DEAL_A);
    const again = await indexDealChainEdges(DEAL_A);
    expect(again).toBe(2);
    expect((await nextOf(ORG_A, DOC_AOM_1)).map((n) => n.nodeId)).toEqual([DOC_AOM_2]);
  });

  it('is RLS-isolated — another org cannot traverse the edges', async () => {
    expect(await nextOf(ORG_B, DOC_AOM_1)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 4: (If `DATABASE_URL` set) run the integration suite**

Run: `pnpm --filter web exec vitest run -c vitest.neon.config.ts tests/integration/kg-chain-edges.test.ts`
Expected: PASS (3 cases). Skip-green without `DATABASE_URL`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/kg/index-deal-chain-edges.ts apps/web/tests/integration/kg-chain-edges.test.ts
git commit -S -m "feat(kg): index a deal's chain_precedes edges from the assignment sequence"
```

---

## Task 4: wire into the collateral pipeline

**Files:**

- Modify: `apps/web/lib/agents/collateral-pipeline.ts`

- [ ] **Step 1: Add the import**

After the existing `import { indexDealInstrumentEdges } from '../kg/index-deal-instrument-edges';` (line 8), add:

```ts
import { indexDealChainEdges } from '../kg/index-deal-chain-edges';
```

- [ ] **Step 2: Index chain edges after instrument edges**

In `runCollateralPipeline`, immediately after the instrument-edge block (the two lines: `const instrumentEdgeCount = await indexDealInstrumentEdges(dealId);` / `span.setAttribute('pipeline.instrument_edge_count', instrumentEdgeCount);`), add:

```ts
// Index the recorded assignment sequence into the KG as PII-safe
// chain_precedes (document -> document) edges. Like the instrument edges,
// this reads only the IDP-written extractedData (independent of the chain
// analysis below).
const chainEdgeCount = await indexDealChainEdges(dealId);
span.setAttribute('pipeline.chain_edge_count', chainEdgeCount);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/agents/collateral-pipeline.ts
git commit -S -m "feat(kg): index chain_precedes edges in the collateral pipeline"
```

---

## Task 5: full verification + PR

- [ ] **Step 1: Typecheck (root)** — `pnpm typecheck` — Expected: PASS (33/33).
- [ ] **Step 2: Lint (root)** — `pnpm lint` — Expected: 0 errors. (The agent packages have no `lint` script; the new agent file is linted by the pre-commit hook. The apps/web files ARE covered by root lint.)
- [ ] **Step 3: Unit tests (root)** — `pnpm test` — Expected: PASS; +7 unit (`chainSequenceEdges` 5 in the agent package, `chainEdges` 2 in apps/web). No regressions.
- [ ] **Step 4: Prettier on changed files (post-commit)** — Run (Bash, LF):

`pnpm exec prettier --check "packages/agents/chain-of-title/src/chain.ts" "packages/agents/chain-of-title/src/types.ts" "packages/agents/chain-of-title/src/index.ts" "packages/agents/chain-of-title/src/chain-sequence.test.ts" "apps/web/lib/kg/chain-edges.ts" "apps/web/lib/kg/chain-edges.test.ts" "apps/web/lib/kg/index-deal-chain-edges.ts" "apps/web/lib/agents/collateral-pipeline.ts" "apps/web/tests/integration/kg-chain-edges.test.ts"`

Expected: all clean.

- [ ] **Step 5: Push + PR**

```bash
git push -u origin feat/chain-structure-kg-edges
gh pr create --title "feat(kg): chain-structure doc→doc edges (chain_precedes)" --body "<summary + test plan + 🤖 trailer>"
gh pr merge <n> --auto --squash --delete-branch
```

- [ ] **Step 6: Watch CI → green → merged.** Resolve any CodeRabbit thread. GitGuardian/Vercel are known soft-fails.

---

## Self-Review

**1. Spec coverage** — pure agent fn resolving the PII-free sequence (Task 1); app pure mapper (Task 2) + effectful loader stamping the authoritative `documents.id` (Task 3); pipeline wiring beside the instrument edges (Task 4); verify + PR (Task 5). `chain_precedes` predicate + descriptive recording-order semantics ✓; 0 migrations (free-form predicate) ✓; PII-safe (doc ids only, asserted in Task 1 Step 2) ✓. ✓

**2. Placeholder scan** — every step has complete code (agent fn, both app modules, the full integration test, the exact pipeline insertion). No TBD/TODO. ✓

**3. Type consistency** — `ChainSequenceEdge { fromDocumentId, toDocumentId }` defined in Task 1, consumed by `chainEdges` (Task 2) + `indexDealChainEdges` (Task 3); `chainSequenceEdges(instruments: readonly InstrumentRecord[]): ChainSequenceEdge[]` (Task 1) called in Task 3; `chainEdges(orgId, sequence): AddEdgeInput[]` (Task 2) called in Task 3; `indexDealChainEdges(dealId): Promise<number>` (Task 3) called in Task 4. Exports added to `index.ts` (Task 1 Step 5). ✓

**4. Correctness** — sequence uses the SAME `byRecordedAt` (nulls-last) + `ASSIGNMENT_SET` as `analyzeChain` pass E (no divergent ordering); the loader stamps `documents.id` so edges reference real graph nodes regardless of `extractedData.documentId`; `addEdge` idempotency proven in Task 3's second-run case; RLS proven via the org-B traversal. ✓
