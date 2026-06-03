# Deal Graph Relationships View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the deal's knowledge-graph **relationships** (instrument membership + the `chain_precedes` assignment sequence) on `/deals/[id]/graph`, which today renders a flat node list and discards the structure.

**Architecture:** Repurpose the existing `get-deal-graph.ts` action to return EDGES (built on the existing `findNeighbors` kg primitive, which carries predicates) instead of `traverse` nodes (which drop them). A pure `summarizeDealGraph` groups edges by predicate (human labels) and orders the `chain_precedes` edges into a path. The page renders the groups + the ordered chain. No kg-core change.

**Tech Stack:** Next.js 16 RSC, `@cema/kg` (`findNeighbors`), Drizzle, Vitest. 0 migrations (reads existing `kg_edges`). PII-safe (node ids + predicate enums only).

---

## File Structure

- Create `apps/web/lib/kg/deal-graph-view.ts` — `DealGraphEdge` type + pure `summarizeDealGraph(edges)` (group-by-predicate + `orderChain`) + `PREDICATE_LABELS`.
- Create `apps/web/lib/kg/deal-graph-view.test.ts` — unit tests.
- Modify `apps/web/lib/actions/get-deal-graph.ts` — repurpose `getDealGraph` to return `{ dealId, edges }` via `findNeighbors`.
- Modify `apps/web/lib/actions/get-deal-graph.test.ts` — mock `findNeighbors`, assert edges.
- Modify `apps/web/app/(app)/deals/[id]/graph/page.tsx` — render the relationship view.
- Create `apps/web/tests/integration/deal-graph-edges.test.ts` — Neon-gated end-to-end.

**Branch:** `feat/deal-graph-relationships`. Sign every commit (`git commit -S`).

---

## Task 1: pure `deal-graph-view.ts`

**Files:**

- Create: `apps/web/lib/kg/deal-graph-view.ts`
- Test: `apps/web/lib/kg/deal-graph-view.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { summarizeDealGraph, type DealGraphEdge } from './deal-graph-view';

const edge = (
  subjectId: string,
  predicate: string,
  objectId: string,
  subjectType = 'deal',
  objectType = 'document',
): DealGraphEdge => ({ subjectId, subjectType, predicate, objectId, objectType });

describe('summarizeDealGraph', () => {
  it('groups edges by predicate with a human label, in first-seen order', () => {
    const view = summarizeDealGraph([
      edge('deal-1', 'deal_has_instrument', 'doc-1'),
      edge('doc-1', 'chain_precedes', 'doc-2', 'document'),
      edge('deal-1', 'deal_has_instrument', 'doc-2'),
    ]);
    expect(view.groups.map((g) => g.predicate)).toEqual(['deal_has_instrument', 'chain_precedes']);
    expect(view.groups[0]!.label).toBe('Collateral instruments');
    expect(view.groups[0]!.edges).toHaveLength(2);
    expect(view.groups[1]!.label).toBe('Assignment chain (recorded order)');
  });

  it('falls back to the raw predicate for an unlabeled kind', () => {
    const view = summarizeDealGraph([edge('deal-1', 'mystery_edge', 'x')]);
    expect(view.groups[0]!.label).toBe('mystery_edge');
  });

  it('orders chain_precedes edges into a path (head = a `from` never seen as a `to`)', () => {
    const view = summarizeDealGraph([
      edge('doc-2', 'chain_precedes', 'doc-3', 'document'),
      edge('doc-1', 'chain_precedes', 'doc-2', 'document'),
    ]);
    expect(view.chainPath).toEqual(['doc-1', 'doc-2', 'doc-3']);
  });

  it('returns an empty chain path when there are no chain edges', () => {
    expect(summarizeDealGraph([edge('deal-1', 'deal_has_instrument', 'doc-1')]).chainPath).toEqual(
      [],
    );
  });

  it('bails to empty (does not fabricate) on a cyclic chain with no clean head', () => {
    const view = summarizeDealGraph([
      edge('doc-1', 'chain_precedes', 'doc-2', 'document'),
      edge('doc-2', 'chain_precedes', 'doc-1', 'document'),
    ]);
    expect(view.chainPath).toEqual([]);
  });

  it('returns no groups for no edges', () => {
    expect(summarizeDealGraph([])).toEqual({ groups: [], chainPath: [] });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter web exec vitest run lib/kg/deal-graph-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `deal-graph-view.ts`**

```ts
/** One directed KG relationship on a deal's subgraph (a `kg_edges` row, reduced
 *  to the display fields). Ids + predicate/type enums only — PII-safe. */
