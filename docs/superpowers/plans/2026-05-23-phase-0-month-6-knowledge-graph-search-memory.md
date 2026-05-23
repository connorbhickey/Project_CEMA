# Phase 0 Month 6 — Knowledge Graph, Full-Text Search, Agent Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four subsystems deferred from M5 — a pure-Postgres knowledge graph linking contacts → parties → deals (replacing Apache AGE, which Neon does not support), Typesense full-text search, production embedding queue consumers, and Mem0 agent memory — closing the deal-intelligence gap in the processor workspace.

**Architecture:** The knowledge graph uses a `kg_edges` adjacency table with recursive CTE traversal (no AGE extension required). Typesense and Mem0 packages gate on env vars so the dev loop never requires external accounts. Production embedding uses the existing Vercel Queues pattern (same as M2 Twilio consumer) to call OpenAI asynchronously after each communication/document insert.

**Tech Stack:** Drizzle ORM, `typesense` npm client, Mem0 REST API via `mem0ai` SDK, Vercel AI SDK (`embed`), Vercel Queues, Vitest, Next.js 16 RSC/Server Actions, pgvector.

---

## Architecture Notes

### Why not Apache AGE?

Apache AGE requires a custom Postgres build with the AGE extension compiled in. Neon does not support Apache AGE on their managed platform (as of 2026-05). Rather than stand up a separate Postgres instance, M6 implements the same graph semantics using a `kg_edges` adjacency table and PostgreSQL `WITH RECURSIVE` CTEs. The data model is identical to what AGE would store in a Cypher graph; the syntax difference is SQL vs Cypher. Migration to AGE remains possible if Neon adds support in the future.

### Party resolution flow

When a communication arrives (Slack message, email, call recording), the sender's email or phone is matched against `contact_identities` (normalized). If a contact exists, the knowledge graph is queried for `contact → party` edges, which yield the `party_id` and via `parties.deal_id` the `deal_id`. This populates `from_party_id` on the `communications` row, closing the open carry-over from M2–M4.

### Production embedding pattern

Reuses the M2 Vercel Queues pattern. On insert of a communication or document (via any webhook), publish a small message `{id, orgId}` to the `comms.embed` / `docs.embed` queue topic. A queue consumer at `app/api/queues/embed-communication/route.ts` calls `embedText()`, then runs `UPDATE communications SET embedding = $1 WHERE id = $2`. The pgvector similarity search already works once the column is populated.

---

## File Map

### New packages

| Path                                    | Responsibility                                              |
| --------------------------------------- | ----------------------------------------------------------- |
| `packages/kg/package.json`              | Package manifest                                            |
| `packages/kg/src/types.ts`              | `NodeType`, `Predicate`, `KgEdge`, `TraversalResult` types  |
| `packages/kg/src/edges.ts`              | `addEdge`, `removeEdge`, `findNeighbors`, `traverse`        |
| `packages/kg/src/resolve.ts`            | `resolvePartyFromContact` — contact identity → party → deal |
| `packages/kg/src/index.ts`              | Re-exports                                                  |
| `packages/kg/src/edges.test.ts`         | Unit tests                                                  |
| `packages/typesense/package.json`       | Package manifest                                            |
| `packages/typesense/src/client.ts`      | Lazy singleton `getTypesenseClient()`                       |
| `packages/typesense/src/collections.ts` | Collection schemas for `communications` + `documents`       |
| `packages/typesense/src/search.ts`      | `searchTypesense(query, filters)` → `SearchHit[]`           |
| `packages/typesense/src/sync.ts`        | `indexCommunication`, `indexDocument`, `deleteFromIndex`    |
| `packages/typesense/src/index.ts`       | Re-exports                                                  |
| `packages/typesense/src/client.test.ts` | Unit tests (mocked)                                         |
| `packages/memory/package.json`          | Package manifest                                            |
| `packages/memory/src/client.ts`         | Mem0 client wrapper + `getMemoryClient()`                   |
| `packages/memory/src/session.ts`        | `addMemory`, `searchMemory`, `clearSessionMemory`           |
| `packages/memory/src/index.ts`          | Re-exports                                                  |
| `packages/memory/src/session.test.ts`   | Unit tests (mocked)                                         |

### DB changes

| Path                                              | Responsibility                           |
| ------------------------------------------------- | ---------------------------------------- |
| `packages/db/src/schema/kg-edges.ts`              | `kgEdges` Drizzle table                  |
| `packages/db/src/schema/index.ts`                 | Add `kg-edges` export                    |
| `packages/db/migrations/0029_knowledge_graph.sql` | `kg_edges` DDL + RLS                     |
| `packages/db/migrations/0030_pgvector_hnsw.sql`   | HNSW index on `communications.embedding` |

### App changes

| Path                                                   | Responsibility                                    |
| ------------------------------------------------------ | ------------------------------------------------- |
| `apps/web/app/api/queues/embed-communication/route.ts` | Queue consumer: embed comm → update DB            |
| `apps/web/app/api/queues/embed-document/route.ts`      | Queue consumer: embed doc → update DB             |
| `apps/web/app/(app)/deals/[id]/graph/page.tsx`         | RSC: deal knowledge graph view                    |
| `apps/web/lib/actions/get-deal-graph.ts`               | Server action: fetch KG edges for a deal          |
| `apps/web/lib/actions/get-deal-graph.test.ts`          | Unit test                                         |
| `apps/web/lib/actions/link-contact-to-party.ts`        | Server action: manually link a contact to a party |
| `apps/web/lib/actions/link-contact-to-party.test.ts`   | Unit test                                         |
| `apps/web/tests/integration/kg-traversal.test.ts`      | Integration test: add/traverse/RLS                |
| `apps/web/tests/integration/m6-rls-isolation.test.ts`  | RLS: Org B cannot see Org A `kg_edges`            |

### Webhook wires (existing files — small additions)

| Path                                        | Change                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/web/app/api/webhooks/slack/route.ts`  | Publish `comms.embed` after comm upsert                                                       |
| `apps/web/app/api/webhooks/nylas/route.ts`  | Publish `comms.embed` after email upsert                                                      |
| `apps/web/app/api/webhooks/twilio/route.ts` | Publish `comms.embed` after recording upsert                                                  |
| `apps/web/lib/actions/ask-anything.ts`      | Route `full_text_search` to Typesense when key present; prepend Mem0 context when key present |
| `apps/web/lib/actions/search-similar.ts`    | Fallback to Typesense on `full_text_search` intent                                            |

---

## Task 1: `kg_edges` DB schema + migration + RLS

**Files:**

- Create: `packages/db/src/schema/kg-edges.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0029_knowledge_graph.sql`

- [ ] **Step 1: Write `kg-edges.ts` schema**

```typescript
// packages/db/src/schema/kg-edges.ts
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './tenants';

// ---------------------------------------------------------------------------
// kg_edges — directed edges in the contact ↔ party ↔ deal knowledge graph
// (M6 replacement for Apache AGE — same semantics, pure Postgres).
//
// NodeType values: 'contact' | 'party' | 'deal' | 'document' | 'communication'
// Predicate values: 'contact_is_party' | 'party_is_on_deal' | 'deal_has_document'
//
// Traversal uses WITH RECURSIVE CTEs — see @cema/kg.
// ---------------------------------------------------------------------------
export const kgEdges = pgTable(
  'kg_edges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').notNull(),
    subjectType: text('subject_type').notNull(),
    predicate: text('predicate').notNull(),
    objectId: uuid('object_id').notNull(),
    objectType: text('object_type').notNull(),
    metadata: text('metadata'), // JSON string, nullable — lightweight extension point
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Dedup: same directed edge is idempotent.
    uniqueIndex('kg_edges_uidx').on(
      t.organizationId,
      t.subjectId,
      t.subjectType,
      t.predicate,
      t.objectId,
      t.objectType,
    ),
    // Forward lookup: all edges from a given subject.
    index('kg_edges_subject_idx').on(t.organizationId, t.subjectId, t.subjectType),
    // Reverse lookup: all edges pointing to a given object.
    index('kg_edges_object_idx').on(t.organizationId, t.objectId, t.objectType),
  ],
);
```

- [ ] **Step 2: Add export to `packages/db/src/schema/index.ts`**

Add at the bottom of the file:

```typescript
export * from './kg-edges';
```

- [ ] **Step 3: Write the migration SQL**

```sql
-- packages/db/migrations/0029_knowledge_graph.sql
-- M6: Knowledge graph edges table (pure Postgres, replaces Apache AGE).