export interface DealGraphEdge {
  readonly subjectId: string;
  readonly subjectType: string;
  readonly predicate: string;
  readonly objectId: string;
  readonly objectType: string;
}

export interface DealGraphGroup {
  readonly predicate: string;
  readonly label: string;
  readonly edges: readonly DealGraphEdge[];
}

export interface DealGraphView {
  readonly groups: readonly DealGraphGroup[];
  /** The chain_precedes edges ordered into a single document path (or [] when
   *  there is no chain, or the chain has no clean head — e.g. a cycle). */
  readonly chainPath: readonly string[];
}

// Human labels per KG predicate (mirrors the @cema/kg Predicate union). An
// unlabeled predicate renders its raw token (defensive, like describeAuditEvent).
const PREDICATE_LABELS: Record<string, string> = {
  deal_has_instrument: 'Collateral instruments',
  deal_has_document: 'Documents',
  deal_has_communication: 'Communications',
  chain_precedes: 'Assignment chain (recorded order)',
  party_is_on_deal: 'Parties',
  contact_is_party: 'Contacts',
};

function predicateLabel(predicate: string): string {
  return PREDICATE_LABELS[predicate] ?? predicate;
}

/** Order chain_precedes edges into one document path. Head = a subject that is
 *  never an object; follow `from -> to`. Returns [] if there is no clean head
 *  (cycle) — descriptive, never fabricated. A self-guard stops on any revisit. */
function orderChain(chainEdges: readonly DealGraphEdge[]): string[] {
  if (chainEdges.length === 0) return [];
  const next = new Map<string, string>();
  const objects = new Set<string>();
  for (const e of chainEdges) {
    next.set(e.subjectId, e.objectId);
    objects.add(e.objectId);
  }
  const head = chainEdges.map((e) => e.subjectId).find((s) => !objects.has(s));
  if (head === undefined) return [];
  const path = [head];
  const seen = new Set<string>([head]);
  let cur = head;
  while (next.has(cur)) {
    const n = next.get(cur)!;
    if (seen.has(n)) break;
    path.push(n);
    seen.add(n);
    cur = n;
  }
  return path;
}

/**
 * Pure: reduce a deal's KG edges to a display view — grouped by predicate (in
 * first-seen order, each with a human label) + the chain_precedes sequence
 * ordered into a single document path. Node-testable; no IO.
 */