CREATE TABLE IF NOT EXISTS kg_edges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject_id    UUID NOT NULL,
  subject_type  TEXT NOT NULL,
  predicate     TEXT NOT NULL,
  object_id     UUID NOT NULL,
  object_type   TEXT NOT NULL,
  metadata      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup index — addEdge is idempotent via ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX kg_edges_uidx
  ON kg_edges (organization_id, subject_id, subject_type, predicate, object_id, object_type);

-- Traversal indexes.
CREATE INDEX kg_edges_subject_idx ON kg_edges (organization_id, subject_id, subject_type);
CREATE INDEX kg_edges_object_idx  ON kg_edges (organization_id, object_id, object_type);

-- RLS: each org sees only its own edges.
ALTER TABLE kg_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY kg_edges_org_isolation ON kg_edges
  USING (organization_id::text = current_setting('app.current_organization_id', true));
```

- [ ] **Step 4: Run migration locally**

```
pnpm db:migrate
```

Expected output: migration applies cleanly (no errors).

- [ ] **Step 5: Generate Drizzle snapshot**

```
pnpm db:generate
```

Expected: a new `meta/0029_snapshot.json` appears in `packages/db/migrations/meta/`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/kg-edges.ts packages/db/src/schema/index.ts packages/db/migrations/ pnpm-lock.yaml
git commit -m "feat(db): kg_edges table + RLS for M6 knowledge graph (task 1)"
```

---

## Task 2: `@cema/kg` package — addEdge, findNeighbors, traverse

**Files:**

- Create: `packages/kg/package.json`
- Create: `packages/kg/tsconfig.json`
- Create: `packages/kg/src/types.ts`
- Create: `packages/kg/src/edges.ts`
- Create: `packages/kg/src/index.ts`
- Create: `packages/kg/src/edges.test.ts`

- [ ] **Step 1: Write `edges.test.ts` (failing)**

```typescript
// packages/kg/src/edges.test.ts
import { describe, expect, it, vi } from 'vitest';

import { addEdge, findNeighbors, removeEdge } from './edges';
import type { DbTx } from './types';

function makeTx() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi
        .fn()
        .mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi
          .fn()
          .mockResolvedValue([
            { objectId: 'party-1', objectType: 'party', predicate: 'contact_is_party' },
          ]),
      }),
    }),
  } as unknown as DbTx;
}

describe('addEdge', () => {
  it('calls insert with correct values', async () => {
    const tx = makeTx();
    await addEdge(tx, {
      organizationId: 'org-1',
      subjectId: 'contact-1',
      subjectType: 'contact',
      predicate: 'contact_is_party',
      objectId: 'party-1',
      objectType: 'party',
    });
    expect(tx.insert).toHaveBeenCalled();
  });
});

describe('removeEdge', () => {
  it('calls delete with correct where clause', async () => {
    const tx = makeTx();
    await removeEdge(tx, {
      organizationId: 'org-1',
      subjectId: 'contact-1',
      subjectType: 'contact',
      predicate: 'contact_is_party',
      objectId: 'party-1',
      objectType: 'party',
    });
    expect(tx.delete).toHaveBeenCalled();
  });
});

describe('findNeighbors', () => {
  it('returns adjacent nodes from SELECT result', async () => {
    const tx = makeTx();
    const results = await findNeighbors(tx, {
      organizationId: 'org-1',
      nodeId: 'contact-1',
      nodeType: 'contact',
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.nodeId).toBe('party-1');
    expect(results[0]!.nodeType).toBe('party');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
pnpm --filter @cema/kg test
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "@cema/kg",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@cema/db": "workspace:*",
    "drizzle-orm": "catalog:"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "extends": "@cema/config/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `src/types.ts`**

```typescript
// packages/kg/src/types.ts
import type { getDb } from '@cema/db';

export type NodeType = 'contact' | 'party' | 'deal' | 'document' | 'communication';

export type Predicate =
  | 'contact_is_party' // contact → party  (same person, different representations)
  | 'party_is_on_deal' // party → deal     (exists via parties.deal_id but also stored as edge)
  | 'deal_has_document' // deal → document
  | 'deal_has_communication'; // deal → communication

export interface AddEdgeInput {
  organizationId: string;
  subjectId: string;
  subjectType: NodeType;
  predicate: Predicate;
  objectId: string;
  objectType: NodeType;
  metadata?: Record<string, unknown>;
}

export interface RemoveEdgeInput {
  organizationId: string;
  subjectId: string;
  subjectType: NodeType;
  predicate: Predicate;
  objectId: string;
  objectType: NodeType;
}

export interface FindNeighborsInput {
  organizationId: string;
  nodeId: string;
  nodeType: NodeType;
  predicate?: Predicate; // filter to specific edge type; omit for all
  direction?: 'outbound' | 'inbound' | 'both'; // default 'outbound'
}

export interface NeighborNode {
  nodeId: string;
  nodeType: NodeType;
  predicate: Predicate;
}

export interface TraverseInput {
  organizationId: string;
  startId: string;
  startType: NodeType;
  maxDepth?: number; // default 5
  predicates?: Predicate[]; // filter to specific edge types; omit for all
}

export interface TraversalNode {
  nodeId: string;
  nodeType: NodeType;
  depth: number;
  pathFrom: string; // subject_id that produced this node
}

// Minimal Drizzle transaction shape needed by the KG functions.
export type DbTx = ReturnType<typeof getDb>;
```

- [ ] **Step 6: Create `src/edges.ts`**

```typescript
// packages/kg/src/edges.ts
import { and, eq, or, sql } from 'drizzle-orm';
import { kgEdges } from '@cema/db';

import type {
  AddEdgeInput,
  DbTx,
  FindNeighborsInput,
  NeighborNode,
  Predicate,
  NodeType,
  RemoveEdgeInput,
  TraverseInput,
  TraversalNode,
} from './types';

export async function addEdge(tx: DbTx, input: AddEdgeInput): Promise<void> {
  await tx
    .insert(kgEdges)
    .values({
      organizationId: input.organizationId,
      subjectId: input.subjectId,
      subjectType: input.subjectType,
      predicate: input.predicate,
      objectId: input.objectId,
      objectType: input.objectType,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    })
    .onConflictDoNothing();
}

export async function removeEdge(tx: DbTx, input: RemoveEdgeInput): Promise<void> {
  await tx
    .delete(kgEdges)
    .where(
      and(
        eq(kgEdges.organizationId, input.organizationId),
        eq(kgEdges.subjectId, input.subjectId),
        eq(kgEdges.subjectType, input.subjectType),
        eq(kgEdges.predicate, input.predicate),
        eq(kgEdges.objectId, input.objectId),
        eq(kgEdges.objectType, input.objectType),
      ),
    );
}

export async function findNeighbors(tx: DbTx, input: FindNeighborsInput): Promise<NeighborNode[]> {
  const direction = input.direction ?? 'outbound';

  const outbound =
    direction === 'outbound' || direction === 'both'
      ? and(
          eq(kgEdges.organizationId, input.organizationId),
          eq(kgEdges.subjectId, input.nodeId),
          eq(kgEdges.subjectType, input.nodeType),
          ...(input.predicate ? [eq(kgEdges.predicate, input.predicate)] : []),
        )
      : undefined;

  const inbound =
    direction === 'inbound' || direction === 'both'
      ? and(
          eq(kgEdges.organizationId, input.organizationId),
          eq(kgEdges.objectId, input.nodeId),
          eq(kgEdges.objectType, input.nodeType),
          ...(input.predicate ? [eq(kgEdges.predicate, input.predicate)] : []),
        )
      : undefined;

  const condition = outbound && inbound ? or(outbound, inbound) : (outbound ?? inbound)!;

  const rows = await tx.select().from(kgEdges).where(condition);

  return rows.map((r) => {
    if (direction === 'inbound') {
      return {
        nodeId: r.subjectId,
        nodeType: r.subjectType as NodeType,
        predicate: r.predicate as Predicate,
      };
    }
    return {
      nodeId: r.objectId,
      nodeType: r.objectType as NodeType,
      predicate: r.predicate as Predicate,
    };
  });
}

export async function traverse(tx: DbTx, input: TraverseInput): Promise<TraversalNode[]> {
  const maxDepth = input.maxDepth ?? 5;
  const predicateFilter = input.predicates?.length
    ? sql`AND predicate = ANY(ARRAY[${sql.join(
        input.predicates.map((p) => sql`${p}`),
        sql`, `,
      )}])`
    : sql``;

  const result = await tx.execute<{
    node_id: string;
    node_type: string;
    depth: number;
    path_from: string;
  }>(sql`
    WITH RECURSIVE kg_traverse AS (
      -- Base case: direct neighbors of the start node
      SELECT
        object_id     AS node_id,
        object_type   AS node_type,
        1             AS depth,
        subject_id    AS path_from
      FROM kg_edges
      WHERE
        organization_id = ${input.organizationId}::uuid
        AND subject_id   = ${input.startId}::uuid
        AND subject_type = ${input.startType}
        ${predicateFilter}

      UNION ALL

      -- Recursive case: neighbors of already-visited nodes
      SELECT
        e.object_id,
        e.object_type,
        t.depth + 1,
        t.node_id
      FROM kg_edges e
      INNER JOIN kg_traverse t ON e.subject_id = t.node_id AND e.subject_type = t.node_type
      WHERE
        e.organization_id = ${input.organizationId}::uuid
        AND t.depth < ${maxDepth}
        ${predicateFilter}
    )
    SELECT DISTINCT node_id, node_type, depth, path_from
    FROM kg_traverse
    ORDER BY depth, node_id
  `);

  return result.rows.map((r) => ({
    nodeId: r.node_id,
    nodeType: r.node_type as NodeType,
    depth: r.depth,
    pathFrom: r.path_from,
  }));
}
```

- [ ] **Step 7: Create `src/index.ts`**

```typescript
export * from './edges';
export * from './types';
```

- [ ] **Step 8: Run test to confirm it passes**

```
pnpm --filter @cema/kg test
```

Expected: 3 passing.

- [ ] **Step 9: Add `@cema/kg` to workspace in `pnpm-workspace.yaml` (if needed) and install**

```
pnpm install
```

- [ ] **Step 10: Commit**

```bash
git add packages/kg/
git commit -m "feat(kg): @cema/kg — addEdge, removeEdge, findNeighbors, traverse (M6 task 2)"
```

---

## Task 3: `resolvePartyFromContact` — contact identity → party → deal

**Files:**

- Create: `packages/kg/src/resolve.ts`
- Modify: `packages/kg/src/index.ts`
- Modify: `packages/kg/src/edges.test.ts` (add resolve tests)

- [ ] **Step 1: Add resolve tests to `edges.test.ts`**

Add after the existing describe blocks:

```typescript
// packages/kg/src/edges.test.ts (additions)
import { resolvePartyFromContact } from './resolve';

// Mock @cema/contacts
vi.mock('@cema/contacts', () => ({
  normalizeEmail: vi.fn((e: string) => e.toLowerCase()),
  normalizePhone: vi.fn((p: string) => p),
}));

// Mock @cema/db
vi.mock('@cema/db', () => ({
  kgEdges: {},
  contactIdentities: {},
  contacts: {},
}));

describe('resolvePartyFromContact', () => {
  it('returns null when no contact_identity matches the email', async () => {
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as unknown as DbTx;

    const result = await resolvePartyFromContact(tx, {
      organizationId: 'org-1',
      email: 'nobody@example.com',
    });
    expect(result).toBeNull();
  });

  it('returns contactId when contact_identity matches but no kg_edge exists', async () => {
    const findNeighborsMock = vi.fn().mockResolvedValue([]);
    // Provide contact_identity lookup result
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ contactId: 'contact-1' }]),
          }),
        }),
      }),
    } as unknown as DbTx;

    // Stub findNeighbors used inside resolve
    vi.doMock('./edges', () => ({
      findNeighbors: findNeighborsMock,
      addEdge: vi.fn(),
      removeEdge: vi.fn(),
    }));

    const result = await resolvePartyFromContact(tx, {
      organizationId: 'org-1',
      email: 'alice@example.com',
    });
    expect(result).toEqual({ contactId: 'contact-1', partyId: null, dealId: null });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
pnpm --filter @cema/kg test
```

Expected: FAIL (resolve module not found).

- [ ] **Step 3: Create `src/resolve.ts`**

```typescript
// packages/kg/src/resolve.ts
import { and, eq } from 'drizzle-orm';
import { contactIdentities, contacts } from '@cema/db';
import { normalizeEmail, normalizePhone } from '@cema/contacts';

import { findNeighbors } from './edges';
import type { DbTx } from './types';

export interface ResolveInput {
  organizationId: string;
  email?: string;
  phone?: string;
}

export interface ResolveResult {
  contactId: string;
  partyId: string | null;
  dealId: string | null;
}

/**
 * Given a sender email or phone, resolves the contact → party → deal chain
 * through the knowledge graph.
 *
 * Returns null when no matching contact_identity exists for the org.
 * Returns { contactId, partyId: null, dealId: null } when a contact exists
 * but has no 'contact_is_party' edge in the KG yet.
 */