export function summarizeDealGraph(edges: readonly DealGraphEdge[]): DealGraphView {
  const groupsMap = new Map<string, DealGraphEdge[]>();
  for (const e of edges) {
    const g = groupsMap.get(e.predicate) ?? [];
    g.push(e);
    groupsMap.set(e.predicate, g);
  }
  const groups: DealGraphGroup[] = [...groupsMap.entries()].map(([predicate, es]) => ({
    predicate,
    label: predicateLabel(predicate),
    edges: es,
  }));
  const chainPath = orderChain(edges.filter((e) => e.predicate === 'chain_precedes'));
  return { groups, chainPath };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter web exec vitest run lib/kg/deal-graph-view.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/kg/deal-graph-view.ts apps/web/lib/kg/deal-graph-view.test.ts
git commit -S -m "feat(kg): add summarizeDealGraph (group edges by predicate + order the chain)"
```

---

## Task 2: repurpose `getDealGraph` to return edges

**Files:**

- Modify: `apps/web/lib/actions/get-deal-graph.ts`
- Modify: `apps/web/lib/actions/get-deal-graph.test.ts`
- Test: `apps/web/tests/integration/deal-graph-edges.test.ts`

- [ ] **Step 1: Replace `get-deal-graph.ts` in full**

```ts
'use server';

import { getCurrentOrganizationId } from '@cema/auth';
import { getDb } from '@cema/db';
import { findNeighbors } from '@cema/kg';

import { type DealGraphEdge } from '../kg/deal-graph-view';
import { withRls } from '../with-rls';

export interface DealGraphResult {
  dealId: string;
  edges: DealGraphEdge[];
}

/**
 * Returns the deal's knowledge-graph relationships: the deal's outbound edges
 * (membership — deal_has_instrument, etc.) plus the chain_precedes edges among
 * its instrument documents (the recorded assignment sequence). Built on the
 * findNeighbors primitive (which carries predicates) under RLS. PII-safe: node
 * ids + predicate enums only.
 */
export async function getDealGraph(dealId: string): Promise<DealGraphResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not found');

  const edges = await withRls(org.id, async (tx) => {
    const dealNeighbors = await findNeighbors(tx as never, {
      organizationId: org.id,
      nodeId: dealId,
      nodeType: 'deal',
    });

    const out: DealGraphEdge[] = dealNeighbors.map((n) => ({
      subjectId: dealId,
      subjectType: 'deal',
      predicate: n.predicate,
      objectId: n.nodeId,
      objectType: n.nodeType,
    }));

    // Follow the chain_precedes sequence out of each document neighbor.
    const docIds = dealNeighbors.filter((n) => n.nodeType === 'document').map((n) => n.nodeId);
    for (const docId of docIds) {
      const succ = await findNeighbors(tx as never, {
        organizationId: org.id,
        nodeId: docId,
        nodeType: 'document',
        predicate: 'chain_precedes',
      });
      for (const s of succ) {
        out.push({
          subjectId: docId,
          subjectType: 'document',
          predicate: 'chain_precedes',
          objectId: s.nodeId,
          objectType: s.nodeType,
        });
      }
    }

    return out;
  });

  return { dealId, edges };
}
```

- [ ] **Step 2: Replace `get-deal-graph.test.ts` in full**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
}));

vi.mock('@cema/kg', () => ({
  findNeighbors: vi.fn(),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';
import { findNeighbors } from '@cema/kg';

import { withRls } from '../with-rls';

import { getDealGraph } from './get-deal-graph';

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue({
    query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
  } as never);
  vi.mocked(withRls).mockImplementation((_orgId, fn) => fn({} as never));
  // deal -> two instrument docs; doc-1 -> doc-2 via chain_precedes; doc-2 -> end.
  vi.mocked(findNeighbors).mockImplementation((_tx, input) => {
    if (input.nodeId === 'deal-1') {
      return Promise.resolve([
        { nodeId: 'doc-1', nodeType: 'document', predicate: 'deal_has_instrument' },
        { nodeId: 'doc-2', nodeType: 'document', predicate: 'deal_has_instrument' },
      ] as never);
    }
    if (input.nodeId === 'doc-1' && input.predicate === 'chain_precedes') {
      return Promise.resolve([
        { nodeId: 'doc-2', nodeType: 'document', predicate: 'chain_precedes' },
      ] as never);
    }
    return Promise.resolve([] as never);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getDealGraph', () => {
  it('returns the deal membership edges and the chain_precedes edges', async () => {
    const { edges } = await getDealGraph('deal-1');

    const membership = edges.filter((e) => e.predicate === 'deal_has_instrument');
    expect(membership.map((e) => e.objectId).sort()).toEqual(['doc-1', 'doc-2']);
    expect(membership.every((e) => e.subjectId === 'deal-1' && e.subjectType === 'deal')).toBe(
      true,
    );

    const chain = edges.filter((e) => e.predicate === 'chain_precedes');
    expect(chain).toEqual([
      {
        subjectId: 'doc-1',
        subjectType: 'document',
        predicate: 'chain_precedes',
        objectId: 'doc-2',
        objectType: 'document',
      },
    ]);
  });

  it('starts the traversal from the deal node', async () => {
    await getDealGraph('deal-1');
    expect(findNeighbors).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nodeId: 'deal-1', nodeType: 'deal' }),
    );
  });
});
```

- [ ] **Step 3: Run the unit test — expect PASS**

Run: `pnpm --filter web exec vitest run lib/actions/get-deal-graph.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Write the Neon integration test — `tests/integration/deal-graph-edges.test.ts`**

```ts
import { kgEdges, getDb, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

let currentClerkOrgId = 'dgr_org_a';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
}));

const { getDealGraph } = await import('../../lib/actions/get-deal-graph');

// Own namespace: ids `d6a1…`, names `dgr_…`.
const ORG_A = 'd6a10000-0000-0000-0000-0000000000a1';
const ORG_B = 'd6a10000-0000-0000-0000-0000000000b1';
const DEAL_A = 'd6a10000-0000-0000-0000-0000000000f1';
const DOC_1 = 'd6a10000-0000-0000-0000-0000000000d1';
const DOC_2 = 'd6a10000-0000-0000-0000-0000000000d2';

const edge = (subjectId: string, subjectType: string, predicate: string, objectId: string) => ({
  organizationId: ORG_A,
  subjectId,
  subjectType,
  predicate,
  objectId,
  objectType: 'document',
});

describe.skipIf(skip)('getDealGraph (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'dgr_org_a', name: 'DGR A', slug: 'dgr-a' },
        { id: ORG_B, clerkOrgId: 'dgr_org_b', name: 'DGR B', slug: 'dgr-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(kgEdges)
      .values([
        edge(DEAL_A, 'deal', 'deal_has_instrument', DOC_1),
        edge(DEAL_A, 'deal', 'deal_has_instrument', DOC_2),
        edge(DOC_1, 'document', 'chain_precedes', DOC_2),
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(kgEdges).where(eq(kgEdges.organizationId, ORG_A));
  });

  it('returns the deal membership + the chain_precedes edge', async () => {
    currentClerkOrgId = 'dgr_org_a';
    const { edges } = await getDealGraph(DEAL_A);

    const membership = edges.filter((e) => e.predicate === 'deal_has_instrument');
    expect(membership.map((e) => e.objectId).sort()).toEqual([DOC_1, DOC_2].sort());

    const chain = edges.filter((e) => e.predicate === 'chain_precedes');
    expect(chain).toHaveLength(1);
    expect(chain[0]!.subjectId).toBe(DOC_1);
    expect(chain[0]!.objectId).toBe(DOC_2);
  });

  it('is RLS-isolated — another org sees no edges', async () => {
    currentClerkOrgId = 'dgr_org_b';
    const { edges } = await getDealGraph(DEAL_A);
    expect(edges).toEqual([]);
  });
});
```

- [ ] **Step 5: (If `DATABASE_URL` set) run the integration suite**

Run: `pnpm --filter web exec vitest run -c vitest.neon.config.ts tests/integration/deal-graph-edges.test.ts`
Expected: PASS (2 cases). Skip-green without `DATABASE_URL`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions/get-deal-graph.ts apps/web/lib/actions/get-deal-graph.test.ts apps/web/tests/integration/deal-graph-edges.test.ts
git commit -S -m "feat(kg): getDealGraph returns relationships (membership + chain) via findNeighbors"
```

---

## Task 3: render the relationships on the graph page

**Files:**

- Modify: `apps/web/app/(app)/deals/[id]/graph/page.tsx`

> RSC; verified by `pnpm --filter web build` + the unit-tested pure `summarizeDealGraph`.

- [ ] **Step 1: Replace `page.tsx` in full**