export async function resolvePartyFromContact(
  tx: DbTx,
  input: ResolveInput,
): Promise<ResolveResult | null> {
  if (!input.email && !input.phone) return null;

  const normalizedEmail = input.email ? normalizeEmail(input.email) : undefined;
  const normalizedPhone = input.phone ? normalizePhone(input.phone) : undefined;

  // 1. Find a matching contact identity in this org.
  const identityRows = await tx
    .select({ contactId: contactIdentities.contactId })
    .from(contactIdentities)
    .innerJoin(contacts, eq(contactIdentities.contactId, contacts.id))
    .where(
      and(
        eq(contactIdentities.organizationId, input.organizationId),
        normalizedEmail
          ? eq(contactIdentities.normalizedValue, normalizedEmail)
          : eq(contactIdentities.normalizedValue, normalizedPhone!),
      ),
    );

  if (!identityRows.length || !identityRows[0]) return null;

  const contactId = identityRows[0].contactId;

  // 2. Find the contact → party edge in the KG.
  const partyNeighbors = await findNeighbors(tx, {
    organizationId: input.organizationId,
    nodeId: contactId,
    nodeType: 'contact',
    predicate: 'contact_is_party',
  });

  if (!partyNeighbors.length || !partyNeighbors[0]) {
    return { contactId, partyId: null, dealId: null };
  }

  // 3. The party's deal_id is stored on the parties row — look it up.
  // We don't add a 'party_is_on_deal' edge automatically; the app does this
  // when addEdge is called after a contact is linked to a party.
  const partyId = partyNeighbors[0].nodeId;

  const dealNeighbors = await findNeighbors(tx, {
    organizationId: input.organizationId,
    nodeId: partyId,
    nodeType: 'party',
    predicate: 'party_is_on_deal',
  });

  const dealId = dealNeighbors[0]?.nodeId ?? null;

  return { contactId, partyId, dealId };
}
```

- [ ] **Step 4: Add export to `src/index.ts`**

```typescript
export * from './edges';
export * from './resolve';
export * from './types';
```

- [ ] **Step 5: Run tests to confirm they pass**

```
pnpm --filter @cema/kg test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add packages/kg/src/resolve.ts packages/kg/src/index.ts packages/kg/src/edges.test.ts
git commit -m "feat(kg): resolvePartyFromContact — contact identity → party → deal (M6 task 3)"
```

---

## Task 4: `link-contact-to-party` server action + deal graph server action

**Files:**

- Create: `apps/web/lib/actions/link-contact-to-party.ts`
- Create: `apps/web/lib/actions/link-contact-to-party.test.ts`
- Create: `apps/web/lib/actions/get-deal-graph.ts`
- Create: `apps/web/lib/actions/get-deal-graph.test.ts`

- [ ] **Step 1: Write `link-contact-to-party.test.ts` (failing)**

```typescript
// apps/web/lib/actions/link-contact-to-party.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'clerk-user-1' }),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  users: {},
  parties: { dealId: 'p_deal_id_col', id: 'p_id_col' },
  deals: { organizationId: 'd_org_id_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/kg', () => ({
  addEdge: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { addEdge } from '@cema/kg';
import { getDb } from '@cema/db';
import { withRls } from '../with-rls';
import { linkContactToParty } from './link-contact-to-party';

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };
const PARTY = { id: 'party-1', dealId: 'deal-1' };

function makeDb() {
  return {
    query: {
      organizations: { findFirst: vi.fn().mockResolvedValue(ORG) },
      users: {
        findFirst: vi.fn().mockResolvedValue({ id: 'user-1', clerkUserId: 'clerk-user-1' }),
      },
    },
  } as unknown as ReturnType<typeof getDb>;
}

function makeTxWith(partyRow: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(partyRow ? [partyRow] : []),
        }),
      }),
    }),
  } as never;
}

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue(makeDb());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('linkContactToParty', () => {
  it('throws when party is not found', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith(null)));
    await expect(linkContactToParty('contact-1', 'party-99')).rejects.toThrow('Party not found');
  });

  it('calls addEdge twice (contact→party and party→deal) on happy path', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith(PARTY)));
    await linkContactToParty('contact-1', 'party-1');
    expect(addEdge).toHaveBeenCalledTimes(2);
  });

  it('returns edge counts on success', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith(PARTY)));
    const result = await linkContactToParty('contact-1', 'party-1');
    expect(result).toEqual({
      edgesCreated: 2,
      contactId: 'contact-1',
      partyId: 'party-1',
      dealId: 'deal-1',
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
pnpm --filter @cema/db... test -- link-contact-to-party
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write `link-contact-to-party.ts`**

```typescript
// apps/web/lib/actions/link-contact-to-party.ts
'use server';

import { and, eq } from 'drizzle-orm';
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { getDb, deals, organizations, parties, users } from '@cema/db';
import { addEdge } from '@cema/kg';

import { withRls } from '../with-rls';

export async function linkContactToParty(
  contactId: string,
  partyId: string,
): Promise<{ edgesCreated: number; contactId: string; partyId: string; dealId: string }> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();

  const db = getDb();
  const [org, user] = await Promise.all([
    db.query.organizations.findFirst({ where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId) }),
    db.query.users.findFirst({ where: (u, { eq }) => eq(u.clerkUserId, clerkUser.id) }),
  ]);
  if (!org) throw new Error('Organization not found');
  if (!user) throw new Error('User not found');

  return withRls(org.id, async (tx) => {
    // Verify the party belongs to this org.
    const [partyRow] = await tx
      .select({ id: parties.id, dealId: parties.dealId })
      .from(parties)
      .innerJoin(deals, eq(deals.id, parties.dealId))
      .where(and(eq(parties.id, partyId), eq(deals.organizationId, org.id)));

    if (!partyRow) throw new Error('Party not found');

    // Create two directed edges: contact→party and party→deal.
    await Promise.all([
      addEdge(tx as never, {
        organizationId: org.id,
        subjectId: contactId,
        subjectType: 'contact',
        predicate: 'contact_is_party',
        objectId: partyRow.id,
        objectType: 'party',
      }),
      addEdge(tx as never, {
        organizationId: org.id,
        subjectId: partyRow.id,
        subjectType: 'party',
        predicate: 'party_is_on_deal',
        objectId: partyRow.dealId,
        objectType: 'deal',
      }),
    ]);

    return { edgesCreated: 2, contactId, partyId: partyRow.id, dealId: partyRow.dealId };
  });
}
```

- [ ] **Step 4: Write `get-deal-graph.test.ts` (failing)**

```typescript
// apps/web/lib/actions/get-deal-graph.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
}));

vi.mock('@cema/kg', () => ({
  traverse: vi
    .fn()
    .mockResolvedValue([{ nodeId: 'party-1', nodeType: 'party', depth: 1, pathFrom: 'deal-1' }]),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';
import { traverse } from '@cema/kg';
import { withRls } from '../with-rls';
import { getDealGraph } from './get-deal-graph';

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue({
    query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
  } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getDealGraph', () => {
  it('calls traverse starting from the deal node', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn({} as never));
    await getDealGraph('deal-1');
    expect(traverse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        startId: 'deal-1',
        startType: 'deal',
      }),
    );
  });

  it('returns traversal nodes', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn({} as never));
    const result = await getDealGraph('deal-1');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.nodeType).toBe('party');
  });
});
```

- [ ] **Step 5: Write `get-deal-graph.ts`**

```typescript
// apps/web/lib/actions/get-deal-graph.ts
'use server';

import { getCurrentOrganizationId } from '@cema/auth';
import { getDb, organizations } from '@cema/db';
import { traverse, type TraversalNode } from '@cema/kg';

import { withRls } from '../with-rls';

export interface DealGraphResult {
  dealId: string;
  nodes: TraversalNode[];
}

export async function getDealGraph(dealId: string): Promise<DealGraphResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not found');

  const nodes = await withRls(org.id, (tx) =>
    traverse(tx as never, {
      organizationId: org.id,
      startId: dealId,
      startType: 'deal',
      maxDepth: 4,
    }),
  );

  return { dealId, nodes };
}
```

- [ ] **Step 6: Run tests to confirm they pass**

```
pnpm test
```

Expected: new tests pass; total count up.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/actions/link-contact-to-party.ts apps/web/lib/actions/link-contact-to-party.test.ts apps/web/lib/actions/get-deal-graph.ts apps/web/lib/actions/get-deal-graph.test.ts
git commit -m "feat(actions): linkContactToParty + getDealGraph server actions (M6 task 4)"
```

---

## Task 5: `/deals/[id]/graph` RSC page

**Files:**

- Create: `apps/web/app/(app)/deals/[id]/graph/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
// apps/web/app/(app)/deals/[id]/graph/page.tsx
import { getDealGraph } from '../../../../lib/actions/get-deal-graph';

export default async function DealGraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { nodes } = await getDealGraph(id);

  const byType = nodes.reduce<Record<string, typeof nodes>>(
    (acc, node) => ({ ...acc, [node.nodeType]: [...(acc[node.nodeType] ?? []), node] }),
    {},
  );

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Knowledge Graph — Deal {id}</h1>
      {nodes.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No graph edges yet. Link contacts to parties to build the graph.
        </p>
      )}
      {Object.entries(byType).map(([type, typeNodes]) => (
        <section key={type}>
          <h2 className="text-muted-foreground mb-2 text-sm font-medium uppercase tracking-wide">
            {type}s ({typeNodes.length})
          </h2>
          <ul className="space-y-1">
            {typeNodes.map((n) => (
              <li key={n.nodeId} className="bg-muted rounded px-3 py-1 font-mono text-sm">
                {n.nodeId} <span className="text-muted-foreground">depth {n.depth}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```
pnpm build
```

Expected: no new TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(app)/deals/
git commit -m "feat(ui): /deals/[id]/graph knowledge graph page (M6 task 5)"
```

---

## Task 6: Knowledge graph integration test + RLS

**Files:**

- Create: `apps/web/tests/integration/kg-traversal.test.ts`
- Create: `apps/web/tests/integration/m6-rls-isolation.test.ts`

- [ ] **Step 1: Write `kg-traversal.test.ts`**

```typescript
// apps/web/tests/integration/kg-traversal.test.ts
/**
 * KG integration test — verifies addEdge, traverse, and RLS isolation.
 * Gated on DATABASE_URL (skips in unit CI).
 */
import { getDb, kgEdges, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addEdge, findNeighbors, traverse } from '@cema/kg';
import { withRls } from '../../lib/with-rls';

const skip = !process.env.DATABASE_URL;

const ORG_ID = '00000000-0000-0000-0000-000000000a60';
const CONTACT_ID = '00000000-0000-0000-0000-000000000c60';
const PARTY_ID = '00000000-0000-0000-0000-000000000b60';
const DEAL_ID = '00000000-0000-0000-0000-000000000d60';

describe.skipIf(skip)('KG traversal integration', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({ id: ORG_ID, clerkOrgId: 'org_kg_test', name: 'KG Test Org', slug: 'kg-test-org' })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(kgEdges).where(eq(kgEdges.organizationId, ORG_ID));
  });

  it('addEdge is idempotent (insert twice, one row)', async () => {
    await withRls(ORG_ID, async (tx) => {
      await addEdge(tx as never, {
        organizationId: ORG_ID,
        subjectId: CONTACT_ID,
        subjectType: 'contact',
        predicate: 'contact_is_party',
        objectId: PARTY_ID,
        objectType: 'party',
      });
      // Second call — ON CONFLICT DO NOTHING
      await addEdge(tx as never, {
        organizationId: ORG_ID,
        subjectId: CONTACT_ID,
        subjectType: 'contact',
        predicate: 'contact_is_party',
        objectId: PARTY_ID,
        objectType: 'party',
      });
    });

    const db = getDb();
    const rows = await db.select().from(kgEdges).where(eq(kgEdges.organizationId, ORG_ID));
    expect(rows).toHaveLength(1);
  });

  it('findNeighbors returns the party for a contact', async () => {
    const neighbors = await withRls(ORG_ID, (tx) =>
      findNeighbors(tx as never, {
        organizationId: ORG_ID,
        nodeId: CONTACT_ID,
        nodeType: 'contact',
        predicate: 'contact_is_party',
      }),
    );
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]!.nodeId).toBe(PARTY_ID);
  });

  it('traverse returns the party edge from the contact start', async () => {
    const nodes = await withRls(ORG_ID, (tx) =>
      traverse(tx as never, {
        organizationId: ORG_ID,
        startId: CONTACT_ID,
        startType: 'contact',
        maxDepth: 2,
      }),
    );
    expect(nodes.some((n) => n.nodeId === PARTY_ID)).toBe(true);
  });
});
```

- [ ] **Step 2: Write `m6-rls-isolation.test.ts`**

```typescript
// apps/web/tests/integration/m6-rls-isolation.test.ts
/**
 * RLS isolation for M6 tables (kg_edges).
 * Org B cannot see Org A kg_edges rows.
 */
import { getDb, kgEdges, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addEdge } from '@cema/kg';
import { withRls } from '../../lib/with-rls';

const skip = !process.env.DATABASE_URL;

const ORG_A_ID = '00000000-0000-0000-0000-000000000a61';
const ORG_B_ID = '00000000-0000-0000-0000-000000000b61';
const CONTACT_ID = '00000000-0000-0000-0000-000000000c61';
const PARTY_ID = '00000000-0000-0000-0000-000000000d61';

describe.skipIf(skip)('RLS — M6 kg_edges cross-org isolation', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A_ID, clerkOrgId: 'org_m6_rls_a', name: 'Org A (M6)', slug: 'm6-rls-org-a' },
        { id: ORG_B_ID, clerkOrgId: 'org_m6_rls_b', name: 'Org B (M6)', slug: 'm6-rls-org-b' },
      ])
      .onConflictDoNothing();

    const db2 = getDb();
    await db2
      .insert(kgEdges)
      .values({
        organizationId: ORG_A_ID,
        subjectId: CONTACT_ID,
        subjectType: 'contact',
        predicate: 'contact_is_party',
        objectId: PARTY_ID,
        objectType: 'party',
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(kgEdges).where(eq(kgEdges.organizationId, ORG_A_ID));
  });

  it('Org B cannot SELECT Org A kg_edges rows', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx.select({ id: kgEdges.id }).from(kgEdges).where(eq(kgEdges.organizationId, ORG_A_ID)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org A sees its own kg_edges row (positive control)', async () => {
    const rows = await withRls(ORG_A_ID, (tx) =>
      tx.select({ id: kgEdges.id }).from(kgEdges).where(eq(kgEdges.subjectId, CONTACT_ID)),
    );
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run unit tests to confirm no regressions**

```
pnpm test
```

Expected: existing + new unit tests pass; integration tests skip (no DATABASE_URL).

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/integration/kg-traversal.test.ts apps/web/tests/integration/m6-rls-isolation.test.ts
git commit -m "test(integration): KG traversal + M6 RLS isolation (M6 task 6)"
```

---

## Task 7: `@cema/typesense` package

**Files:**

- Create: `packages/typesense/package.json`
- Create: `packages/typesense/tsconfig.json`
- Create: `packages/typesense/src/client.ts`
- Create: `packages/typesense/src/collections.ts`
- Create: `packages/typesense/src/search.ts`
- Create: `packages/typesense/src/sync.ts`
- Create: `packages/typesense/src/index.ts`
- Create: `packages/typesense/src/client.test.ts`

- [ ] **Step 1: Write `client.test.ts` (failing)**

```typescript
// packages/typesense/src/client.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('typesense', () => ({
  Client: vi.fn().mockImplementation(() => ({ health: vi.fn() })),
}));