```tsx
import { getDealGraph } from '../../../../../lib/actions/get-deal-graph';
import { summarizeDealGraph } from '../../../../../lib/kg/deal-graph-view';

export default async function DealGraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { edges } = await getDealGraph(id);
  const { groups, chainPath } = summarizeDealGraph(edges);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Knowledge Graph — Deal {id}</h1>

      {edges.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No relationships yet. They appear as the deal&apos;s collateral is processed (the IDP
          classifies instruments and the chain of title is analyzed).
        </p>
      )}

      {chainPath.length > 0 && (
        <section>
          <h2 className="text-muted-foreground mb-2 text-sm font-medium uppercase tracking-wide">
            Assignment chain
          </h2>
          <ol className="flex flex-wrap items-center gap-2">
            {chainPath.map((docId, i) => (
              <li key={docId} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted-foreground">→</span>}
                <span className="bg-muted rounded px-3 py-1 font-mono text-sm">{docId}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {groups.map((group) => (
        <section key={group.predicate}>
          <h2 className="text-muted-foreground mb-2 text-sm font-medium uppercase tracking-wide">
            {group.label} ({group.edges.length})
          </h2>
          <ul className="space-y-1">
            {group.edges.map((e) => (
              <li
                key={`${e.subjectId}:${e.predicate}:${e.objectId}`}
                className="bg-muted rounded px-3 py-1 font-mono text-sm"
              >
                {e.subjectId} <span className="text-muted-foreground">→</span> {e.objectId}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build (typed routes)**

Run: `pnpm --filter web typecheck` then `pnpm --filter web build`
Expected: both PASS; `/deals/[id]/graph` emits.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/deals/[id]/graph/page.tsx"
git commit -S -m "feat(kg): render deal relationships (membership + assignment chain) on the graph page"
```

---

## Task 4: full verification + PR

- [ ] **Step 1: Typecheck (root)** — `pnpm typecheck` — Expected: PASS (33/33).
- [ ] **Step 2: Lint (root)** — `pnpm lint` — Expected: 0 errors.
- [ ] **Step 3: Unit tests (root)** — `pnpm test` — Expected: PASS; +8 unit (`summarizeDealGraph` 6, `getDealGraph` 2 — the latter replaces the 2 old node-based cases, so net apps/web is +6 unit +1 file). No regressions.
- [ ] **Step 4: Build** — `pnpm --filter web build` — Expected: `/deals/[id]/graph` emits.
- [ ] **Step 5: Prettier on changed files (post-commit)** — Run (Bash, LF):

`pnpm exec prettier --check "apps/web/lib/kg/deal-graph-view.ts" "apps/web/lib/kg/deal-graph-view.test.ts" "apps/web/lib/actions/get-deal-graph.ts" "apps/web/lib/actions/get-deal-graph.test.ts" "apps/web/tests/integration/deal-graph-edges.test.ts" "apps/web/app/(app)/deals/[id]/graph/page.tsx"`

Expected: all clean.

- [ ] **Step 6: Push + PR**

```bash
git push -u origin feat/deal-graph-relationships
gh pr create --title "feat(kg): surface deal relationships (membership + assignment chain) on the graph page" --body "<summary + test plan + 🤖 trailer>"
gh pr merge <n> --auto --squash --delete-branch
```

- [ ] **Step 7: Watch CI → green → merged.** Resolve any CodeRabbit thread. GitGuardian/Vercel are known soft-fails.

---

## Self-Review

**1. Spec coverage** — pure `summarizeDealGraph` (group + label + chain order: Task 1); `getDealGraph` repurposed to edges via `findNeighbors` (Task 2) + unit + Neon integration; page renders the chain path + predicate groups + refreshed empty-state (Task 3); verify + PR (Task 4). No kg-core change ✓; 0 migrations ✓; PII-safe (ids + enums) ✓. ✓

**2. Placeholder scan** — every step has complete code (pure module, both replaced files, the integration test, the full page). No TBD/TODO. ✓

**3. Type consistency** — `DealGraphEdge { subjectId, subjectType, predicate, objectId, objectType }` defined in `deal-graph-view.ts` (Task 1), imported by `get-deal-graph.ts` (Task 2) + consumed by `summarizeDealGraph` (Task 1) on the page (Task 3); `getDealGraph(dealId): Promise<{ dealId, edges: DealGraphEdge[] }>` (Task 2) consumed in Task 3; `summarizeDealGraph(edges): { groups, chainPath }` (Task 1) consumed in Task 3. The old `{ nodes }` shape is fully replaced (page + test both updated). ✓

**4. Correctness** — `findNeighbors` carries the predicate (unlike `traverse`); the loader stitches deal membership + per-document `chain_precedes` successors; `orderChain` finds the head (a `from` never a `to`) and guards cycles (returns [] — never fabricates); RLS proven via the org-B integration case. The `tx as never` cast mirrors the existing `get-deal-graph.ts`. ✓