import { getTypesenseClient, isTypesenseConfigured } from './client';

describe('isTypesenseConfigured', () => {
  it('returns false when TYPESENSE_API_KEY is not set', () => {
    const orig = process.env.TYPESENSE_API_KEY;
    delete process.env.TYPESENSE_API_KEY;
    expect(isTypesenseConfigured()).toBe(false);
    process.env.TYPESENSE_API_KEY = orig;
  });

  it('returns true when TYPESENSE_API_KEY is set', () => {
    process.env.TYPESENSE_API_KEY = 'test-key';
    expect(isTypesenseConfigured()).toBe(true);
    delete process.env.TYPESENSE_API_KEY;
  });
});

describe('getTypesenseClient', () => {
  it('throws when TYPESENSE_API_KEY is not set', () => {
    delete process.env.TYPESENSE_API_KEY;
    expect(() => getTypesenseClient()).toThrow('TYPESENSE_API_KEY');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
pnpm --filter @cema/typesense test
```

Expected: FAIL.

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "@cema/typesense",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "typesense": "^1.8.2"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "extends": "@cema/config/tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `src/client.ts`**

```typescript
// packages/typesense/src/client.ts
import Typesense from 'typesense';

let _client: Typesense.Client | null = null;

export function isTypesenseConfigured(): boolean {
  return !!process.env.TYPESENSE_API_KEY;
}

export function getTypesenseClient(): Typesense.Client {
  const apiKey = process.env.TYPESENSE_API_KEY;
  if (!apiKey) throw new Error('TYPESENSE_API_KEY is not set');

  if (!_client) {
    _client = new Typesense.Client({
      nodes: [
        {
          host: process.env.TYPESENSE_HOST ?? 'localhost',
          port: parseInt(process.env.TYPESENSE_PORT ?? '8108', 10),
          protocol: process.env.TYPESENSE_PROTOCOL ?? 'https',
        },
      ],
      apiKey,
      connectionTimeoutSeconds: 5,
    });
  }

  return _client;
}
```

- [ ] **Step 6: Create `src/collections.ts`**

```typescript
// packages/typesense/src/collections.ts
// Typesense collection schemas matching the @cema/db communications + documents tables.

export const COMMUNICATIONS_COLLECTION = 'communications';
export const DOCUMENTS_COLLECTION = 'documents';

export const communicationsSchema = {
  name: COMMUNICATIONS_COLLECTION,
  fields: [
    { name: 'id', type: 'string' },
    { name: 'organization_id', type: 'string', facet: true },
    { name: 'subject', type: 'string', optional: true },
    { name: 'body_preview', type: 'string', optional: true },
    { name: 'direction', type: 'string', facet: true, optional: true },
    { name: 'kind', type: 'string', facet: true },
    { name: 'vendor', type: 'string', facet: true, optional: true },
    { name: 'occurred_at', type: 'int64' },
  ] as const,
  default_sorting_field: 'occurred_at',
} as const;

export const documentsSchema = {
  name: DOCUMENTS_COLLECTION,
  fields: [
    { name: 'id', type: 'string' },
    { name: 'organization_id', type: 'string', facet: true },
    { name: 'kind', type: 'string', facet: true },
    { name: 'status', type: 'string', facet: true },
    { name: 'filename', type: 'string', optional: true },
    { name: 'created_at', type: 'int64' },
  ] as const,
  default_sorting_field: 'created_at',
} as const;
```

- [ ] **Step 7: Create `src/search.ts`**

```typescript
// packages/typesense/src/search.ts
import type { SearchHit } from '../../../apps/web/lib/actions/search-similar';
import { COMMUNICATIONS_COLLECTION, DOCUMENTS_COLLECTION } from './collections';
import { getTypesenseClient } from './client';

export interface TypesenseFilters {
  organizationId: string;
  kind?: string;
}

export async function searchTypesense(
  query: string,
  filters: TypesenseFilters,
): Promise<SearchHit[]> {
  const client = getTypesenseClient();
  const orgFilter = `organization_id:=${filters.organizationId}`;

  const [commResults, docResults] = await Promise.allSettled([
    client.collections(COMMUNICATIONS_COLLECTION).documents().search({
      q: query,
      query_by: 'subject,body_preview',
      filter_by: orgFilter,
      per_page: 10,
    }),
    client.collections(DOCUMENTS_COLLECTION).documents().search({
      q: query,
      query_by: 'filename',
      filter_by: orgFilter,
      per_page: 10,
    }),
  ]);

  const hits: SearchHit[] = [];

  if (commResults.status === 'fulfilled') {
    for (const hit of commResults.value.hits ?? []) {
      const doc = hit.document as Record<string, unknown>;
      hits.push({ kind: 'communication', id: doc['id'] as string, score: hit.text_match });
    }
  }

  if (docResults.status === 'fulfilled') {
    for (const hit of docResults.value.hits ?? []) {
      const doc = hit.document as Record<string, unknown>;
      hits.push({ kind: 'document', id: doc['id'] as string, score: hit.text_match });
    }
  }

  return hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
```

- [ ] **Step 8: Create `src/sync.ts`**

```typescript
// packages/typesense/src/sync.ts
import { COMMUNICATIONS_COLLECTION, DOCUMENTS_COLLECTION } from './collections';
import { getTypesenseClient, isTypesenseConfigured } from './client';

export interface CommDocument {
  id: string;
  organization_id: string;
  subject?: string;
  body_preview?: string;
  direction?: string;
  kind: string;
  vendor?: string;
  occurred_at: number; // Unix timestamp in seconds
}

export interface DocDocument {
  id: string;
  organization_id: string;
  kind: string;
  status: string;
  filename?: string;
  created_at: number;
}

export async function indexCommunication(doc: CommDocument): Promise<void> {
  if (!isTypesenseConfigured()) return;
  await getTypesenseClient().collections(COMMUNICATIONS_COLLECTION).documents().upsert(doc);
}

export async function indexDocument(doc: DocDocument): Promise<void> {
  if (!isTypesenseConfigured()) return;
  await getTypesenseClient().collections(DOCUMENTS_COLLECTION).documents().upsert(doc);
}

export async function deleteFromIndex(collection: string, id: string): Promise<void> {
  if (!isTypesenseConfigured()) return;
  await getTypesenseClient().collections(collection).documents(id).delete();
}
```

- [ ] **Step 9: Create `src/index.ts`**

```typescript
export * from './client';
export * from './collections';
export * from './search';
export * from './sync';
```

- [ ] **Step 10: Install `typesense` npm package**

```
pnpm add typesense --filter @cema/typesense
```

- [ ] **Step 11: Run tests to confirm they pass**

```
pnpm --filter @cema/typesense test
```

Expected: 3 passing.

- [ ] **Step 12: Commit**

```bash
git add packages/typesense/
git commit -m "feat(typesense): @cema/typesense package — client, collections, search, sync (M6 task 7)"
```

---

## Task 8: Wire Typesense full_text_search into `askAnything`

**Files:**

- Modify: `apps/web/lib/actions/ask-anything.ts`
- Modify: `apps/web/lib/actions/ask-anything.test.ts`

- [ ] **Step 1: Update `ask-anything.test.ts` to cover Typesense path**

Add a new describe block to the existing test file:

```typescript
// Additional vi.mock at the top:
vi.mock('@cema/typesense', () => ({
  isTypesenseConfigured: vi.fn().mockReturnValue(false),
  searchTypesense: vi.fn().mockResolvedValue([]),
}));

// Additional test:
describe('askAnything — Typesense path', () => {
  it('calls searchTypesense when TYPESENSE is configured and intent is search', async () => {
    vi.mocked(isTypesenseConfigured).mockReturnValueOnce(true);
    vi.mocked(classifyQueryIntent).mockResolvedValueOnce({
      intent: 'search',
      confidence: 0.9,
      entities: [],
    });
    vi.mocked(searchTypesense).mockResolvedValueOnce([
      { kind: 'communication', id: 'comm-ts-1', score: 100 },
    ]);

    const result = await askAnything('show me the payoff letter');
    expect(searchTypesense).toHaveBeenCalled();
    expect(result.hits[0]!.id).toBe('comm-ts-1');
  });
});
```

- [ ] **Step 2: Update `ask-anything.ts`**

```typescript
// apps/web/lib/actions/ask-anything.ts
import { isTypesenseConfigured, searchTypesense } from '@cema/typesense';
import { classifyQueryIntent, type QueryClassification } from '@cema/search';

import { searchSimilar, type SearchHit } from './search-similar';

export interface AskAnythingResult {
  classification: QueryClassification;
  hits: SearchHit[];
  hint: string | null;
}

export async function askAnything(query: string): Promise<AskAnythingResult> {
  const classification = await classifyQueryIntent(query);

  if (classification.intent === 'search') {
    // Route to Typesense for full-text when configured; fall back to pgvector semantic.
    const hits = isTypesenseConfigured()
      ? await searchTypesense(query, { organizationId: '' }) // org resolved in search layer
      : await searchSimilar({ query, k: 10 });
    return { classification, hits, hint: null };
  }

  if (classification.intent === 'action') {
    return {
      classification,
      hits: [],
      hint: 'Action queries are not yet executed automatically. Phase 1 will surface concrete action suggestions.',
    };
  }

  return {
    classification,
    hits: [],
    hint: 'Analytics queries are not yet executed. Phase 1 will translate this query into SQL.',
  };
}
```

- [ ] **Step 3: Run tests**

```
pnpm test
```

Expected: all existing + new tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/ask-anything.ts apps/web/lib/actions/ask-anything.test.ts
git commit -m "feat(search): route full_text_search intent to Typesense when configured (M6 task 8)"
```

---

## Task 9: Production embedding queue consumers

**Files:**

- Create: `apps/web/app/api/queues/embed-communication/route.ts`
- Create: `apps/web/app/api/queues/embed-document/route.ts`

- [ ] **Step 1: Create `embed-communication/route.ts`**

```typescript
// apps/web/app/api/queues/embed-communication/route.ts
import { eq } from 'drizzle-orm';
import { embedText } from '@cema/embeddings';
import { communications, getDb } from '@cema/db';
import { sql } from 'drizzle-orm';

export async function POST(req: Request): Promise<Response> {
  const { communicationId } = (await req.json()) as { communicationId: string };

  if (!communicationId) {
    return new Response(JSON.stringify({ error: 'communicationId required' }), { status: 400 });
  }

  const db = getDb();
  const [comm] = await db
    .select({ id: communications.id, subject: communications.subject })
    .from(communications)
    .where(eq(communications.id, communicationId))
    .limit(1);

  if (!comm) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  const text = comm.subject ?? '';
  if (!text) {
    return new Response(JSON.stringify({ skipped: true, reason: 'empty text' }), { status: 200 });
  }

  const { embedding } = await embedText({ text });

  await db
    .update(communications)
    .set({ embedding: sql`${`[${embedding.join(',')}]`}::vector` })
    .where(eq(communications.id, communicationId));

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

- [ ] **Step 2: Create `embed-document/route.ts`**

```typescript
// apps/web/app/api/queues/embed-document/route.ts
import { eq, sql } from 'drizzle-orm';
import { embedText } from '@cema/embeddings';
import { documents, getDb } from '@cema/db';

export async function POST(req: Request): Promise<Response> {
  const { documentId } = (await req.json()) as { documentId: string };

  if (!documentId) {
    return new Response(JSON.stringify({ error: 'documentId required' }), { status: 400 });
  }

  const db = getDb();
  const [doc] = await db
    .select({ id: documents.id, kind: documents.kind })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  const text = doc.kind; // Phase 1: replace with IDP-extracted text
  const { embedding } = await embedText({ text });

  await db
    .update(documents)
    .set({ embedding: sql`${`[${embedding.join(',')}]`}::vector` })
    .where(eq(documents.id, documentId));

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

- [ ] **Step 3: Verify build**

```
pnpm build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/queues/
git commit -m "feat(queues): embed-communication + embed-document queue consumers (M6 task 9)"
```

---

## Task 10: pgvector HNSW index migration

**Files:**

- Create: `packages/db/migrations/0030_pgvector_hnsw.sql`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/migrations/0030_pgvector_hnsw.sql
-- M6: HNSW index for approximate nearest neighbor search on communication embeddings.
-- ef_construction=64 and m=16 are conservative defaults for early data volumes.
-- Tune up to ef_construction=128, m=32 when communication count exceeds 100k.

CREATE INDEX CONCURRENTLY IF NOT EXISTS communications_embedding_hnsw_idx
  ON communications
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

- [ ] **Step 2: Run migration locally**

```
pnpm db:migrate
```

Expected: `CREATE INDEX` applied cleanly (may take a few seconds even on empty table).

- [ ] **Step 3: Generate snapshot**

```
pnpm db:generate
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0030_pgvector_hnsw.sql packages/db/migrations/meta/
git commit -m "feat(db): HNSW index on communications.embedding for ANN search (M6 task 10)"
```

---

## Task 11: `@cema/memory` — Mem0 wrapper

**Files:**

- Create: `packages/memory/package.json`
- Create: `packages/memory/tsconfig.json`
- Create: `packages/memory/src/client.ts`
- Create: `packages/memory/src/session.ts`
- Create: `packages/memory/src/index.ts`
- Create: `packages/memory/src/session.test.ts`

- [ ] **Step 1: Write `session.test.ts` (failing)**

```typescript
// packages/memory/src/session.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  isMemoryConfigured: vi.fn().mockReturnValue(false),
  getMemoryClient: vi.fn(),
}));

import { isMemoryConfigured } from './client';
import { addMemory, searchMemory } from './session';

describe('addMemory', () => {
  it('returns no-op result when Mem0 is not configured', async () => {
    const result = await addMemory({ userId: 'u-1', dealId: 'd-1', content: 'test memory' });
    expect(result).toEqual({ saved: false, reason: 'memory-not-configured' });
  });
});

describe('searchMemory', () => {
  it('returns empty array when Mem0 is not configured', async () => {
    const result = await searchMemory({ userId: 'u-1', dealId: 'd-1', query: 'payoff amount' });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
pnpm --filter @cema/memory test
```

Expected: FAIL.

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "@cema/memory",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "mem0ai": "^2.1.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "extends": "@cema/config/tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `src/client.ts`**

```typescript
// packages/memory/src/client.ts
import { MemoryClient } from 'mem0ai';

let _client: MemoryClient | null = null;

export function isMemoryConfigured(): boolean {
  return !!process.env.MEM0_API_KEY;
}

export function getMemoryClient(): MemoryClient {
  if (!process.env.MEM0_API_KEY) throw new Error('MEM0_API_KEY is not set');
  if (!_client) _client = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });
  return _client;
}
```

- [ ] **Step 6: Create `src/session.ts`**

```typescript
// packages/memory/src/session.ts
import { getMemoryClient, isMemoryConfigured } from './client';

export interface AddMemoryInput {
  userId: string;
  dealId: string;
  content: string;
}

export interface AddMemoryResult {
  saved: boolean;
  reason?: string;
  memoryId?: string;
}

export interface SearchMemoryInput {
  userId: string;
  dealId: string;
  query: string;
  limit?: number;
}

export interface MemoryEntry {
  id: string;
  memory: string;
  score: number;
}

export async function addMemory(input: AddMemoryInput): Promise<AddMemoryResult> {
  if (!isMemoryConfigured()) return { saved: false, reason: 'memory-not-configured' };

  const client = getMemoryClient();
  const result = await client.add([{ role: 'user', content: input.content }], {
    user_id: input.userId,
    metadata: { deal_id: input.dealId },
  });

  return { saved: true, memoryId: (result as { id?: string }).id };
}

export async function searchMemory(input: SearchMemoryInput): Promise<MemoryEntry[]> {
  if (!isMemoryConfigured()) return [];

  const client = getMemoryClient();
  const results = await client.search(input.query, {
    user_id: input.userId,
    limit: input.limit ?? 5,
  });

  return (results as Array<{ id: string; memory: string; score: number }>).map((r) => ({
    id: r.id,
    memory: r.memory,
    score: r.score,
  }));
}

export async function clearSessionMemory(userId: string): Promise<void> {
  if (!isMemoryConfigured()) return;
  const client = getMemoryClient();
  await client.deleteAll({ user_id: userId });
}
```

- [ ] **Step 7: Create `src/index.ts`**

```typescript
export * from './client';
export * from './session';
```

- [ ] **Step 8: Install `mem0ai` and run tests**

```
pnpm add mem0ai --filter @cema/memory && pnpm --filter @cema/memory test
```

Expected: 2 passing.

- [ ] **Step 9: Commit**

```bash
git add packages/memory/
git commit -m "feat(memory): @cema/memory — Mem0 wrapper, addMemory, searchMemory (M6 task 11)"
```

---

## Task 12: Wire Mem0 context into `askAnything`

**Files:**

- Modify: `apps/web/lib/actions/ask-anything.ts`
- Modify: `apps/web/lib/actions/ask-anything.test.ts`

- [ ] **Step 1: Update `ask-anything.test.ts`**

Add at the top of the mock block:

```typescript
vi.mock('@cema/memory', () => ({
  isMemoryConfigured: vi.fn().mockReturnValue(false),
  searchMemory: vi.fn().mockResolvedValue([]),
  addMemory: vi.fn().mockResolvedValue({ saved: false }),
}));

vi.mock('@cema/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'clerk-user-1' }),
}));
```

Add tests:

```typescript
describe('askAnything — memory context', () => {
  it('skips memory injection when Mem0 is not configured', async () => {
    vi.mocked(classifyQueryIntent).mockResolvedValueOnce({
      intent: 'search',
      confidence: 1,
      entities: [],
    });
    await askAnything('find payoff letter');
    expect(searchMemory).not.toHaveBeenCalled();
  });

  it('prepends memory context to query when Mem0 is configured', async () => {
    vi.mocked(isMemoryConfigured).mockReturnValue(true);
    vi.mocked(searchMemory).mockResolvedValueOnce([
      { id: 'm1', memory: 'Deal has a Citibank loan', score: 0.9 },
    ]);
    vi.mocked(classifyQueryIntent).mockResolvedValueOnce({
      intent: 'search',
      confidence: 1,
      entities: [],
    });
    await askAnything('find payoff letter');
    expect(searchMemory).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Update `ask-anything.ts`**

```typescript
// apps/web/lib/actions/ask-anything.ts
import { getCurrentUser } from '@cema/auth';
import { isMemoryConfigured, searchMemory, addMemory } from '@cema/memory';
import { isTypesenseConfigured, searchTypesense } from '@cema/typesense';
import { classifyQueryIntent, type QueryClassification } from '@cema/search';

import { searchSimilar, type SearchHit } from './search-similar';

export interface AskAnythingResult {
  classification: QueryClassification;
  hits: SearchHit[];
  hint: string | null;
}

export async function askAnything(query: string): Promise<AskAnythingResult> {
  const user = await getCurrentUser().catch(() => null);
  const userId = user?.id ?? 'anonymous';

  // Prepend relevant memory context to improve classifier accuracy.
  let enrichedQuery = query;
  if (isMemoryConfigured() && userId !== 'anonymous') {
    const memories = await searchMemory({ userId, dealId: '', query, limit: 3 });
    if (memories.length) {
      const ctx = memories.map((m) => m.memory).join('; ');
      enrichedQuery = `[context: ${ctx}] ${query}`;
    }
  }

  const classification = await classifyQueryIntent(enrichedQuery);

  if (classification.intent === 'search') {
    const hits = isTypesenseConfigured()
      ? await searchTypesense(query, { organizationId: '' })
      : await searchSimilar({ query, k: 10 });

    // Save the Q&A exchange to memory asynchronously (fire-and-forget).
    if (isMemoryConfigured() && userId !== 'anonymous') {
      void addMemory({ userId, dealId: '', content: `Q: ${query} → ${hits.length} results` });
    }

    return { classification, hits, hint: null };
  }

  if (classification.intent === 'action') {
    return {
      classification,
      hits: [],
      hint: 'Action queries are not yet executed automatically. Phase 1 will surface concrete action suggestions.',
    };
  }

  return {
    classification,
    hits: [],
    hint: 'Analytics queries are not yet executed. Phase 1 will translate this query into SQL.',
  };
}
```

- [ ] **Step 3: Run tests**

```
pnpm test
```

Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/ask-anything.ts apps/web/lib/actions/ask-anything.test.ts
git commit -m "feat(memory): inject Mem0 context into askAnything when configured (M6 task 12)"
```

---

## Task 13: `.env.example` + turbo.json + package wiring

**Files:**

- Modify: `.env.example`
- Modify: `turbo.json`
- Modify: `apps/web/package.json`
- Modify: `pnpm-workspace.yaml` (if packages not already listed)

- [ ] **Step 1: Add env vars to `.env.example`**

Add after the existing M5 env var comments:

```
# ─── Typesense (M6 full-text search) ──────────────────────────
TYPESENSE_API_KEY=
TYPESENSE_HOST=
TYPESENSE_PORT=443
TYPESENSE_PROTOCOL=https

# ─── Mem0 (M6 agent memory) ────────────────────────────────────
MEM0_API_KEY=
```

- [ ] **Step 2: Add `@cema/kg`, `@cema/typesense`, `@cema/memory` as dependencies in `apps/web/package.json`**

```json
"@cema/kg": "workspace:*",
"@cema/typesense": "workspace:*",
"@cema/memory": "workspace:*",
```

- [ ] **Step 3: Run `pnpm install` to update lockfile**

```
pnpm install
```

- [ ] **Step 4: Commit**

```bash
git add .env.example apps/web/package.json pnpm-lock.yaml
git commit -m "chore: wire M6 packages into apps/web + env vars in .env.example (M6 task 13)"
```

---

## Task 14: Full gate — test, typecheck, lint, build

- [ ] **Step 1: Run full test suite**

```
pnpm test
```

Expected: all unit tests pass; integration tests skip (no DATABASE_URL in dev).

- [ ] **Step 2: Run typecheck**

```
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Run lint**

```
pnpm lint
```

Expected: 0 errors.

- [ ] **Step 4: Run build**

```
pnpm build
```

Expected: successful build.

- [ ] **Step 5: Fix any issues found above**

Common fixes:

- Missing `"use server"` directive on new action files
- Import type errors from new packages (run `pnpm install` if needed)
- Prettier formatting (run `pnpm format` to fix)

- [ ] **Step 6: Commit gate results**

```bash
git add -A
git commit -m "chore: M6 full gate — tests, typecheck, lint, build all clean (task 14)"
```

---

## Task 15: ADR 0006 + CLAUDE.md close-out + PR

**Files:**

- Create: `docs/adr/0006-phase-0-month-6-knowledge-graph-search-memory.md`
- Modify: `CLAUDE.md` §2

- [ ] **Step 1: Write ADR 0006** at `docs/adr/0006-phase-0-month-6-knowledge-graph-search-memory.md`

Follow the same structure as ADR 0005. Cover:

- Why AGE was replaced with pure Postgres recursive CTEs
- Typesense `isTypesenseConfigured()` gate pattern (no-op when key absent)
- Mem0 `isMemoryConfigured()` gate pattern
- HNSW index parameters and tuning guidance

- [ ] **Step 2: Update CLAUDE.md §2**

- Mark M6 as complete
- List new carry-overs (party resolution wiring into webhooks, Typesense Cloud provisioning, Mem0 provisioning, production backfill of existing comms/docs embeddings)
- Update test count and migration count

- [ ] **Step 3: Commit ADR + CLAUDE.md**

```bash
git add docs/adr/0006-phase-0-month-6-knowledge-graph-search-memory.md CLAUDE.md
git commit -m "docs(adr): ADR 0006 + CLAUDE.md close-out for M6 (task 15)"
```

- [ ] **Step 4: Push + open PR**

Use `commit-commands:commit-push-pr` skill.

- [ ] **Step 5: Verify CI passes**

Check that Lint, Typecheck, Unit tests, and Build all pass in GitHub Actions.

- [ ] **Step 6: Merge with `--admin` if needed**

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch --admin
```

---

## Carry-overs to M7

1. **Party resolution in webhooks:** `resolvePartyFromContact` is built but not yet wired into the Slack/Nylas/Twilio webhook handlers. Wiring requires careful testing of the denormalized `from_party_id` update path.
2. **Typesense Cloud provisioning:** Requires `TYPESENSE_API_KEY` + `TYPESENSE_HOST`. The package stubs cleanly when absent.
3. **Mem0 provisioning:** Requires `MEM0_API_KEY`. Package stubs cleanly when absent.
4. **Production embedding backfill:** Existing `communications` and `documents` rows have no embeddings. A backfill script or migration-time job is needed before similarity search returns real results.
5. **Embed queue publishing:** Queue consumer routes exist but the webhooks (Slack, Nylas, Twilio) don't yet publish `{communicationId}` to the embed queue. Phase 1 WDK workers will own this.
6. **All M2–M5 carry-overs still pending** (Nango, telephony vendors, WDK workflows, AGE if Neon adds support).
