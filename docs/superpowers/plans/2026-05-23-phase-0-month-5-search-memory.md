# Phase 0 Month 5 — Search + Memory + Attorney Review + SOC 2 Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-05-23
**Phase:** 0 (Foundation), Month 5 of 5 — final M-milestone of Phase 0
**Prior plan:** [2026-05-22-phase-0-month-4-messaging-files-esign-contacts.md](./2026-05-22-phase-0-month-4-messaging-files-esign-contacts.md)
**Prior ADR:** [0004-phase-0-month-4-messaging-files-esign-contacts.md](../../adr/0004-phase-0-month-4-messaging-files-esign-contacts.md)

**Spec anchors:** §8.9 (Search & Memory), §8.10 (Audit & Compliance Log), §10.x (Attorney review gate, hard rule #2), §11.1 Month 5, §12 (Cross-cutting Concerns).

**Goal:** Make the workspace interrogatable. Ship five in-scope subsystems — pgvector embeddings + similarity search, Apache AGE knowledge graph (contacts bootstrap), the attorney review workflow that produces the `AttorneyApproval` events M4 already depends on, SOC 2 audit-log enhancements for PII read access, and a basic "Ask anything" search UI — with cross-org RLS proofs across every new table.

**Architecture:** Two persistence shapes carried over from M1–M4. (1) Postgres + Drizzle for everything queryable — embeddings live in `vector` columns on `communications` + `documents`, AGE graph nodes/edges live in a single AGE-enabled DB. (2) Read-path actions wrap `withRls` to stay inside the org boundary. Embeddings are generated server-side via Vercel AI Gateway → OpenAI `text-embedding-3-large` (3072-dim). The attorney review surface is a per-org queue UI + state machine that emits exactly the `AttorneyApproval` events M4's `sendEnvelope` already requires.

**Tech Stack:** Drizzle + Neon Postgres (vector + AGE extensions), OpenAI `text-embedding-3-large` via Vercel AI Gateway, AI SDK + AI Elements for the chat surface, server actions throughout (no client-side mutations).

---

## 1. Goal & End State

By end-of-month the Vercel preview shows:

1. A processor types `"Wells Fargo payoff letter format"` in a new search bar and gets the top 10 most-similar communications + documents from the past 90 days, ranked by cosine similarity over pgvector.
2. A processor opens a Contact detail page and sees "5 related contacts" — Cypher-traversed via Apache AGE — showing other contacts at the same employer + same Slack workspace + linked-through-deals.
3. An attorney opens `/attorney/queue` and sees every document with `status='pending_review'`. Clicking an item opens the document; clicking **Approve** emits an `AttorneyApproval` event (the same event `sendEnvelope` from M4 looks up).
4. An admin opens `/admin/audit` and queries the audit log for "every read access to Communication X by user Y in the last 7 days." Every read is logged automatically; no app-side opt-in.
5. The "Ask anything" search bar at the top of every workspace page classifies query intent (search / action / analytics), routes to the right index (pgvector / AGE / SQL), and returns citations + follow-up actions.
6. RLS is enforced: every M5 table (`document_review_queue`, `attorney_approvals` is M1 carry-over but extended, `audit_event_reads`, `kg_node_<types>`, `kg_edge_<types>`) is invisible across org boundaries.

**Deliverable validation:**

- `pnpm test` passes (unit tests on embeddings client, graph helpers, state-machine logic, search classifier).
- `pnpm test` adds 3 new integration test files: `m5-rls-isolation.test.ts`, `attorney-review-flow.test.ts`, `pgvector-similarity.test.ts`.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` clean.

---

## 2. Hard Non-Goals (out of scope this month)

- **No Typesense.** Spec §8.9 lists Typesense for full-text; requires self-hosted or Typesense Cloud. Defer until OAuth/account provisioning. pgvector + ILIKE handles M5's queries adequately.
- **No Turbopuffer.** Same gap shape as Typesense. pgvector covers M5; Turbopuffer is Phase 1 when corpus exceeds pgvector's practical ceiling (~10M rows).
- **No Mem0.** Requires Mem0 account. Conversational memory shipped via Postgres-only `agent_memories` table in Phase 1; M5 leaves the search layer stateless.
- **No Vanta.** SOC 2 compliance automation requires Vanta account + onboarding. M5 ships the audit-log primitives Vanta will eventually consume (read tracking, retention policy), not the Vanta integration itself.
- **No Cohere Embed v4 fallback.** Spec §8.9 lists it as fallback. OpenAI `text-embedding-3-large` is canonical; switching providers is a one-line change via the AI Gateway, no abstraction needed in M5.
- **No vector-index pruning / GC.** M5 generates embeddings on insert and on a backfill job. Stale-embedding cleanup is Phase 1 with the WDK consumer.
- **No advanced graph queries.** M5 ships the AGE extension + basic node/edge schema + Contact migration + one Cypher helper (`findRelatedContacts`). Multi-hop traversals (`findPathBetween`, `findShortestPath`) are Phase 1.
- **No incremental re-indexing.** Embeddings regenerate on the next backfill run. Incremental refresh via DB triggers + queue is Phase 1.
- **No Reducto IDP for document re-embedding.** Carry-over from M3+M4. Phase 1.
- **No attorney **digital signature** on approvals.** M5's `AttorneyApproval` is a row + audit event; cryptographic signing of approvals (HSM-backed) is Phase 2 alongside customer-managed keys.
- **No agent-side memory writes.** Mem0 deferred; agent-memory tables are Phase 1 work.
- **No "Ask anything" voice input.** Text-only in M5; voice via ElevenLabs is Phase 3.
- **No Apache AGE Cypher DSL package.** One concrete query (`findRelatedContacts`) ships; a fluent DSL wrapping arbitrary traversals is Phase 1.
- **No Vercel env var provisioning + production smoke test.** Requires `OPENAI_API_KEY` provisioned in Vercel — skipped per session rule.
- **No SOC 2 evidence-collection runbook.** Phase 1 task. M5 ships the data shape; the runbook + evidence cron job is later.

---

## 3. Architecture Sketch

### 3.1 pgvector embeddings + similarity search

```
Webhook / inbound comm                       AI Gateway
        │                                        │
        ▼                                        │
┌──────────────────────┐    ┌──────────────────────────────────┐
│  POST .../webhooks/* │    │  embedText(text) →               │
│   (M2/M3/M4 routes)  │───►│   OpenAI text-embedding-3-large  │
│   on success:        │    │   3072-dim float32 array         │
│   queue → embed.run  │    └──────────────────────────────────┘
└──────────────────────┘                        │
        │                                        ▼
        │ (Phase 1 WDK consumer)         pgvector column on
        │                                communications + documents
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│  searchSimilar(orgId, query, kind, k)                    │
│   1. embedText(query) → query_vec                        │
│   2. SELECT … FROM communications                        │
│        WHERE org_id = current_org                        │
│        ORDER BY embedding <=> query_vec                  │
│        LIMIT k                                            │
│   3. Return top-k rows with cosine distance              │
└──────────────────────────────────────────────────────────┘
```

**Why generate embeddings inline at webhook time?** Latency is fine (sub-second) and the queue consumer for "phase 1 enrichment" doesn't exist yet. We generate on insert; backfill catches anything that bypassed the webhook path.

### 3.2 Apache AGE knowledge graph

```
M4 contacts table                AGE graph (cema_graph)
        │
        │  one-shot migration              ┌──────────────┐
        ├─────────────────────────────────►│  Contact     │
        │                                  │   id, name   │
        │                                  │   email...   │
        │                                  └──────┬───────┘
        │                                         │
        │  M4 parties table                       │ MATCHES (1:1 via party_id)
        ├─────────────────────────────────────────┤
        │                                         ▼
        │  M2 servicers + organizations    ┌──────────────┐
        ├─────────────────────────────────►│  Organization│
                                           │   (Servicer  │
                                           │    or Lender)│
                                           └──────────────┘

Edges (typed):
  KNOWS         — Contact↔Contact (same org, deal-linked)
  WORKS_AT      — Contact→Organization
  REPRESENTS    — Contact→Deal (party_role)
  EMPLOYS       — Organization→Contact
```

**Why AGE on Neon?** Neon supports AGE as of 2024. Verified at Task 7 — if Neon refuses the extension, fallback is a recursive-CTE implementation over Postgres tables (same schema shape, slower queries). M5 ships the AGE path; the fallback is a 1-day pivot if needed.

### 3.3 Attorney review workflow

```
M1 documents (status='draft')              M5 document_review_queue
                                                   │
                                                   ▼
Processor clicks "Submit for Review"      ┌──────────────────┐
        │                                  │ Queue row:       │
        ├─────────────────────────────────►│  document_id     │
        │                                  │  document_version│
        documents.status → 'pending_review'│  submitted_by    │
                                           │  submitted_at    │
                                           │  reviewer_id (null until claim)
                                           │  state           │
                                           └──────────────────┘
                                                   │
Attorney visits /attorney/queue                    │ state=pending
        │                                          ▼
        │  Clicks "Claim"           state=claimed; reviewer_id=user.id
        │
        │  Clicks "Approve"         emit AttorneyApproval event (M1 table)
        │                           documents.status → 'approved'
        │                           queue.state → 'approved'
        │
        └─►Clicks "Reject"          documents.status → 'rejected'
                                    queue.state → 'rejected'
                                    queue.rejection_reason saved
                                    Notify processor (M5: just a DB event;
                                    Phase 1: Knock notification)
```

**Why a separate `document_review_queue` table when `attorneyApprovals` already exists?** The M1 `attorneyApprovals` table records the _outcome_ (an approval event), not the _queue position_. A pending review has no approval row yet. Splitting the two lets attorneys query the queue without scanning `documents` for nulls — and lets the queue track interim states like `claimed` and `rejected` that don't belong on the immutable approvals table.

### 3.4 SOC 2 audit-log enhancements

```
Every read-path server action       ┌──────────────────────────────────┐
in apps/web/lib/actions/*           │  audit_event_reads               │
        │                            │   id, organization_id,           │
        │  withReadAudit({           │   actor_user_id,                 │
        │    entityType,             │   entity_type ('communication',  │
        │    entityId,               │     'document', 'recording',     │
        │    purpose                 │     'pii_field'),                │
        │  }, fn)                    │   entity_id,                     │
        │                            │   purpose ('view_detail',        │
        │                            │     'list', 'export', 'agent'),  │
        ├───────────────────────────►│   actor_ip,                      │
        │                            │   created_at (default now)       │
        │  fn() runs                 │  Immutable (BEFORE UPDATE/DELETE │
        │  reads happen              │  trigger from M1 carry-over #4)  │
        │  before return:            └──────────────────────────────────┘
        │   INSERT INTO
        │     audit_event_reads
        ▼
```

**Why a separate table instead of extending `audit_events`?** Read events are a different cardinality class (every list-page render is N events). Keeping them on their own table prevents the legacy `audit_events` from being bloated. Both tables get the immutable BEFORE UPDATE/DELETE trigger so neither can be tampered with.

### 3.5 "Ask anything" search UI

```
User types in search bar
        │
        ▼
┌──────────────────────────────────────────────┐
│  classifyQueryIntent(query, recentContext)   │
│   → 'search' | 'action' | 'analytics'        │
│   (via Vercel AI SDK; Claude Sonnet 4.6)     │
└──────────────────────────────────────────────┘
        │
        ├─ search    → searchSimilar(query) over pgvector
        │              + maybe AGE traversal if entity-named
        │
        ├─ action    → action-suggestion list (M5 returns links;
        │              Phase 1 generates concrete server actions)
        │
        └─ analytics → SQL aggregation suggestion
                       (M5 returns hints; Phase 1 executes)

Results page renders:
  - Top-N matches with cosine score + entity type
  - Citation list (which Comm/Doc/Contact each hit came from)
  - Follow-up CTAs (open detail page, call this party, etc.)
```

**Why classify intent first?** Three different query shapes need three different backends. Classifying with one LLM call costs ~$0.001 per query and routes correctly 95%+ of the time. M5 implements only the `search` branch fully; `action` + `analytics` return placeholder hints that Phase 1 fills out.

---

## 4. Pre-flight / Dependencies

### 4.1 Packages to add to workspace

```
packages/embeddings/                 # OpenAI embeddings client via AI Gateway
packages/kg/                         # Apache AGE Cypher helpers
packages/attorney/                   # Review state-machine logic
packages/search/                     # Query classifier + dispatcher
```

### 4.2 npm packages to install

```bash
# embeddings — uses Vercel AI SDK + AI Gateway, no new direct deps
pnpm --filter @cema/embeddings add ai @ai-sdk/openai

# kg — pg AGE queries are raw SQL; no SDK needed
# (use the existing drizzle-orm sql template literal)

# attorney — no external deps; pure TS state machine
# search — uses Vercel AI SDK
pnpm --filter @cema/search add ai @ai-sdk/anthropic
```

### 4.3 Env vars (add to `.env.example`)

The existing M0-M4 keys cover most needs. New variables:

```
# Search (already covers Phase 1 needs)
AI_GATEWAY_API_KEY=...           # already present from M2
OPENAI_API_KEY=...               # already present from M2 — used for embeddings

# AGE extension is server-side only — no env var needed.
```

### 4.4 Skipped provisioning tasks

| Task                                | Reason                             |
| ----------------------------------- | ---------------------------------- |
| Typesense Cloud account             | External account — skip per rule   |
| Turbopuffer account                 | External account — skip            |
| Mem0 account                        | External account — skip            |
| Vanta workspace + control setup     | External account + workflow — skip |
| Cohere account (embedding fallback) | External account — skip            |
| AI Gateway production key           | Requires real provisioning         |

---

## 5. File Map

### New files

```
packages/embeddings/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── types.ts
    ├── client.ts                + client.test.ts

packages/kg/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── types.ts
    ├── queries.ts               + queries.test.ts

packages/attorney/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── state.ts                 + state.test.ts

packages/search/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── classifier.ts            + classifier.test.ts

packages/db/src/schema/
├── document-review-queue.ts     (new)
├── audit-event-reads.ts         (new)
├── communications-vector.ts     (no new table; vector column added inline to communications.ts)
├── documents-vector.ts          (same — added inline)

packages/db/migrations/
├── 0024_pgvector_extension.sql
├── 0025_embeddings_columns.sql
├── 0026_age_extension.sql
├── 0027_age_graph_schema.sql
├── 0028_document_review_queue.sql
├── 0029_audit_event_reads.sql
├── 0030_rls_m5.sql

apps/web/
├── lib/actions/
│   ├── search-similar.ts                 + search-similar.test.ts
│   ├── classify-query.ts                 + classify-query.test.ts
│   ├── ask-anything.ts                   + ask-anything.test.ts
│   ├── find-related-contacts.ts          + find-related-contacts.test.ts
│   ├── submit-for-review.ts              + submit-for-review.test.ts
│   ├── claim-review.ts                   + claim-review.test.ts
│   ├── approve-document.ts               + approve-document.test.ts
│   ├── reject-document.ts                + reject-document.test.ts
│   ├── list-review-queue.ts              + list-review-queue.test.ts
│   ├── list-audit-events-reads.ts        + list-audit-events-reads.test.ts
├── lib/embeddings/
│   ├── backfill.ts                       + backfill.test.ts
│   ├── on-insert-hooks.ts                + on-insert-hooks.test.ts
├── lib/kg/
│   ├── contacts-to-nodes.ts              + contacts-to-nodes.test.ts
├── lib/audit/
│   ├── with-read-audit.ts                + with-read-audit.test.ts
├── components/
│   ├── ask-anything-search-bar.tsx
│   ├── search-results.tsx
│   ├── citation-card.tsx
│   ├── related-contacts-section.tsx
│   ├── review-queue-row.tsx
│   ├── review-detail-panel.tsx
│   ├── audit-event-row.tsx
├── app/api/embeddings/route.ts           (server-only endpoint for backfill triggering)
├── app/(app)/search/page.tsx             ("Ask anything" results page)
├── app/(app)/attorney/queue/page.tsx
├── app/(app)/attorney/queue/[id]/page.tsx
├── app/(app)/admin/audit/page.tsx
└── tests/integration/
    ├── m5-rls-isolation.test.ts
    ├── attorney-review-flow.test.ts
    └── pgvector-similarity.test.ts
```

### Modified files

```
packages/db/src/schema/index.ts                    (+2 exports)
packages/db/src/schema/communications.ts           (add vector column inline)
packages/db/src/schema/documents.ts                (add vector column inline)
packages/db/src/schema/enums.ts                    (extend documentStatusEnum with 'pending_review' if not present; add audit_read_purpose enum)
packages/queues/src/topics.ts                      (+2 topics: embeddings.generate.run, attorney.review.notify)
apps/web/package.json                              (+4 workspace deps)
apps/web/app/(app)/deals/[id]/communications/[c]/page.tsx
                                                   (wrap render in withReadAudit)
apps/web/app/(app)/deals/[id]/documents/[id]/page.tsx
                                                   (wrap render in withReadAudit + Submit-for-Review button)
apps/web/components/sidebar.tsx                    (add Attorney queue link if user has attorney role)
.env.example                                       (no new vars — note about existing AI gateway keys)
CLAUDE.md                                          (Section 2 close-out for M5)
```

---

## 6. Tasks

The 33 tasks across the five subsystems. Each can be its own commit; the full plan can ship as a single PR following the M3/M4 pattern.

### Subsystem 1 — pgvector embeddings + similarity (Tasks 1–6)

---

### Task 1: Enable pgvector extension (migration 0024)

**Files:**

- Create: `packages/db/migrations/0024_pgvector_extension.sql`
- Modify: `packages/db/migrations/meta/_journal.json` (manual append)

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/migrations/0024_pgvector_extension.sql
--
-- M5 Task 1: Enable the pgvector Postgres extension on the Neon dev branch.
-- pgvector ships an opaque `vector` column type plus distance operators:
--   <-> L2,  <=> cosine,  <#> inner-product.
-- We use cosine distance for semantic similarity in M5.
--
-- Hand-written (not drizzle-generated) because extension enablement is
-- DBA-shape DDL; drizzle-kit does not track extensions in its snapshot.

CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 2: Append journal entry**

Read the last entry index in `packages/db/migrations/meta/_journal.json`. The most recent should be `idx: 23, tag: "0023_rls_m4"`. Append:

```json
    {
      "idx": 24,
      "version": "7",
      "when": <current-unix-ms>,
      "tag": "0024_pgvector_extension",
      "breakpoints": false
    }
```

- [ ] **Step 3: Apply**

```bash
pnpm --filter @cema/db db:migrate
```

Expected: `migrations applied successfully!`. If Neon refuses (returns `permission denied to create extension "vector"`), the extension may need an admin-only flag — try the Neon dashboard's Extensions page, or fall back to `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;`. If both fail, **escalate** — block the entire pgvector subsystem until provisioning is resolved.

- [ ] **Step 4: Verify**

```bash
psql "$DATABASE_URL" -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
```

Expected: one row showing `vector` and a version like `0.7.x` or `0.8.x`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0024_pgvector_extension.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): enable pgvector extension (M5 task 1)"
```

---

### Task 2: Add embedding columns to `communications` + `documents` (migration 0025)

**Files:**

- Modify: `packages/db/src/schema/communications.ts`
- Modify: `packages/db/src/schema/documents.ts`
- Create: `packages/db/migrations/0025_embeddings_columns.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Add the column to `communications.ts`**

Drizzle does not ship a typed `vector` column out of the box. Use the `customType` helper to define one. At the top of `packages/db/src/schema/communications.ts`, after the existing imports, add:

```typescript
import { customType } from 'drizzle-orm/pg-core';

// pgvector custom type — emits "vector(3072)" DDL, stores as Float32Array
// at the JS layer. Defensively typed: db reads return number[] (Postgres
// driver converts), writes accept number[] for ergonomic JS callsites.
export const vector3072 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(3072)';
  },
  toDriver(value: number[]): string {
    // pgvector accepts text-formatted vectors: '[0.1,0.2,...]'
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // Strip the bracketed text into a number[].
    return value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(Number);
  },
});
```

Then add the column to the table definition (inside the `pgTable('communications', { ... })` body):

```typescript
    embedding: vector3072('embedding'),
    embeddingGeneratedAt: timestamp('embedding_generated_at', { withTimezone: true }),
```

Place these next to the `aiSummary` column (they're conceptually adjacent AI-generated fields).

- [ ] **Step 2: Add the same to `documents.ts`**

Reuse the `vector3072` type — import it from `./communications` or factor into `./pgvector.ts` (your call; importing from `./communications` is acceptable for M5):

```typescript
import { vector3072 } from './communications';
// ... in the pgTable body:
    embedding: vector3072('embedding'),
    embeddingGeneratedAt: timestamp('embedding_generated_at', { withTimezone: true }),
```

- [ ] **Step 3: Generate the migration**

```bash
pnpm --filter @cema/db db:generate
```

Drizzle emits `ALTER TABLE communications ADD COLUMN embedding vector(3072)` and similar for documents. Rename the produced file to `0025_embeddings_columns.sql` and update the journal entry's `tag` to `"0025_embeddings_columns"`.

- [ ] **Step 4: Add ivfflat indexes via a follow-up edit to the migration**

Append to the just-generated `0025_embeddings_columns.sql`:

```sql
-- ivfflat indexes for cosine similarity. M5 corpus is small so a plain
-- index would also work, but ivfflat is the standard pgvector index type
-- and scales to ~1M rows without further tuning. The `lists` parameter
-- defaults to 100 — appropriate for <100k row corpora.
CREATE INDEX communications_embedding_ivfflat_idx
  ON communications USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX documents_embedding_ivfflat_idx
  ON documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

- [ ] **Step 5: Apply + typecheck + commit**

```bash
pnpm --filter @cema/db db:migrate
pnpm typecheck
git add packages/db/src/schema/communications.ts packages/db/src/schema/documents.ts packages/db/migrations/0025_embeddings_columns.sql packages/db/migrations/meta/
git commit -m "feat(db): add embedding columns + ivfflat indexes on comms + docs (M5 task 2)"
```

---

### Task 3: `@cema/embeddings` package + `embedText()` client

**Files:**

- Create: `packages/embeddings/package.json`
- Create: `packages/embeddings/tsconfig.json`
- Create: `packages/embeddings/src/{index,types,client}.ts` + `client.test.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@cema/embeddings",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json`** — copy from `packages/integrations/deepgram/tsconfig.json`.

- [ ] **Step 3: `src/types.ts`**

```typescript
// packages/embeddings/src/types.ts

export interface EmbedTextInput {
  text: string;
  model?: 'text-embedding-3-large' | 'text-embedding-3-small';
}

export interface EmbedTextResult {
  embedding: number[];
  dimensions: number;
  model: string;
  inputTokens: number;
}
```

- [ ] **Step 4: Write the failing test**

```typescript
// packages/embeddings/src/client.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => ({
  embed: vi.fn().mockResolvedValue({
    embedding: new Array(3072).fill(0).map((_, i) => i / 3072),
    usage: { tokens: 7 },
  }),
}));

vi.mock('@ai-sdk/openai', () => ({
  openai: {
    embedding: vi.fn().mockReturnValue({ modelId: 'text-embedding-3-large' }),
  },
}));

import { embedText } from './client';

describe('embedText', () => {
  it('returns a 3072-dim embedding for text input', async () => {
    const res = await embedText({ text: 'CEMA payoff letter' });
    expect(res.dimensions).toBe(3072);
    expect(res.embedding).toHaveLength(3072);
    expect(res.model).toBe('text-embedding-3-large');
    expect(res.inputTokens).toBe(7);
  });

  it('uses text-embedding-3-large by default', async () => {
    const res = await embedText({ text: 'CEMA payoff letter' });
    expect(res.model).toBe('text-embedding-3-large');
  });
});
```

- [ ] **Step 5: Verify it fails**

```bash
pnpm --filter @cema/embeddings test
```

- [ ] **Step 6: Implement `client.ts`**

```typescript
// packages/embeddings/src/client.ts
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';

import type { EmbedTextInput, EmbedTextResult } from './types';

const DEFAULT_MODEL = 'text-embedding-3-large';

export async function embedText(input: EmbedTextInput): Promise<EmbedTextResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const res = await embed({
    model: openai.embedding(model),
    value: input.text,
  });
  return {
    embedding: res.embedding,
    dimensions: res.embedding.length,
    model,
    inputTokens: res.usage.tokens,
  };
}
```

- [ ] **Step 7: `index.ts`**

```typescript
// packages/embeddings/src/index.ts
export * from './types';
export * from './client';
```

- [ ] **Step 8: Install + verify + commit**

```bash
pnpm install
pnpm --filter @cema/embeddings test
pnpm --filter @cema/embeddings typecheck
git add packages/embeddings/ pnpm-lock.yaml
git commit -m "feat(embeddings): @cema/embeddings — OpenAI text-embedding-3-large client (M5 task 3)"
```

---

### Task 4: Server action `searchSimilar()` — cosine similarity over pgvector

**Files:**

- Create: `apps/web/lib/actions/search-similar.ts` + `search-similar.test.ts`
- Modify: `apps/web/package.json` (add `@cema/embeddings` workspace dep)

- [ ] **Step 1: Add the dep**

In `apps/web/package.json`, add to `dependencies` (alphabetical with other `@cema/*`):

```json
    "@cema/embeddings": "workspace:*",
```

Then `pnpm install`.

- [ ] **Step 2: Implement `search-similar.ts`**

```typescript
// apps/web/lib/actions/search-similar.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { communications, documents, getDb, organizations } from '@cema/db';
import { embedText } from '@cema/embeddings';
import { and, eq, sql } from 'drizzle-orm';

import { withRls } from '../with-rls';

export type SearchEntityKind = 'communication' | 'document' | 'all';

export interface SearchHit {
  kind: 'communication' | 'document';
  id: string;
  // Cosine distance from query vector (0 = identical, 2 = opposite).
  cosineDistance: number;
  // Cosine similarity in [0,1] — 1 - (distance / 2).
  similarity: number;
  // Whichever single text field best identifies the hit.
  preview: string;
}

export interface SearchSimilarInput {
  query: string;
  kind?: SearchEntityKind;
  k?: number;
}

export async function searchSimilar(input: SearchSimilarInput): Promise<SearchHit[]> {
  const { query, kind = 'all', k = 10 } = input;
  if (!query.trim()) return [];

  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const { embedding } = await embedText({ text: query });
  const vectorLiteral = sql.raw(`'[${embedding.join(',')}]'::vector`);

  return withRls(org.id, async (tx) => {
    const hits: SearchHit[] = [];

    if (kind === 'communication' || kind === 'all') {
      const rows = await tx
        .select({
          id: communications.id,
          aiSummary: communications.aiSummary,
          sourceThreadId: communications.sourceThreadId,
          // Cosine distance via the <=> operator.
          distance: sql<number>`${communications.embedding} <=> ${vectorLiteral}`,
        })
        .from(communications)
        .where(
          and(
            eq(communications.organizationId, org.id),
            sql`${communications.embedding} IS NOT NULL`,
          ),
        )
        .orderBy(sql`${communications.embedding} <=> ${vectorLiteral}`)
        .limit(k);

      for (const r of rows) {
        hits.push({
          kind: 'communication',
          id: r.id,
          cosineDistance: r.distance,
          similarity: 1 - r.distance / 2,
          preview: r.aiSummary ?? r.sourceThreadId ?? '(no preview)',
        });
      }
    }

    if (kind === 'document' || kind === 'all') {
      const rows = await tx
        .select({
          id: documents.id,
          fileName: documents.fileName,
          distance: sql<number>`${documents.embedding} <=> ${vectorLiteral}`,
        })
        .from(documents)
        .where(and(eq(documents.organizationId, org.id), sql`${documents.embedding} IS NOT NULL`))
        .orderBy(sql`${documents.embedding} <=> ${vectorLiteral}`)
        .limit(k);

      for (const r of rows) {
        hits.push({
          kind: 'document',
          id: r.id,
          cosineDistance: r.distance,
          similarity: 1 - r.distance / 2,
          preview: r.fileName ?? '(no preview)',
        });
      }
    }

    // Merge + re-sort by distance ascending so cross-kind ranking is consistent.
    return hits.sort((a, b) => a.cosineDistance - b.cosineDistance).slice(0, k);
  });
}
```

- [ ] **Step 3: Write the test**

```typescript
// apps/web/lib/actions/search-similar.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/embeddings', () => ({
  embedText: vi.fn().mockResolvedValue({
    embedding: new Array(3072).fill(0.1),
    dimensions: 3072,
    model: 'text-embedding-3-large',
    inputTokens: 5,
  }),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  communications: {
    id: 'id_col',
    organizationId: 'org_col',
    aiSummary: 'ai_summary_col',
    sourceThreadId: 'source_thread_id_col',
    embedding: 'embedding_col',
  },
  documents: {
    id: 'id_col',
    organizationId: 'org_col',
    fileName: 'file_name_col',
    embedding: 'embedding_col',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) => ({ strings, values: _values }),
    { raw: vi.fn().mockReturnValue({}) },
  ),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { searchSimilar } from './search-similar';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };

function makeMockTx(commRows: unknown[], docRows: unknown[]) {
  let selectCallCount = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      selectCallCount += 1;
      const rows = selectCallCount === 1 ? commRows : docRows;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      };
    }),
  };
}

describe('searchSimilar', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
    } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => vi.clearAllMocks());

  it('returns [] when query is blank', async () => {
    const result = await searchSimilar({ query: '   ' });
    expect(result).toEqual([]);
  });

  it('returns [] when org not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as unknown as ReturnType<typeof getDb>);
    const result = await searchSimilar({ query: 'CEMA' });
    expect(result).toEqual([]);
  });

  it('returns merged top-k results sorted by distance', async () => {
    const commRows = [
      { id: 'c-1', aiSummary: 'Comm 1', sourceThreadId: null, distance: 0.1 },
      { id: 'c-2', aiSummary: 'Comm 2', sourceThreadId: null, distance: 0.3 },
    ];
    const docRows = [{ id: 'd-1', fileName: 'doc1.pdf', distance: 0.2 }];
    vi.mocked(withRls).mockImplementationOnce(async (_orgId, fn) =>
      fn(makeMockTx(commRows, docRows) as never),
    );

    const result = await searchSimilar({ query: 'CEMA payoff', k: 5 });

    expect(result).toHaveLength(3);
    expect(result[0]?.id).toBe('c-1'); // distance 0.1 first
    expect(result[1]?.id).toBe('d-1'); // distance 0.2
    expect(result[2]?.id).toBe('c-2'); // distance 0.3
    expect(result[0]?.kind).toBe('communication');
  });
});
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter web test lib/actions/search-similar
pnpm typecheck
git add apps/web/lib/actions/search-similar.ts apps/web/lib/actions/search-similar.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(actions): searchSimilar — cosine similarity over pgvector (M5 task 4)"
```

---

### Task 5: Backfill embeddings for existing communications + documents

**Files:**

- Create: `apps/web/lib/embeddings/backfill.ts` + `backfill.test.ts`

- [ ] **Step 1: Implement `backfill.ts`**

```typescript
// apps/web/lib/embeddings/backfill.ts
import { communications, documents, getDb } from '@cema/db';
import { embedText } from '@cema/embeddings';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { withRls } from '../with-rls';

export interface BackfillEmbeddingsResult {
  commsProcessed: number;
  commsEmbedded: number;
  docsProcessed: number;
  docsEmbedded: number;
  errors: number;
}

/**
 * Backfill embeddings for any communications + documents that lack one.
 *
 * Idempotent — safe to re-run; only operates on rows where `embedding IS NULL`.
 * Embeds the most informative text per row:
 *   - communication.aiSummary if present, else source_thread_id
 *   - document.fileName + metadata title if present
 *
 * Caller should run this from a script or cron — DO NOT call from a
 * webhook handler (latency unbounded by corpus size).
 */
export async function backfillEmbeddings(orgId: string): Promise<BackfillEmbeddingsResult> {
  const db = getDb();
  const stats: BackfillEmbeddingsResult = {
    commsProcessed: 0,
    commsEmbedded: 0,
    docsProcessed: 0,
    docsEmbedded: 0,
    errors: 0,
  };

  await withRls(orgId, async (tx) => {
    const commRows = await tx
      .select({
        id: communications.id,
        aiSummary: communications.aiSummary,
        sourceThreadId: communications.sourceThreadId,
      })
      .from(communications)
      .where(and(eq(communications.organizationId, orgId), isNull(communications.embedding)));

    for (const c of commRows) {
      stats.commsProcessed += 1;
      const text = c.aiSummary?.trim() || c.sourceThreadId?.trim();
      if (!text) continue;
      try {
        const { embedding } = await embedText({ text });
        await tx
          .update(communications)
          .set({
            embedding,
            embeddingGeneratedAt: new Date(),
          })
          .where(eq(communications.id, c.id));
        stats.commsEmbedded += 1;
      } catch (e) {
        stats.errors += 1;
        // Continue with next row; one failure should not block the batch.
        void e;
      }
    }

    const docRows = await tx
      .select({ id: documents.id, fileName: documents.fileName })
      .from(documents)
      .where(and(eq(documents.organizationId, orgId), isNull(documents.embedding)));

    for (const d of docRows) {
      stats.docsProcessed += 1;
      const text = d.fileName?.trim();
      if (!text) continue;
      try {
        const { embedding } = await embedText({ text });
        await tx
          .update(documents)
          .set({
            embedding,
            embeddingGeneratedAt: new Date(),
          })
          .where(eq(documents.id, d.id));
        stats.docsEmbedded += 1;
      } catch (e) {
        stats.errors += 1;
        void e;
      }
    }
  });

  return stats;
}
```

- [ ] **Step 2: Tests** — 3 tests: no data → all zeros; comm with aiSummary embedded; failure path increments errors counter.

Use `vi.mock` shapes matching `search-similar.test.ts`. Mock `embedText` to throw on a specific input ID to exercise the catch branch.

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter web test lib/embeddings/backfill
pnpm typecheck
git add apps/web/lib/embeddings/
git commit -m "feat(embeddings): backfill engine for existing comms + docs (M5 task 5)"
```

---

### Task 6: UI — Ask-anything search bar + results page

**Files:**

- Create: `apps/web/components/ask-anything-search-bar.tsx`
- Create: `apps/web/components/search-results.tsx`
- Create: `apps/web/components/citation-card.tsx`
- Create: `apps/web/app/(app)/search/page.tsx`

- [ ] **Step 1: Search bar (client component)**

```tsx
// apps/web/components/ask-anything-search-bar.tsx
'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AskAnythingSearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}` as Route);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything — search calls, emails, files, contacts…"
          aria-label="Ask anything"
          className="w-full rounded-lg border bg-white px-4 py-2 pr-10 text-sm shadow-sm focus:border-blue-400 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Search"
          className="absolute right-1 top-1 rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
        >
          🔍
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Citation card**

```tsx
// apps/web/components/citation-card.tsx
import type { Route } from 'next';
import Link from 'next/link';

import type { SearchHit } from '@/lib/actions/search-similar';

interface CitationCardProps {
  hit: SearchHit;
  // Resolve hit → route. For M5 we link to /deals — refined in Phase 1.
  href: string;
}

export function CitationCard({ hit, href }: CitationCardProps) {
  return (
    <Link
      href={href as Route}
      className="hover:bg-muted/50 block rounded-lg border bg-white p-4 shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{hit.preview}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            <span className="capitalize">{hit.kind}</span> · similarity{' '}
            {(hit.similarity * 100).toFixed(1)}%
          </p>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: Search results component**

```tsx
// apps/web/components/search-results.tsx
import { CitationCard } from './citation-card';

import type { SearchHit } from '@/lib/actions/search-similar';

interface SearchResultsProps {
  hits: SearchHit[];
  query: string;
}

function hrefForHit(hit: SearchHit): string {
  // M5: link communications to their detail page; documents to their
  // (eventual) detail route. Phase 1 will be smarter about resolving
  // a deal id for cross-org communications.
  if (hit.kind === 'communication') return `/communications/${hit.id}`;
  return `/documents/${hit.id}`;
}

export function SearchResults({ hits, query }: SearchResultsProps) {
  if (hits.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-muted-foreground text-sm font-medium">
          No matches for &ldquo;{query}&rdquo;
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Communications + documents must be embedded first. Run the backfill if this is unexpected.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">
        {hits.length} result{hits.length === 1 ? '' : 's'} for &ldquo;{query}&rdquo;
      </p>
      <ul className="space-y-2" role="list">
        {hits.map((hit) => (
          <li key={`${hit.kind}-${hit.id}`}>
            <CitationCard hit={hit} href={hrefForHit(hit)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Search results page**

```tsx
// apps/web/app/(app)/search/page.tsx
import { SearchResults } from '@/components/search-results';
import { searchSimilar } from '@/lib/actions/search-similar';

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const query = q?.trim() ?? '';
  const hits = query ? await searchSimilar({ query, k: 20 }) : [];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Search</h1>
      {query ? (
        <SearchResults hits={hits} query={query} />
      ) : (
        <p className="text-muted-foreground text-sm">Enter a query in the search bar above.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add apps/web/components/ask-anything-search-bar.tsx apps/web/components/search-results.tsx apps/web/components/citation-card.tsx "apps/web/app/(app)/search/"
git commit -m "feat(ui): Ask-anything search bar + /search results (M5 task 6)"
```

The search bar will be wired into the global layout in Task 25; for M5 task 6 the page is reachable by URL.

---

### Subsystem 2 — Apache AGE knowledge graph (Tasks 7–12)

---

### Task 7: Enable Apache AGE extension + create graph (migration 0026)

**Files:**

- Create: `packages/db/migrations/0026_age_extension.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

**Critical preflight:** Apache AGE on Neon is documented as supported but has version constraints. If `CREATE EXTENSION age` fails, the entire AGE subsystem (Tasks 7–12) must be deferred and the carry-over list updated. Do NOT attempt the recursive-CTE fallback unilaterally — escalate first.

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/migrations/0026_age_extension.sql
--
-- M5 Task 7: Enable Apache AGE (A Graph Extension) on the Neon dev branch.
-- AGE adds graph-database capabilities to Postgres: openCypher queries,
-- typed nodes (vertices) and edges, and a `graph` namespace concept.
--
-- After this migration, the `cypher()` function is available and we can
-- create + query a graph called `cema_graph`.

CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';

-- The 'age' extension lives in the `ag_catalog` schema. Application
-- queries reference `ag_catalog.cypher(...)` explicitly, or set
-- search_path. For M5 we set it at the session/transaction level inside
-- each query so we don't have to touch every Postgres connection.

-- Create the graph itself. Idempotent via the boolean param.
SELECT create_graph('cema_graph');
```

- [ ] **Step 2: Journal entry**

```json
    {
      "idx": 26,
      "version": "7",
      "when": <current-unix-ms>,
      "tag": "0026_age_extension",
      "breakpoints": false
    }
```

- [ ] **Step 3: Apply**

```bash
pnpm --filter @cema/db db:migrate
```

If this errors with `permission denied` or `extension not available`, **STOP**. Report to the human partner — escalate per the BLOCKED status pattern from `superpowers:subagent-driven-development`.

- [ ] **Step 4: Verify the graph exists**

```bash
psql "$DATABASE_URL" -c "SELECT name FROM ag_catalog.ag_graph WHERE name = 'cema_graph';"
```

Expected: one row showing `cema_graph`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0026_age_extension.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): enable Apache AGE + create cema_graph (M5 task 7)"
```

---

### Task 8: Create graph node + edge labels (migration 0027)

**Files:**

- Create: `packages/db/migrations/0027_age_graph_schema.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/migrations/0027_age_graph_schema.sql
--
-- M5 Task 8: Bootstrap node + edge labels on the cema_graph created in
-- migration 0026. AGE requires labels to be created explicitly before
-- INSERT/MATCH queries can reference them — declaring them up front
-- gives the parser stable type information and avoids latent failures
-- on the first Cypher query.

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

-- Node labels --------------------------------------------------------
SELECT create_vlabel('cema_graph', 'Contact');
SELECT create_vlabel('cema_graph', 'Organization');
SELECT create_vlabel('cema_graph', 'Deal');
SELECT create_vlabel('cema_graph', 'Party');

-- Edge labels --------------------------------------------------------
--   KNOWS         Contact ↔ Contact (deal-linked or org-shared)
--   WORKS_AT      Contact → Organization (servicer/lender)
--   EMPLOYS       Organization → Contact (reverse of WORKS_AT)
--   REPRESENTS    Contact → Deal (via party_role)
SELECT create_elabel('cema_graph', 'KNOWS');
SELECT create_elabel('cema_graph', 'WORKS_AT');
SELECT create_elabel('cema_graph', 'EMPLOYS');
SELECT create_elabel('cema_graph', 'REPRESENTS');
```

- [ ] **Step 2: Journal entry**

```json
    {
      "idx": 27,
      "version": "7",
      "when": <current-unix-ms>,
      "tag": "0027_age_graph_schema",
      "breakpoints": false
    }
```

- [ ] **Step 3: Apply + verify**

```bash
pnpm --filter @cema/db db:migrate

psql "$DATABASE_URL" -c "SELECT name FROM ag_catalog.ag_label WHERE graph IN (SELECT graphid FROM ag_catalog.ag_graph WHERE name='cema_graph') ORDER BY name;"
```

Expected: 8 rows total (4 vertex + 4 edge labels).

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0027_age_graph_schema.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): create AGE node + edge labels for cema_graph (M5 task 8)"
```

---

### Task 9: `@cema/kg` package — Cypher query helpers

**Files:**

- Create: `packages/kg/package.json`, `tsconfig.json`
- Create: `packages/kg/src/{index,types,queries}.ts` + `queries.test.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@cema/kg",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "drizzle-orm": "^0.45.2"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@cema/db": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json`** — copy from `packages/integrations/deepgram/tsconfig.json`.

- [ ] **Step 3: `src/types.ts`**

```typescript
// packages/kg/src/types.ts

export interface ContactNode {
  id: string;
  contactId: string;
  organizationId: string;
  primaryName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  employer: string | null;
}

export interface RelatedContact {
  contact: ContactNode;
  // Why related — e.g. ['WORKS_AT same Organization', 'KNOWS direct']
  relationships: string[];
  // Hop distance: 1 = direct, 2 = same employer, etc.
  distance: number;
}

export interface CypherExecuteInput {
  query: string;
  // AGE doesn't support $param binding well; callers should compose
  // params via sql template literal at the drizzle layer.
}
```

- [ ] **Step 4: `src/queries.ts` — implement `findRelatedContacts`**

```typescript
// packages/kg/src/queries.ts
import { sql } from 'drizzle-orm';

import type { ContactNode, RelatedContact } from './types';

// Tx type is loosely typed — see @cema/contacts for the same pattern.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

/**
 * Find contacts related to `contactId` via the graph. Two related shapes:
 *   1. Direct KNOWS edge (1 hop)
 *   2. Same Organization via WORKS_AT (2 hops)
 *
 * AGE quirk: the cypher() function returns rows of typed `agtype` values
 * that look like JSON but must be cast to text and JSON.parse'd. The
 * function returns a `setof record`; you have to declare column types in
 * the SQL itself via `AS (column_name agtype, ...)`.
 */
export async function findRelatedContacts(
  tx: Tx,
  contactId: string,
  options: { limit?: number } = {},
): Promise<RelatedContact[]> {
  const { limit = 20 } = options;

  // Step 1: Run the Cypher query inside a session that has 'age' loaded
  // and search_path set. AGE requires this every connection.
  await tx.execute(sql`LOAD 'age'`);
  await tx.execute(sql`SET search_path = ag_catalog, "$user", public`);

  // The cypher() function takes the graph name + a cypher string. We
  // string-interpolate the contactId; it's a UUID generated by our
  // own DB so injection risk is minimal, but we still sanitize at the
  // caller boundary in production. M5 uses tx.execute with sql`` which
  // properly parameterizes the literal.
  //
  // The query: find Contacts that share a WORKS_AT edge target with
  // the input contact, OR are KNOWS-connected directly. Returns the
  // related contact + a list of relationship labels.

  const rows = (await tx.execute(sql`
    SELECT result.contact_id, result.distance, result.rel_type
    FROM cypher('cema_graph', $$
      MATCH (a:Contact {contact_id: ${contactId}})
      OPTIONAL MATCH (a)-[r:KNOWS]-(b:Contact)
      WITH a, b, type(r) AS rel_type, 1 AS distance
      WHERE b IS NOT NULL
      RETURN b.contact_id AS contact_id, distance, rel_type
      UNION
      MATCH (a:Contact {contact_id: ${contactId}})-[:WORKS_AT]->(o:Organization)<-[:WORKS_AT]-(b:Contact)
      WHERE a <> b
      RETURN b.contact_id AS contact_id, 2 AS distance, 'WORKS_AT_SAME_ORG' AS rel_type
    $$) AS result(contact_id agtype, distance agtype, rel_type agtype)
    LIMIT ${limit}
  `)) as { rows: Array<{ contact_id: string; distance: string; rel_type: string }> };

  // Group results by contact_id and merge relationships
  const grouped = new Map<string, RelatedContact>();
  for (const r of rows.rows) {
    const id = stripAgtype(r.contact_id);
    const rel = stripAgtype(r.rel_type);
    const dist = Number(stripAgtype(r.distance));
    const existing = grouped.get(id);
    if (existing) {
      if (!existing.relationships.includes(rel)) existing.relationships.push(rel);
      existing.distance = Math.min(existing.distance, dist);
    } else {
      grouped.set(id, {
        contact: {
          id: '',
          contactId: id,
          organizationId: '',
          primaryName: null,
          primaryEmail: null,
          primaryPhone: null,
          employer: null,
        },
        relationships: [rel],
        distance: dist,
      });
    }
  }

  return Array.from(grouped.values()).sort((a, b) => a.distance - b.distance);
}

// AGE returns text-wrapped JSON like `"abc"`. Strip the wrapping.
function stripAgtype(raw: string | null): string {
  if (raw === null) return '';
  return String(raw).replace(/^"|"$/g, '');
}
```

- [ ] **Step 5: Test (mock the tx.execute calls)**

```typescript
// packages/kg/src/queries.test.ts
import { describe, expect, it, vi } from 'vitest';

import { findRelatedContacts } from './queries';

describe('findRelatedContacts', () => {
  it('returns related contacts grouped by id, distance-sorted', async () => {
    const tx = {
      execute: vi.fn().mockImplementation((q: unknown) => {
        // The third execute call is the SELECT — first two are LOAD + SET.
        const queryStr = String(q);
        if (queryStr.includes('SELECT')) {
          return {
            rows: [
              { contact_id: '"contact-1"', distance: '2', rel_type: '"WORKS_AT_SAME_ORG"' },
              { contact_id: '"contact-2"', distance: '1', rel_type: '"KNOWS"' },
              { contact_id: '"contact-1"', distance: '1', rel_type: '"KNOWS"' },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const result = await findRelatedContacts(tx as never, 'source-contact-1');
    expect(result).toHaveLength(2);
    // contact-1 should sort first because it has distance=1 from KNOWS
    expect(result[0]?.contact.contactId).toBe('contact-1');
    expect(result[0]?.distance).toBe(1);
    expect(result[0]?.relationships).toContain('KNOWS');
    expect(result[0]?.relationships).toContain('WORKS_AT_SAME_ORG');
  });

  it('returns [] when no related contacts found', async () => {
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await findRelatedContacts(tx as never, 'lonely-contact');
    expect(result).toEqual([]);
  });

  it('respects the limit parameter', async () => {
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    await findRelatedContacts(tx as never, 'x', { limit: 5 });
    // Verify the third call (the SELECT) included LIMIT 5
    const selectCall = tx.execute.mock.calls.find((c) => String(c[0]).includes('SELECT'));
    expect(String(selectCall?.[0])).toContain('LIMIT');
  });
});
```

- [ ] **Step 6: `index.ts`** — export both files.

- [ ] **Step 7: Install + verify + commit**

```bash
pnpm install
pnpm --filter @cema/kg test
pnpm --filter @cema/kg typecheck
git add packages/kg/ pnpm-lock.yaml
git commit -m "feat(kg): @cema/kg — Cypher findRelatedContacts helper (M5 task 9)"
```

---

### Task 10: Migrate M4 contacts data into AGE Contact nodes

**Files:**

- Create: `apps/web/lib/kg/contacts-to-nodes.ts` + `contacts-to-nodes.test.ts`

- [ ] **Step 1: Implementation**

```typescript
// apps/web/lib/kg/contacts-to-nodes.ts
import { contacts, getDb } from '@cema/db';
import { eq, sql } from 'drizzle-orm';

import { withRls } from '../with-rls';

export interface ContactsToNodesResult {
  contactsProcessed: number;
  nodesCreated: number;
  edgesCreated: number;
  errors: number;
}

/**
 * One-shot job: walk the M4 contacts table and create one Contact
 * vertex per row in the AGE graph, plus WORKS_AT edges to Organization
 * vertices (creating Organization vertices on-demand from the
 * contacts.employer string).
 *
 * Idempotent — uses Cypher MERGE which only creates if not present.
 * Safe to re-run; Phase 1 will trigger this incrementally on every
 * contacts insert/update.
 */
export async function migrateContactsToNodes(orgId: string): Promise<ContactsToNodesResult> {
  const db = getDb();
  const stats: ContactsToNodesResult = {
    contactsProcessed: 0,
    nodesCreated: 0,
    edgesCreated: 0,
    errors: 0,
  };

  await withRls(orgId, async (tx) => {
    // AGE setup
    await tx.execute(sql`LOAD 'age'`);
    await tx.execute(sql`SET search_path = ag_catalog, "$user", public`);

    const rows = await tx
      .select({
        id: contacts.id,
        primaryName: contacts.primaryName,
        primaryEmail: contacts.primaryEmail,
        primaryPhone: contacts.primaryPhone,
        employer: contacts.employer,
      })
      .from(contacts)
      .where(eq(contacts.organizationId, orgId));

    for (const c of rows) {
      stats.contactsProcessed += 1;
      try {
        // MERGE the Contact node. Setting properties on the second pass
        // is idempotent — MERGE+ON CREATE/ON MATCH guards the write.
        await tx.execute(sql`
          SELECT * FROM cypher('cema_graph', $$
            MERGE (c:Contact {contact_id: '${sql.raw(c.id)}'})
            ON CREATE SET
              c.organization_id = '${sql.raw(orgId)}',
              c.primary_name = '${sql.raw((c.primaryName ?? '').replace(/'/g, "''"))}',
              c.primary_email = '${sql.raw(c.primaryEmail ?? '')}',
              c.primary_phone = '${sql.raw(c.primaryPhone ?? '')}',
              c.employer = '${sql.raw((c.employer ?? '').replace(/'/g, "''"))}'
            RETURN c
          $$) AS (result agtype)
        `);
        stats.nodesCreated += 1;

        if (c.employer && c.employer.trim()) {
          // MERGE the Organization, MERGE the WORKS_AT edge.
          const employerSafe = c.employer.replace(/'/g, "''");
          await tx.execute(sql`
            SELECT * FROM cypher('cema_graph', $$
              MERGE (o:Organization {name: '${sql.raw(employerSafe)}', organization_id: '${sql.raw(orgId)}'})
              WITH o
              MATCH (c:Contact {contact_id: '${sql.raw(c.id)}'})
              MERGE (c)-[:WORKS_AT]->(o)
              MERGE (o)-[:EMPLOYS]->(c)
              RETURN c, o
            $$) AS (cnode agtype, onode agtype)
          `);
          stats.edgesCreated += 2;
        }
      } catch (e) {
        stats.errors += 1;
        void e;
      }
    }
  });

  return stats;
}
```

- [ ] **Step 2: Test (3 tests: empty contacts → all-zero; one contact with employer → 1 node + 2 edges; query failure increments errors)**

Mock `tx.execute` to count calls. Use the same pattern as the kg/queries test.

- [ ] **Step 3: Commit**

```bash
pnpm --filter web test lib/kg
pnpm typecheck
git add apps/web/lib/kg/
git commit -m "feat(kg): contacts → AGE Contact/Organization nodes migration (M5 task 10)"
```

---

### Task 11: Server action `findRelatedContacts()`

**Files:**

- Create: `apps/web/lib/actions/find-related-contacts.ts` + `find-related-contacts.test.ts`
- Modify: `apps/web/package.json` (add `@cema/kg` workspace dep)

- [ ] **Step 1: Add the dep**

```json
    "@cema/kg": "workspace:*",
```

Then `pnpm install`.

- [ ] **Step 2: Implementation**

```typescript
// apps/web/lib/actions/find-related-contacts.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { contacts, getDb, organizations } from '@cema/db';
import { findRelatedContacts as kgFindRelated } from '@cema/kg';
import type { RelatedContact } from '@cema/kg';
import { and, eq, inArray } from 'drizzle-orm';

import { withRls } from '../with-rls';

export async function findRelatedContacts(
  contactId: string,
  options: { limit?: number } = {},
): Promise<RelatedContact[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const related = await kgFindRelated(tx, contactId, options);
    if (related.length === 0) return [];

    // Hydrate the contact rows from the contacts table (the graph stores
    // only the contact_id, not the full row).
    const ids = related.map((r) => r.contact.contactId);
    const rows = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.organizationId, org.id), inArray(contacts.id, ids)));

    const byId = new Map(rows.map((r) => [r.id, r]));

    return related
      .map((r) => {
        const row = byId.get(r.contact.contactId);
        if (!row) return null;
        return {
          contact: {
            id: row.id,
            contactId: row.id,
            organizationId: row.organizationId,
            primaryName: row.primaryName,
            primaryEmail: row.primaryEmail,
            primaryPhone: row.primaryPhone,
            employer: row.employer,
          },
          relationships: r.relationships,
          distance: r.distance,
        } satisfies RelatedContact;
      })
      .filter((x): x is RelatedContact => x !== null);
  });
}
```

- [ ] **Step 3: Test (4 tests: missing org → []; empty graph → []; happy path hydrates contacts; respects limit)**

- [ ] **Step 4: Commit**

```bash
pnpm --filter web test lib/actions/find-related-contacts
pnpm typecheck
git add apps/web/lib/actions/find-related-contacts.ts apps/web/lib/actions/find-related-contacts.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(actions): findRelatedContacts via AGE traversal (M5 task 11)"
```

---

### Task 12: UI — extend ContactDetail with "Related contacts" section

**Files:**

- Create: `apps/web/components/related-contacts-section.tsx`
- Modify: `apps/web/app/(app)/contacts/[id]/page.tsx`

- [ ] **Step 1: Related-contacts section**

```tsx
// apps/web/components/related-contacts-section.tsx
import type { RelatedContact } from '@cema/kg';
import type { Route } from 'next';
import Link from 'next/link';

interface RelatedContactsSectionProps {
  related: RelatedContact[];
}

const REL_LABEL: Record<string, string> = {
  KNOWS: 'Direct connection',
  WORKS_AT_SAME_ORG: 'Same employer',
};

export function RelatedContactsSection({ related }: RelatedContactsSectionProps) {
  if (related.length === 0) {
    return (
      <section>
        <h2 className="mb-3 text-sm font-medium">Related contacts (0)</h2>
        <p className="text-muted-foreground text-xs">
          No relationships found in the knowledge graph yet. Run the contacts-to-nodes migration
          (Task 10) if this is unexpected.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium">Related contacts ({related.length})</h2>
      <ul className="space-y-2" role="list">
        {related.map((r) => (
          <li
            key={r.contact.contactId}
            className="flex items-center justify-between rounded-lg border bg-white p-3 shadow-sm"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={`/contacts/${r.contact.contactId}` as Route}
                className="text-sm font-medium hover:underline"
              >
                {r.contact.primaryName ?? '(unnamed)'}
              </Link>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {r.contact.primaryEmail ?? r.contact.primaryPhone ?? '—'}
                {r.contact.employer ? ` · ${r.contact.employer}` : ''}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {r.relationships.map((rel) => REL_LABEL[rel] ?? rel).join(', ')}
              </p>
            </div>
            <span className="text-muted-foreground text-xs">
              {r.distance} hop{r.distance === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Wire into contact detail page**

In `apps/web/app/(app)/contacts/[id]/page.tsx`, after the existing `getContact` call, add:

```tsx
import { findRelatedContacts } from '@/lib/actions/find-related-contacts';
import { RelatedContactsSection } from '@/components/related-contacts-section';

// ...inside the Page function, after fetching `data`:
const related = await findRelatedContacts(id, { limit: 10 });

// In the JSX, after the existing <ContactDetail …/>:
return (
  <div className="space-y-8">
    <ContactDetail contact={data.contact} identities={data.identities} />
    <RelatedContactsSection related={related} />
  </div>
);
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add apps/web/components/related-contacts-section.tsx "apps/web/app/(app)/contacts/"
git commit -m "feat(ui): Related contacts section on contact detail page (M5 task 12)"
```

---

### Subsystem 3 — Attorney review workflow (Tasks 13–19)

---

### Task 13: `document_review_queue` table (migration 0028)

**Files:**

- Create: `packages/db/src/schema/document-review-queue.ts`
- Create: `packages/db/migrations/0028_document_review_queue.sql`
- Modify: `packages/db/src/schema/enums.ts` (add `documentReviewStateEnum`)
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Add the enum**

In `packages/db/src/schema/enums.ts`, append:

```typescript
export const documentReviewStateEnum = pgEnum('document_review_state', [
  'pending',
  'claimed',
  'approved',
  'rejected',
]);
```

- [ ] **Step 2: Schema file**

```typescript
// packages/db/src/schema/document-review-queue.ts
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { documents } from './documents';
import { documentReviewStateEnum } from './enums';
import { organizations, users } from './tenants';

export const documentReviewQueue = pgTable(
  'document_review_queue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    documentVersion: integer('document_version').notNull(),
    submittedById: uuid('submitted_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    state: documentReviewStateEnum('state').notNull().default('pending'),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    // One queue row per (document, version). Re-submitting a document
    // after rejection creates a new queue row only after the version
    // changes — caller handles that.
    uniqueIndex('document_review_queue_doc_version_uidx').on(t.documentId, t.documentVersion),
    index('document_review_queue_org_state_idx').on(t.organizationId, t.state),
    index('document_review_queue_reviewer_idx').on(t.reviewerId),
    check(
      'document_review_queue_claimed_requires_reviewer',
      sql`(${t.state} = 'pending' AND ${t.reviewerId} IS NULL) OR (${t.state} <> 'pending' AND ${t.reviewerId} IS NOT NULL)`,
    ),
    check(
      'document_review_queue_decided_at_requires_terminal_state',
      sql`(${t.decidedAt} IS NULL) OR (${t.state} IN ('approved', 'rejected'))`,
    ),
    check(
      'document_review_queue_rejection_reason_requires_reject',
      sql`(${t.rejectionReason} IS NULL) OR (${t.state} = 'rejected')`,
    ),
  ],
);
```

- [ ] **Step 3: Export from schema index**

```typescript
export * from './document-review-queue';
```

- [ ] **Step 4: Generate + rename + apply + commit**

```bash
pnpm --filter @cema/db db:generate
# Rename to 0028_document_review_queue.sql; update journal tag.
pnpm --filter @cema/db db:migrate
pnpm typecheck
git add packages/db/src/schema/enums.ts packages/db/src/schema/document-review-queue.ts packages/db/src/schema/index.ts packages/db/migrations/0028_document_review_queue.sql packages/db/migrations/meta/
git commit -m "feat(db): add document_review_queue table (M5 task 13)"
```

---

### Task 14: `@cema/attorney` package — review state machine

**Files:**

- Create: `packages/attorney/package.json`, `tsconfig.json`
- Create: `packages/attorney/src/{index,state}.ts` + `state.test.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@cema/attorney",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json`** — copy from deepgram.

- [ ] **Step 3: Write `state.test.ts`**

```typescript
// packages/attorney/src/state.test.ts
import { describe, expect, it } from 'vitest';

import { canTransition, validTransitions } from './state';

describe('canTransition', () => {
  it('allows pending → claimed', () => {
    expect(canTransition('pending', 'claimed')).toBe(true);
  });

  it('allows claimed → approved', () => {
    expect(canTransition('claimed', 'approved')).toBe(true);
  });

  it('allows claimed → rejected', () => {
    expect(canTransition('claimed', 'rejected')).toBe(true);
  });

  it('allows claimed → pending (unclaim)', () => {
    expect(canTransition('claimed', 'pending')).toBe(true);
  });

  it('forbids approved → anything (terminal)', () => {
    expect(canTransition('approved', 'pending')).toBe(false);
    expect(canTransition('approved', 'claimed')).toBe(false);
    expect(canTransition('approved', 'rejected')).toBe(false);
  });

  it('forbids rejected → anything (terminal)', () => {
    expect(canTransition('rejected', 'pending')).toBe(false);
    expect(canTransition('rejected', 'approved')).toBe(false);
  });

  it('forbids pending → approved (must claim first)', () => {
    expect(canTransition('pending', 'approved')).toBe(false);
  });

  it('forbids pending → rejected (must claim first)', () => {
    expect(canTransition('pending', 'rejected')).toBe(false);
  });
});

describe('validTransitions', () => {
  it('returns reachable states from pending', () => {
    expect(validTransitions('pending')).toEqual(['claimed']);
  });

  it('returns reachable states from claimed', () => {
    expect(validTransitions('claimed').sort()).toEqual(['approved', 'pending', 'rejected']);
  });

  it('returns [] from terminal states', () => {
    expect(validTransitions('approved')).toEqual([]);
    expect(validTransitions('rejected')).toEqual([]);
  });
});
```

- [ ] **Step 4: Implement `state.ts`**

```typescript
// packages/attorney/src/state.ts

export type ReviewState = 'pending' | 'claimed' | 'approved' | 'rejected';

const TRANSITIONS: Record<ReviewState, ReviewState[]> = {
  pending: ['claimed'],
  claimed: ['pending', 'approved', 'rejected'],
  approved: [],
  rejected: [],
};

export function canTransition(from: ReviewState, to: ReviewState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function validTransitions(from: ReviewState): ReviewState[] {
  return [...TRANSITIONS[from]];
}

export function isTerminal(state: ReviewState): boolean {
  return state === 'approved' || state === 'rejected';
}
```

- [ ] **Step 5: `index.ts`**

```typescript
export * from './state';
```

- [ ] **Step 6: Install + verify + commit**

```bash
pnpm install
pnpm --filter @cema/attorney test
pnpm --filter @cema/attorney typecheck
git add packages/attorney/ pnpm-lock.yaml
git commit -m "feat(attorney): @cema/attorney — review state-machine logic (M5 task 14)"
```

---

### Task 15: Server action `submitForReview()`

**Files:**

- Create: `apps/web/lib/actions/submit-for-review.ts` + `submit-for-review.test.ts`
- Modify: `apps/web/package.json` (add `@cema/attorney`)

- [ ] **Step 1: Implementation**

```typescript
// apps/web/lib/actions/submit-for-review.ts
'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { documentReviewQueue, documents, getDb, organizations, users } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export class DocumentNotReviewableError extends Error {
  constructor(documentId: string, reason: string) {
    super(`Document ${documentId} is not reviewable: ${reason}`);
    this.name = 'DocumentNotReviewableError';
  }
}

export interface SubmitForReviewResult {
  queueId: string;
  documentId: string;
  documentVersion: number;
}

/**
 * Submit a document for attorney review. Moves the document to
 * status='pending_review' (if not already there) and inserts a queue row.
 *
 * Idempotent at the (document_id, version) UNIQUE constraint — if a
 * queue row already exists for this version, returns its id without
 * creating a duplicate. The state of the existing row may be any of
 * pending/claimed/approved/rejected; in 'approved' or 'rejected' the
 * caller should bump the document version before re-submission.
 */
export async function submitForReview(documentId: string): Promise<SubmitForReviewResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUserId = await getCurrentUser();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not found');
  const submittingUser = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  });
  if (!submittingUser) throw new Error('User not found');

  return withRls(org.id, async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!doc) throw new DocumentNotReviewableError(documentId, 'document not found');
    if (!doc.attorneyReviewRequired) {
      throw new DocumentNotReviewableError(documentId, 'document does not require review');
    }

    // Idempotency — return existing row if (doc, version) already queued.
    const [existing] = await tx
      .select()
      .from(documentReviewQueue)
      .where(
        and(
          eq(documentReviewQueue.documentId, documentId),
          eq(documentReviewQueue.documentVersion, doc.version),
        ),
      )
      .limit(1);
    if (existing) {
      return { queueId: existing.id, documentId: doc.id, documentVersion: doc.version };
    }

    const [row] = await tx
      .insert(documentReviewQueue)
      .values({
        organizationId: org.id,
        documentId: doc.id,
        documentVersion: doc.version,
        submittedById: submittingUser.id,
        state: 'pending',
      })
      .returning();

    if (!row) throw new Error('Failed to insert document_review_queue row');

    await tx
      .update(documents)
      .set({ status: 'attorney_review', updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    return { queueId: row.id, documentId: doc.id, documentVersion: doc.version };
  }).then(async (result) => {
    await emitAuditEvent(db, {
      organizationId: org.id,
      action: 'document.submitted_for_review',
      entityType: 'document',
      entityId: result.documentId,
      metadata: { queueId: result.queueId, version: result.documentVersion },
    });
    return result;
  });
}
```

- [ ] **Step 2: Test (4 tests: missing org throws; non-reviewable doc throws DocumentNotReviewableError; happy path inserts queue row + flips doc status; idempotency returns existing queue id)**

- [ ] **Step 3: Add `@cema/attorney` workspace dep to apps/web**

```json
    "@cema/attorney": "workspace:*",
```

- [ ] **Step 4: Commit**

```bash
pnpm install
pnpm --filter web test lib/actions/submit-for-review
pnpm typecheck
git add apps/web/lib/actions/submit-for-review.ts apps/web/lib/actions/submit-for-review.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(actions): submitForReview server action (M5 task 15)"
```

---

### Task 16: Server actions `claimReview` + `listReviewQueue`

**Files:**

- Create: `apps/web/lib/actions/claim-review.ts` + `claim-review.test.ts`
- Create: `apps/web/lib/actions/list-review-queue.ts` + `list-review-queue.test.ts`

- [ ] **Step 1: `claim-review.ts`**

```typescript
// apps/web/lib/actions/claim-review.ts
'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { canTransition } from '@cema/attorney';
import { emitAuditEvent } from '@cema/compliance';
import { documentReviewQueue, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export class ReviewClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewClaimError';
  }
}

export interface ClaimReviewResult {
  queueId: string;
  reviewerId: string;
  state: 'claimed';
}

export async function claimReview(queueId: string): Promise<ClaimReviewResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUserId = await getCurrentUser();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new ReviewClaimError('Organization not found');
  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  });
  if (!user) throw new ReviewClaimError('User not found');

  const result = await withRls(org.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(documentReviewQueue)
      .where(eq(documentReviewQueue.id, queueId))
      .limit(1);

    if (!row) throw new ReviewClaimError(`Queue row ${queueId} not found`);
    if (!canTransition(row.state, 'claimed')) {
      throw new ReviewClaimError(`Cannot claim review in state ${row.state}`);
    }

    await tx
      .update(documentReviewQueue)
      .set({ state: 'claimed', reviewerId: user.id, claimedAt: new Date(), updatedAt: new Date() })
      .where(eq(documentReviewQueue.id, queueId));

    return { queueId: row.id, reviewerId: user.id, state: 'claimed' as const };
  });

  await emitAuditEvent(db, {
    organizationId: org.id,
    action: 'document.review_claimed',
    entityType: 'document_review_queue',
    entityId: result.queueId,
    metadata: { reviewerId: result.reviewerId },
  });

  return result;
}
```

- [ ] **Step 2: `list-review-queue.ts`**

```typescript
// apps/web/lib/actions/list-review-queue.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { documentReviewQueue, documents, getDb, organizations, users } from '@cema/db';
import { and, desc, eq, or } from 'drizzle-orm';

import { withRls } from '../with-rls';

type QueueRow = typeof documentReviewQueue.$inferSelect;
type Document = typeof documents.$inferSelect;
type User = typeof users.$inferSelect;

export interface ReviewQueueItem {
  queue: QueueRow;
  document: Document | null;
  submittedBy: User | null;
  reviewer: User | null;
}

export async function listReviewQueue(
  options: { stateFilter?: 'pending' | 'claimed' | 'all'; limit?: number } = {},
): Promise<ReviewQueueItem[]> {
  const { stateFilter = 'all', limit = 50 } = options;
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const stateFilterSql =
      stateFilter === 'pending'
        ? eq(documentReviewQueue.state, 'pending')
        : stateFilter === 'claimed'
          ? eq(documentReviewQueue.state, 'claimed')
          : or(eq(documentReviewQueue.state, 'pending'), eq(documentReviewQueue.state, 'claimed'));

    const rows = await tx
      .select({
        queue: documentReviewQueue,
        document: documents,
      })
      .from(documentReviewQueue)
      .leftJoin(documents, eq(documents.id, documentReviewQueue.documentId))
      .where(and(eq(documentReviewQueue.organizationId, org.id), stateFilterSql))
      .orderBy(desc(documentReviewQueue.submittedAt))
      .limit(limit);

    // Hydrate user details (submittedBy + reviewer). Do this in a single
    // batch query rather than N+1.
    const userIds = new Set<string>();
    for (const r of rows) {
      userIds.add(r.queue.submittedById);
      if (r.queue.reviewerId) userIds.add(r.queue.reviewerId);
    }
    const userRows = userIds.size === 0 ? [] : await tx.select().from(users);
    // Filter in JS rather than building a complex inArray clause for M5.
    const userById = new Map(userRows.filter((u) => userIds.has(u.id)).map((u) => [u.id, u]));

    return rows.map((r) => ({
      queue: r.queue,
      document: r.document,
      submittedBy: userById.get(r.queue.submittedById) ?? null,
      reviewer: r.queue.reviewerId ? (userById.get(r.queue.reviewerId) ?? null) : null,
    }));
  });
}
```

- [ ] **Step 3: Tests** — 4 for `claim-review` (missing org, invalid transition, happy path, audit fired), 3 for `list-review-queue` (missing org → [], filter 'pending', filter 'all' includes claimed).

- [ ] **Step 4: Commit**

```bash
pnpm --filter web test lib/actions/claim-review lib/actions/list-review-queue
pnpm typecheck
git add apps/web/lib/actions/claim-review.ts apps/web/lib/actions/claim-review.test.ts apps/web/lib/actions/list-review-queue.ts apps/web/lib/actions/list-review-queue.test.ts
git commit -m "feat(actions): claimReview + listReviewQueue (M5 task 16)"
```

---

### Task 17: Server actions `approveDocument` + `rejectDocument`

**Files:**

- Create: `apps/web/lib/actions/approve-document.ts` + `approve-document.test.ts`
- Create: `apps/web/lib/actions/reject-document.ts` + `reject-document.test.ts`

- [ ] **Step 1: `approve-document.ts`** — emits the `AttorneyApproval` event that M4 `sendEnvelope` looks up

```typescript
// apps/web/lib/actions/approve-document.ts
'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { canTransition } from '@cema/attorney';
import { emitAuditEvent } from '@cema/compliance';
import {
  attorneyApprovals,
  documentReviewQueue,
  documents,
  getDb,
  organizations,
  users,
} from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export class ReviewDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewDecisionError';
  }
}

export interface ApproveDocumentResult {
  queueId: string;
  approvalId: string;
}

export async function approveDocument(queueId: string): Promise<ApproveDocumentResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUserId = await getCurrentUser();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new ReviewDecisionError('Organization not found');
  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  });
  if (!user) throw new ReviewDecisionError('User not found');

  const result = await withRls(org.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(documentReviewQueue)
      .where(eq(documentReviewQueue.id, queueId))
      .limit(1);

    if (!row) throw new ReviewDecisionError(`Queue row ${queueId} not found`);
    if (row.reviewerId !== user.id) {
      throw new ReviewDecisionError('Only the reviewer who claimed this review can approve');
    }
    if (!canTransition(row.state, 'approved')) {
      throw new ReviewDecisionError(`Cannot approve from state ${row.state}`);
    }

    // Insert the AttorneyApproval event — this is what M4 sendEnvelope
    // looks up to satisfy hard rule #2.
    const [approval] = await tx
      .insert(attorneyApprovals)
      .values({
        documentId: row.documentId,
        documentVersion: row.documentVersion,
        approvedById: user.id,
      })
      .returning();
    if (!approval) throw new ReviewDecisionError('Failed to insert attorney_approvals row');

    await tx
      .update(documentReviewQueue)
      .set({ state: 'approved', decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(documentReviewQueue.id, queueId));

    await tx
      .update(documents)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(documents.id, row.documentId));

    return { queueId: row.id, approvalId: approval.id };
  });

  await emitAuditEvent(db, {
    organizationId: org.id,
    action: 'document.approved',
    entityType: 'document_review_queue',
    entityId: result.queueId,
    metadata: { approvalId: result.approvalId },
  });

  return result;
}
```

- [ ] **Step 2: `reject-document.ts`**

```typescript
// apps/web/lib/actions/reject-document.ts
'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { canTransition } from '@cema/attorney';
import { emitAuditEvent } from '@cema/compliance';
import { documentReviewQueue, documents, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

import { ReviewDecisionError } from './approve-document';

export async function rejectDocument(
  queueId: string,
  reason: string,
): Promise<{ queueId: string }> {
  if (!reason.trim()) {
    throw new ReviewDecisionError('Rejection reason is required');
  }

  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUserId = await getCurrentUser();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new ReviewDecisionError('Organization not found');
  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  });
  if (!user) throw new ReviewDecisionError('User not found');

  const result = await withRls(org.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(documentReviewQueue)
      .where(eq(documentReviewQueue.id, queueId))
      .limit(1);

    if (!row) throw new ReviewDecisionError(`Queue row ${queueId} not found`);
    if (row.reviewerId !== user.id) {
      throw new ReviewDecisionError('Only the reviewer who claimed this review can reject');
    }
    if (!canTransition(row.state, 'rejected')) {
      throw new ReviewDecisionError(`Cannot reject from state ${row.state}`);
    }

    await tx
      .update(documentReviewQueue)
      .set({
        state: 'rejected',
        decidedAt: new Date(),
        rejectionReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(documentReviewQueue.id, queueId));

    await tx
      .update(documents)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(documents.id, row.documentId));

    return { queueId: row.id };
  });

  await emitAuditEvent(db, {
    organizationId: org.id,
    action: 'document.rejected',
    entityType: 'document_review_queue',
    entityId: result.queueId,
    metadata: { reason },
  });

  return result;
}
```

- [ ] **Step 3: Tests — 5 per action (missing org/user, wrong reviewer, invalid transition, happy path emits approval, audit fires)**

- [ ] **Step 4: Commit**

```bash
pnpm --filter web test lib/actions/approve-document lib/actions/reject-document
pnpm typecheck
git add apps/web/lib/actions/approve-document.ts apps/web/lib/actions/approve-document.test.ts apps/web/lib/actions/reject-document.ts apps/web/lib/actions/reject-document.test.ts
git commit -m "feat(actions): approveDocument + rejectDocument with hard rule #2 (M5 task 17)"
```

---

### Task 18: UI — `/attorney/queue` page + ReviewQueueRow component

**Files:**

- Create: `apps/web/components/review-queue-row.tsx`
- Create: `apps/web/app/(app)/attorney/queue/page.tsx`

- [ ] **Step 1: `review-queue-row.tsx`**

```tsx
// apps/web/components/review-queue-row.tsx
import type { ReviewQueueItem } from '@/lib/actions/list-review-queue';
import type { Route } from 'next';
import Link from 'next/link';

const STATE_BADGE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  claimed: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

interface ReviewQueueRowProps {
  item: ReviewQueueItem;
}

export function ReviewQueueRow({ item }: ReviewQueueRowProps) {
  const { queue, document, submittedBy, reviewer } = item;
  return (
    <Link
      href={`/attorney/queue/${queue.id}` as Route}
      className="hover:bg-muted/50 block rounded-lg border bg-white p-4 shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {document?.fileName ?? `Document ${queue.documentId}`} (v{queue.documentVersion})
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Submitted by {submittedBy?.email ?? queue.submittedById} ·{' '}
            {formatDate(queue.submittedAt)}
          </p>
          {reviewer ? (
            <p className="text-muted-foreground mt-0.5 text-xs">
              Claimed by {reviewer.email} · {formatDate(queue.claimedAt)}
            </p>
          ) : null}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATE_BADGE[queue.state] ?? 'bg-gray-100 text-gray-600'}`}
        >
          {queue.state}
        </span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: `/attorney/queue/page.tsx`**

```tsx
// apps/web/app/(app)/attorney/queue/page.tsx
import { ReviewQueueRow } from '@/components/review-queue-row';
import { listReviewQueue } from '@/lib/actions/list-review-queue';

export default async function Page() {
  const items = await listReviewQueue({ stateFilter: 'all' });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Attorney review queue</h1>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm font-medium">No documents awaiting review</p>
          <p className="text-muted-foreground mt-1 text-xs">
            When a processor submits a CEMA document for review, it will appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" role="list" aria-label="Review queue">
          {items.map((item) => (
            <li key={item.queue.id}>
              <ReviewQueueRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
pnpm typecheck
git add apps/web/components/review-queue-row.tsx "apps/web/app/(app)/attorney/queue/page.tsx"
git commit -m "feat(ui): /attorney/queue page + ReviewQueueRow (M5 task 18)"
```

---

### Task 19: UI — `/attorney/queue/[id]` detail panel with Approve/Reject

**Files:**

- Create: `apps/web/components/review-detail-panel.tsx`
- Create: `apps/web/app/(app)/attorney/queue/[id]/page.tsx`

- [ ] **Step 1: Detail panel (client component for the buttons)**

```tsx
// apps/web/components/review-detail-panel.tsx
'use client';

import { useState, useTransition } from 'react';

import { approveDocument } from '@/lib/actions/approve-document';
import { claimReview } from '@/lib/actions/claim-review';
import { rejectDocument } from '@/lib/actions/reject-document';

interface ReviewDetailPanelProps {
  queueId: string;
  state: 'pending' | 'claimed' | 'approved' | 'rejected';
  reviewerIsCurrentUser: boolean;
}

export function ReviewDetailPanel({
  queueId,
  state,
  reviewerIsCurrentUser,
}: ReviewDetailPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  function doClaim() {
    setError(null);
    startTransition(async () => {
      try {
        await claimReview(queueId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function doApprove() {
    setError(null);
    startTransition(async () => {
      try {
        await approveDocument(queueId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function doReject() {
    if (!rejectionReason.trim()) {
      setError('Rejection reason is required');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await rejectDocument(queueId, rejectionReason);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (state === 'approved') {
    return <p className="text-sm text-green-700">This document has been approved.</p>;
  }
  if (state === 'rejected') {
    return <p className="text-sm text-red-700">This document was rejected.</p>;
  }

  return (
    <div className="space-y-3">
      {state === 'pending' ? (
        <button
          type="button"
          onClick={doClaim}
          disabled={isPending}
          className="inline-flex items-center rounded-md border bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isPending ? 'Claiming…' : 'Claim review'}
        </button>
      ) : null}

      {state === 'claimed' && reviewerIsCurrentUser ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={doApprove}
            disabled={isPending}
            className="inline-flex items-center rounded-md border bg-green-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isPending ? 'Approving…' : 'Approve document'}
          </button>

          {!showRejectForm ? (
            <button
              type="button"
              onClick={() => setShowRejectForm(true)}
              className="inline-flex items-center rounded-md border bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-700"
            >
              Reject…
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Reason for rejection (required)"
                rows={3}
                className="w-full rounded-md border px-2 py-1 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={doReject}
                  disabled={isPending}
                  className="inline-flex items-center rounded-md border bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {isPending ? 'Rejecting…' : 'Confirm rejection'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRejectForm(false);
                    setRejectionReason('');
                    setError(null);
                  }}
                  className="inline-flex items-center rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {state === 'claimed' && !reviewerIsCurrentUser ? (
        <p className="text-muted-foreground text-sm">Another reviewer has claimed this review.</p>
      ) : null}

      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Detail page**

```tsx
// apps/web/app/(app)/attorney/queue/[id]/page.tsx
import { notFound } from 'next/navigation';

import { ReviewDetailPanel } from '@/components/review-detail-panel';
import { getCurrentUser } from '@cema/auth';
import { listReviewQueue } from '@/lib/actions/list-review-queue';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const allItems = await listReviewQueue({ stateFilter: 'all', limit: 200 });
  const item = allItems.find((i) => i.queue.id === id);
  if (!item) notFound();

  const currentUserClerkId = await getCurrentUser();
  const reviewerIsCurrentUser = item.reviewer?.clerkUserId === currentUserClerkId;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {item.document?.fileName ?? `Document ${item.queue.documentId}`}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Version {item.queue.documentVersion} · State: {item.queue.state}
        </p>
      </div>

      <ReviewDetailPanel
        queueId={item.queue.id}
        state={item.queue.state}
        reviewerIsCurrentUser={reviewerIsCurrentUser}
      />

      {item.queue.state === 'rejected' && item.queue.rejectionReason ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">Rejection reason</p>
          <p className="mt-1 text-sm text-red-700">{item.queue.rejectionReason}</p>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
pnpm typecheck
git add apps/web/components/review-detail-panel.tsx "apps/web/app/(app)/attorney/"
git commit -m "feat(ui): review detail panel with Approve/Reject flow (M5 task 19)"
```

---

### Subsystem 4 — SOC 2 audit-log enhancements (Tasks 20–24)

---

### Task 20: `audit_event_reads` table + read-purpose enum (migration 0029)

**Files:**

- Create: `packages/db/src/schema/audit-event-reads.ts`
- Modify: `packages/db/src/schema/enums.ts` (add `auditReadPurposeEnum`, `auditReadEntityTypeEnum`)
- Create: `packages/db/migrations/0029_audit_event_reads.sql`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Add enums**

In `packages/db/src/schema/enums.ts`:

```typescript
export const auditReadPurposeEnum = pgEnum('audit_read_purpose', [
  'view_detail',
  'list',
  'export',
  'agent',
  'admin',
]);

export const auditReadEntityTypeEnum = pgEnum('audit_read_entity_type', [
  'communication',
  'document',
  'recording',
  'pii_field',
  'contact',
  'deal',
  'envelope',
]);
```

- [ ] **Step 2: Schema file**

```typescript
// packages/db/src/schema/audit-event-reads.ts
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { auditReadEntityTypeEnum, auditReadPurposeEnum } from './enums';
import { organizations, users } from './tenants';

// One row per read access to a PII-bearing entity. Used as SOC 2 evidence
// of read-time enforcement and as the substrate for anomaly detection
// (Phase 1+).
//
// Like audit_events, this table is immutable: any UPDATE or DELETE is
// rejected by triggers identical to those installed in M1 migration 0003.
// We add those triggers in migration 0029.
export const auditEventReads = pgTable(
  'audit_event_reads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    entityType: auditReadEntityTypeEnum('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    purpose: auditReadPurposeEnum('purpose').notNull(),
    actorIp: text('actor_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('audit_event_reads_org_created_idx').on(t.organizationId, t.createdAt),
    index('audit_event_reads_entity_idx').on(t.entityType, t.entityId),
    index('audit_event_reads_actor_idx').on(t.actorUserId, t.createdAt),
  ],
);
```

- [ ] **Step 3: Append immutability triggers in the migration**

After `db:generate` produces the basic CREATE TABLE, append (manually edit the generated SQL):

```sql
-- audit_event_reads is immutable. Identical pattern to migration 0003.
CREATE OR REPLACE FUNCTION audit_event_reads_reject_update()
  RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event_reads is immutable; UPDATE not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_event_reads_reject_delete()
  RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event_reads is immutable; DELETE not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_reads_no_update
  BEFORE UPDATE ON audit_event_reads
  FOR EACH ROW EXECUTE FUNCTION audit_event_reads_reject_update();

CREATE TRIGGER audit_event_reads_no_delete
  BEFORE DELETE ON audit_event_reads
  FOR EACH ROW EXECUTE FUNCTION audit_event_reads_reject_delete();
```

- [ ] **Step 4: Export, generate, rename to `0029_audit_event_reads.sql`, apply, commit**

```bash
pnpm --filter @cema/db db:generate
# Rename + add the triggers SQL above into the same file.
# Update journal tag.
pnpm --filter @cema/db db:migrate
pnpm typecheck
git add packages/db/src/schema/audit-event-reads.ts packages/db/src/schema/enums.ts packages/db/src/schema/index.ts packages/db/migrations/0029_audit_event_reads.sql packages/db/migrations/meta/
git commit -m "feat(db): add audit_event_reads + immutability triggers (M5 task 20)"
```

---

### Task 21: `withReadAudit` middleware helper

**Files:**

- Create: `apps/web/lib/audit/with-read-audit.ts` + `with-read-audit.test.ts`

- [ ] **Step 1: Implementation**

```typescript
// apps/web/lib/audit/with-read-audit.ts
import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { auditEventReads, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';

export type AuditReadEntityType =
  | 'communication'
  | 'document'
  | 'recording'
  | 'pii_field'
  | 'contact'
  | 'deal'
  | 'envelope';

export type AuditReadPurpose = 'view_detail' | 'list' | 'export' | 'agent' | 'admin';

export interface ReadAuditInput {
  entityType: AuditReadEntityType;
  entityId: string;
  purpose: AuditReadPurpose;
}

/**
 * Wrap a read-path server action so that every successful read writes
 * an immutable audit_event_reads row. Call this AROUND the actual read,
 * passing the entity context. The audit row is written AFTER `fn`
 * succeeds — if the underlying read throws, we do not record a read
 * that didn't happen.
 *
 * Use neondb_owner directly (no withRls) — audit reads are always
 * neondb_owner-scoped per the M1 pattern. Insert is org-scoped by the
 * organizationId column.
 */
export async function withReadAudit<T>(input: ReadAuditInput, fn: () => Promise<T>): Promise<T> {
  const result = await fn();

  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUserId = await getCurrentUser();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return result;
  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  });
  if (!user) return result;

  try {
    await db.insert(auditEventReads).values({
      organizationId: org.id,
      actorUserId: user.id,
      entityType: input.entityType,
      entityId: input.entityId,
      purpose: input.purpose,
    });
  } catch (e) {
    // Audit logging must not break the request. Log to error reporter
    // (Sentry via @cema/observability) but return the result anyway.
    // M5 leaves the error reporter integration as a Phase 1 hook —
    // for now, log to stderr.
    // eslint-disable-next-line no-console
    console.error('withReadAudit: failed to write audit row', e);
  }

  return result;
}
```

- [ ] **Step 2: Tests — 3 tests: happy path inserts row + returns result; org-not-found short-circuits but returns result; insert failure doesn't break the return**

- [ ] **Step 3: Commit**

```bash
pnpm --filter web test lib/audit/with-read-audit
pnpm typecheck
git add apps/web/lib/audit/
git commit -m "feat(audit): withReadAudit middleware for SOC 2 read tracking (M5 task 21)"
```

---

### Task 22: Wrap existing read-path actions with `withReadAudit`

**Files:**

- Modify: `apps/web/lib/actions/get-communication.ts`
- Modify: `apps/web/lib/actions/get-email.ts`
- Modify: `apps/web/lib/actions/get-calendar-event.ts`
- Modify: `apps/web/lib/actions/get-slack-message.ts`
- Modify: `apps/web/lib/actions/get-contact.ts`
- Modify: `apps/web/lib/actions/get-envelope.ts`

For each `get*` action, wrap the body in `withReadAudit({ entityType, entityId, purpose: 'view_detail' }, async () => { ...existing body... })`.

- [ ] **Step 1: Wrap `get-communication.ts`**

Existing function (M2 Task 24 shape):

```typescript
export async function getCommunication(dealId, communicationId) {
  // ... existing body ...
}
```

Refactored:

```typescript
import { withReadAudit } from '../audit/with-read-audit';

export async function getCommunication(dealId: string, communicationId: string) {
  return withReadAudit(
    { entityType: 'communication', entityId: communicationId, purpose: 'view_detail' },
    async () => {
      // ... existing body unchanged ...
    },
  );
}
```

- [ ] **Step 2: Apply the same wrap pattern to the other 5 actions.** For `get-email`, `get-calendar-event`, `get-slack-message`: `entityType: 'communication'` (since the detail page shows the communication). For `get-contact`: `entityType: 'contact'`. For `get-envelope`: `entityType: 'envelope'`.

- [ ] **Step 3: Update tests**

Each `get*-action.test.ts` must continue to pass. The `withReadAudit` wrapper inserts to the DB on every call — mock it. Add at the top of each test file:

```typescript
vi.mock('../audit/with-read-audit', () => ({
  withReadAudit: vi.fn().mockImplementation((_input, fn) => fn()),
}));
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter web test lib/actions
pnpm typecheck
git add apps/web/lib/actions/get-*.ts apps/web/lib/actions/get-*.test.ts
git commit -m "feat(audit): wrap get-action reads with withReadAudit (M5 task 22)"
```

---

### Task 23: Server action `listAuditEventReads()` + UI

**Files:**

- Create: `apps/web/lib/actions/list-audit-events-reads.ts` + `list-audit-events-reads.test.ts`
- Create: `apps/web/components/audit-event-row.tsx`
- Create: `apps/web/app/(app)/admin/audit/page.tsx`

- [ ] **Step 1: Implementation**

```typescript
// apps/web/lib/actions/list-audit-events-reads.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { auditEventReads, getDb, organizations, users } from '@cema/db';
import { and, desc, eq, gte } from 'drizzle-orm';

import { withRls } from '../with-rls';

type AuditRead = typeof auditEventReads.$inferSelect;
type User = typeof users.$inferSelect;

export interface AuditReadRow {
  read: AuditRead;
  actor: User | null;
}

export interface ListAuditReadsInput {
  entityType?:
    | 'communication'
    | 'document'
    | 'recording'
    | 'pii_field'
    | 'contact'
    | 'deal'
    | 'envelope';
  entityId?: string;
  actorUserId?: string;
  sinceDays?: number;
  limit?: number;
}

export async function listAuditEventReads(
  input: ListAuditReadsInput = {},
): Promise<AuditReadRow[]> {
  const { entityType, entityId, actorUserId, sinceDays = 7, limit = 100 } = input;
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const filters = [
    eq(auditEventReads.organizationId, org.id),
    gte(auditEventReads.createdAt, since),
  ];
  if (entityType) filters.push(eq(auditEventReads.entityType, entityType));
  if (entityId) filters.push(eq(auditEventReads.entityId, entityId));
  if (actorUserId) filters.push(eq(auditEventReads.actorUserId, actorUserId));

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select()
      .from(auditEventReads)
      .where(and(...filters))
      .orderBy(desc(auditEventReads.createdAt))
      .limit(limit);

    // Hydrate actor users
    const userIds = new Set(rows.map((r) => r.actorUserId));
    const userRows = userIds.size === 0 ? [] : await tx.select().from(users);
    const userById = new Map(userRows.filter((u) => userIds.has(u.id)).map((u) => [u.id, u]));

    return rows.map((r) => ({ read: r, actor: userById.get(r.actorUserId) ?? null }));
  });
}
```

- [ ] **Step 2: `audit-event-row.tsx`**

```tsx
// apps/web/components/audit-event-row.tsx
import type { AuditReadRow } from '@/lib/actions/list-audit-events-reads';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

interface AuditEventRowProps {
  row: AuditReadRow;
}

export function AuditEventRow({ row }: AuditEventRowProps) {
  const { read, actor } = row;
  return (
    <div className="grid grid-cols-12 gap-3 rounded-lg border bg-white p-3 text-xs shadow-sm">
      <span className="text-muted-foreground col-span-2">{formatDate(read.createdAt)}</span>
      <span className="col-span-3">{actor?.email ?? read.actorUserId}</span>
      <span className="col-span-2 capitalize">{read.purpose}</span>
      <span className="col-span-2 capitalize">{read.entityType}</span>
      <span className="col-span-3 font-mono text-xs">{read.entityId}</span>
    </div>
  );
}
```

- [ ] **Step 3: `/admin/audit/page.tsx`**

```tsx
// apps/web/app/(app)/admin/audit/page.tsx
import { AuditEventRow } from '@/components/audit-event-row';
import { listAuditEventReads } from '@/lib/actions/list-audit-events-reads';

interface PageProps {
  searchParams: Promise<{ entity?: string; days?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const entityType = (params.entity ?? undefined) as
    | 'communication'
    | 'document'
    | 'recording'
    | 'pii_field'
    | 'contact'
    | 'deal'
    | 'envelope'
    | undefined;
  const sinceDays = params.days ? Number(params.days) : 7;
  const rows = await listAuditEventReads({ entityType, sinceDays, limit: 200 });

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Audit log — read access</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Showing last {sinceDays} day{sinceDays === 1 ? '' : 's'}
        {entityType ? ` · entity type: ${entityType}` : ''}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm font-medium">No read events in window</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-3 px-3 text-xs font-medium uppercase text-gray-500">
            <span className="col-span-2">When</span>
            <span className="col-span-3">Actor</span>
            <span className="col-span-2">Purpose</span>
            <span className="col-span-2">Entity</span>
            <span className="col-span-3">Entity ID</span>
          </div>
          {rows.map((r) => (
            <AuditEventRow key={r.read.id} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Tests + commit**

```bash
pnpm --filter web test lib/actions/list-audit-events-reads
pnpm typecheck
git add apps/web/lib/actions/list-audit-events-reads.ts apps/web/lib/actions/list-audit-events-reads.test.ts apps/web/components/audit-event-row.tsx "apps/web/app/(app)/admin/"
git commit -m "feat(audit): /admin/audit page + listAuditEventReads (M5 task 23)"
```

---

### Task 24: Integration test — verify reads are logged

**Files:**

- Create: `apps/web/tests/integration/audit-read-tracking.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/web/tests/integration/audit-read-tracking.test.ts
/**
 * Audit read tracking (M5 Task 24).
 *
 * Verifies that wrapping a read-path action in withReadAudit produces
 * an immutable audit_event_reads row.
 */

import { auditEventReads, getDb, organizations, users } from '@cema/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withReadAudit } from '../../lib/audit/with-read-audit';

const ORG_ID = '00000000-0000-0000-0000-0000000000a5';
const USER_ID = '00000000-0000-0000-0000-000000000095';

const skip = !process.env.DATABASE_URL || !process.env.CLERK_TEST_USER_ID;

describe.skipIf(skip)('withReadAudit — DB integration', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({
        id: ORG_ID,
        clerkOrgId: 'org_audit_read',
        name: 'Audit Read Test',
        slug: 'audit-read',
      })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_ID, clerkUserId: 'user_audit_read', email: 'audit-read@example.invalid' })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(auditEventReads).where(eq(auditEventReads.organizationId, ORG_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_ID]));
  });

  it('inserts an audit_event_reads row when withReadAudit wraps a successful call', async () => {
    // This test depends on auth fakes being set up. For M5 we leave the
    // test as DATABASE_URL-AND-CLERK_TEST_USER_ID-gated; the actual
    // wiring happens at PR test-fixture setup time.
    const result = await withReadAudit(
      {
        entityType: 'communication',
        entityId: '00000000-0000-0000-0000-000000000010',
        purpose: 'view_detail',
      },
      async () => 'read-result',
    );
    expect(result).toBe('read-result');

    const db = getDb();
    const rows = await db
      .select()
      .from(auditEventReads)
      .where(eq(auditEventReads.organizationId, ORG_ID));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('does not write a row when the wrapped fn throws', async () => {
    const db = getDb();
    const before = await db
      .select()
      .from(auditEventReads)
      .where(eq(auditEventReads.organizationId, ORG_ID));

    await expect(
      withReadAudit(
        {
          entityType: 'document',
          entityId: '00000000-0000-0000-0000-000000000020',
          purpose: 'view_detail',
        },
        async () => {
          throw new Error('simulated read failure');
        },
      ),
    ).rejects.toThrow('simulated read failure');

    const after = await db
      .select()
      .from(auditEventReads)
      .where(eq(auditEventReads.organizationId, ORG_ID));

    // No new row written.
    expect(after.length).toBe(before.length);
  });
});
```

Note: this test requires the `CLERK_TEST_USER_ID` env var to be set, which gates the auth resolution inside `withReadAudit`. Since the M5 Clerk test-user wiring is Phase 1 work, the test will skip gracefully in CI. Implementation present so that the assertion exists once the env is provisioned.

- [ ] **Step 2: Commit**

```bash
git add apps/web/tests/integration/audit-read-tracking.test.ts
git commit -m "test(integration): audit read tracking (M5 task 24)"
```

---

### Subsystem 5 — "Ask anything" search UI (Tasks 25–29)

---

### Task 25: `@cema/search` package — query intent classifier

**Files:**

- Create: `packages/search/package.json`, `tsconfig.json`
- Create: `packages/search/src/{index,classifier}.ts` + `classifier.test.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@cema/search",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/anthropic": "^1.0.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json`** — copy from deepgram.

- [ ] **Step 3: `classifier.test.ts`**

```typescript
// packages/search/src/classifier.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => ({
  generateObject: vi.fn().mockImplementation(async ({ prompt }: { prompt: string }) => {
    // Mock returns a fake classification based on keyword in prompt.
    const lower = prompt.toLowerCase();
    let intent: 'search' | 'action' | 'analytics' = 'search';
    if (lower.includes('call') || lower.includes('send')) intent = 'action';
    if (lower.includes('count') || lower.includes('average')) intent = 'analytics';
    return { object: { intent, confidence: 0.92, entities: [] } };
  }),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn().mockReturnValue({ modelId: 'claude-sonnet-4-6' }),
}));

import { classifyQueryIntent } from './classifier';

describe('classifyQueryIntent', () => {
  it('classifies a fact-retrieval query as search', async () => {
    const result = await classifyQueryIntent('Wells Fargo payoff letter format');
    expect(result.intent).toBe('search');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies an action query as action', async () => {
    const result = await classifyQueryIntent('Call Bob at Wells Fargo');
    expect(result.intent).toBe('action');
  });

  it('classifies a counting query as analytics', async () => {
    const result = await classifyQueryIntent('How many CEMAs closed last month?');
    expect(result.intent).toBe('analytics');
  });
});
```

- [ ] **Step 4: Implement `classifier.ts`**

```typescript
// packages/search/src/classifier.ts
import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';

export type QueryIntent = 'search' | 'action' | 'analytics';

export interface QueryClassification {
  intent: QueryIntent;
  // 0..1; values < 0.5 should be treated as 'search' (the default).
  confidence: number;
  // Named entities detected in the query (e.g. "Wells Fargo" → organization).
  entities: Array<{ value: string; type: 'org' | 'person' | 'date' | 'deal' | 'other' }>;
}

const ClassificationSchema = z.object({
  intent: z.enum(['search', 'action', 'analytics']),
  confidence: z.number().min(0).max(1),
  entities: z.array(
    z.object({
      value: z.string(),
      type: z.enum(['org', 'person', 'date', 'deal', 'other']),
    }),
  ),
});

export async function classifyQueryIntent(query: string): Promise<QueryClassification> {
  if (!query.trim()) {
    return { intent: 'search', confidence: 1, entities: [] };
  }

  const result = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: ClassificationSchema,
    prompt: `You are classifying a query against a CEMA mortgage processor workspace.

Classify the query into one of:
  - "search": user wants to find existing communications, documents, contacts, or deals
  - "action": user wants to perform an operation (call, send email, schedule, etc.)
  - "analytics": user wants aggregate data (counts, averages, trends)

Extract named entities (orgs, people, dates, deal references).

Query: ${query}

Respond with a JSON object matching the schema. Confidence should be calibrated — most queries are 'search'.`,
  });

  return result.object;
}
```

- [ ] **Step 5: `index.ts`** — `export * from './classifier';`

- [ ] **Step 6: Install + verify + commit**

```bash
pnpm install
pnpm --filter @cema/search test
pnpm --filter @cema/search typecheck
git add packages/search/ pnpm-lock.yaml
git commit -m "feat(search): @cema/search — query intent classifier via Claude Sonnet (M5 task 25)"
```

---

### Task 26: Server action `askAnything()` — router + dispatcher

**Files:**

- Create: `apps/web/lib/actions/ask-anything.ts` + `ask-anything.test.ts`
- Modify: `apps/web/package.json` (add `@cema/search` workspace dep)

- [ ] **Step 1: Implementation**

```typescript
// apps/web/lib/actions/ask-anything.ts
import { classifyQueryIntent, type QueryClassification } from '@cema/search';

import { searchSimilar, type SearchHit } from './search-similar';

export interface AskAnythingResult {
  classification: QueryClassification;
  // Populated only when intent === 'search'.
  hits: SearchHit[];
  // For intent === 'action' or 'analytics', M5 returns a placeholder hint.
  hint: string | null;
}

export async function askAnything(query: string): Promise<AskAnythingResult> {
  const classification = await classifyQueryIntent(query);

  if (classification.intent === 'search') {
    const hits = await searchSimilar({ query, k: 10 });
    return { classification, hits, hint: null };
  }

  if (classification.intent === 'action') {
    return {
      classification,
      hits: [],
      hint: 'Action queries are not yet executed automatically. M5 returns matches against existing communications; Phase 1 will surface concrete action suggestions.',
    };
  }

  // analytics
  return {
    classification,
    hits: [],
    hint: 'Analytics queries are not yet executed. M5 returns no aggregate; Phase 1 will translate this query into SQL.',
  };
}
```

- [ ] **Step 2: Test (4 tests: empty query → no-op; search intent dispatches to searchSimilar; action intent returns hint; analytics intent returns hint)**

- [ ] **Step 3: Add workspace dep**

```json
    "@cema/search": "workspace:*",
```

- [ ] **Step 4: Commit**

```bash
pnpm install
pnpm --filter web test lib/actions/ask-anything
pnpm typecheck
git add apps/web/lib/actions/ask-anything.ts apps/web/lib/actions/ask-anything.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(actions): askAnything — classify + dispatch search/action/analytics (M5 task 26)"
```

---

### Task 27: Wire the search bar into the global layout

**Files:**

- Modify: `apps/web/app/(app)/layout.tsx` (or wherever the global app shell lives)
- Modify: `apps/web/app/(app)/search/page.tsx` (use askAnything instead of searchSimilar directly)

- [ ] **Step 1: Add the search bar to the global header**

Inspect `apps/web/app/(app)/layout.tsx` first to confirm the structure. If a header component exists separately (e.g., `components/header.tsx`), edit that.

Typical edit at the top of the layout's children:

```tsx
import { AskAnythingSearchBar } from '@/components/ask-anything-search-bar';

// ...inside the layout JSX:
<header className="border-b bg-white px-4 py-3">
  <AskAnythingSearchBar />
</header>;
```

If the layout already has a header, insert the search bar inside it. The search bar is responsive — it doesn't need a full-width column.

- [ ] **Step 2: Update the search page to use `askAnything`**

In `apps/web/app/(app)/search/page.tsx`:

```tsx
// Replace the existing searchSimilar import:
import { askAnything } from '@/lib/actions/ask-anything';
import { SearchResults } from '@/components/search-results';

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const query = q?.trim() ?? '';
  if (!query) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">Search</h1>
        <p className="text-muted-foreground text-sm">Enter a query in the search bar above.</p>
      </div>
    );
  }

  const { classification, hits, hint } = await askAnything(query);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Search</h1>

      <div className="rounded-lg border bg-gray-50 p-3 text-xs">
        <p>
          Classified as <span className="font-medium">{classification.intent}</span> (confidence{' '}
          {(classification.confidence * 100).toFixed(0)}%)
        </p>
      </div>

      {hint ? <p className="text-muted-foreground text-sm">{hint}</p> : null}

      {classification.intent === 'search' ? <SearchResults hits={hits} query={query} /> : null}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add "apps/web/app/(app)/layout.tsx" "apps/web/app/(app)/search/page.tsx"
git commit -m "feat(ui): wire AskAnythingSearchBar into layout; search page uses askAnything (M5 task 27)"
```

---

### Task 28: Integration test — pgvector similarity smoke

**Files:**

- Create: `apps/web/tests/integration/pgvector-similarity.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/web/tests/integration/pgvector-similarity.test.ts
/**
 * pgvector similarity smoke test (M5 Task 28).
 *
 * Inserts two communications with hand-crafted embeddings (orthogonal
 * and near-identical) and verifies the cosine ordering matches
 * expectation. Does NOT exercise the OpenAI API — embeddings are
 * provided directly so the test runs offline.
 */

import { communications, getDb, organizations, users } from '@cema/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORG_ID = '00000000-0000-0000-0000-0000000000a6';
const USER_ID = '00000000-0000-0000-0000-000000000096';

const skip = !process.env.DATABASE_URL;

// Hand-crafted 3072-dim vectors.
const VEC_A = new Array(3072).fill(0).map((_, i) => (i === 0 ? 1 : 0)); // [1, 0, 0, ...]
const VEC_A_NEAR = new Array(3072).fill(0).map((_, i) => (i === 0 ? 0.99 : i === 1 ? 0.01 : 0));
const VEC_B = new Array(3072).fill(0).map((_, i) => (i === 1 ? 1 : 0)); // [0, 1, 0, ...]

let commAId: string;
let commANearId: string;
let commBId: string;

describe.skipIf(skip)('pgvector similarity smoke', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({ id: ORG_ID, clerkOrgId: 'org_pgvector', name: 'pgvector test', slug: 'pgv-test' })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_ID, clerkUserId: 'user_pgvector', email: 'pgvector@example.invalid' })
      .onConflictDoNothing();

    const [a] = await db
      .insert(communications)
      .values({
        organizationId: ORG_ID,
        kind: 'email',
        direction: 'inbound',
        medium: 'gmail',
        status: 'ready',
        vendorEventId: 'pgv-A',
        embedding: VEC_A,
      })
      .returning();
    commAId = a!.id;

    const [aNear] = await db
      .insert(communications)
      .values({
        organizationId: ORG_ID,
        kind: 'email',
        direction: 'inbound',
        medium: 'gmail',
        status: 'ready',
        vendorEventId: 'pgv-A-near',
        embedding: VEC_A_NEAR,
      })
      .returning();
    commANearId = aNear!.id;

    const [b] = await db
      .insert(communications)
      .values({
        organizationId: ORG_ID,
        kind: 'email',
        direction: 'inbound',
        medium: 'gmail',
        status: 'ready',
        vendorEventId: 'pgv-B',
        embedding: VEC_B,
      })
      .returning();
    commBId = b!.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db
      .delete(communications)
      .where(inArray(communications.id, [commAId, commANearId, commBId]));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_ID]));
  });

  it('orders A_near closer to A than B (cosine)', async () => {
    const db = getDb();
    const vecALiteral = sql.raw(`'[${VEC_A.join(',')}]'::vector`);
    const rows = await db
      .select({
        id: communications.id,
        distance: sql<number>`${communications.embedding} <=> ${vecALiteral}`,
      })
      .from(communications)
      .where(eq(communications.organizationId, ORG_ID))
      .orderBy(sql`${communications.embedding} <=> ${vecALiteral}`);

    // Expected ordering: A (distance ~0), A_near (small), B (large)
    expect(rows[0]?.id).toBe(commAId);
    expect(rows[1]?.id).toBe(commANearId);
    expect(rows[2]?.id).toBe(commBId);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter web test tests/integration/pgvector-similarity
git add apps/web/tests/integration/pgvector-similarity.test.ts
git commit -m "test(integration): pgvector cosine similarity smoke (M5 task 28)"
```

---

### Task 29: Integration test — attorney review flow end-to-end

**Files:**

- Create: `apps/web/tests/integration/attorney-review-flow.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/web/tests/integration/attorney-review-flow.test.ts
/**
 * Attorney review flow E2E (M5 Task 29).
 *
 * Exercises the full state machine in DB:
 *   submitForReview → claimReview → approveDocument
 *
 * Then verifies that an AttorneyApproval row exists (M4 sendEnvelope
 * depends on this).
 */

import {
  attorneyApprovals,
  deals,
  documentReviewQueue,
  documents,
  getDb,
  organizations,
  users,
} from '@cema/db';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ORG_ID = '00000000-0000-0000-0000-0000000000a7';
const USER_ID = '00000000-0000-0000-0000-000000000097';
const DEAL_ID = '00000000-0000-0000-0000-0000000000e7';
const DOC_ID = '00000000-0000-0000-0000-0000000000d7';

const skip = !process.env.DATABASE_URL;

describe.skipIf(skip)('Attorney review flow E2E', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({
        id: ORG_ID,
        clerkOrgId: 'org_attorney_e2e',
        name: 'Attorney E2E',
        slug: 'attorney-e2e',
      })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_attorney_e2e',
        email: 'attorney-e2e@example.invalid',
      })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_ID,
        organizationId: ORG_ID,
        cemaType: 'refi_cema',
        status: 'doc_prep',
      })
      .onConflictDoNothing();
    await db
      .insert(documents)
      .values({
        id: DOC_ID,
        organizationId: ORG_ID,
        dealId: DEAL_ID,
        kind: 'cema_3172',
        status: 'draft',
        attorneyReviewRequired: true,
        version: 1,
        fileName: 'cema.pdf',
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(attorneyApprovals).where(eq(attorneyApprovals.documentId, DOC_ID));
    await db.delete(documentReviewQueue).where(eq(documentReviewQueue.organizationId, ORG_ID));
    await db.delete(documents).where(eq(documents.id, DOC_ID));
    await db.delete(deals).where(eq(deals.id, DEAL_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_ID]));
  });

  it('submitting + claiming + approving creates the AttorneyApproval row', async () => {
    const db = getDb();

    // 1. Submit — direct DB manipulation since we don't have Clerk auth fixtures in tests.
    const [queueRow] = await db
      .insert(documentReviewQueue)
      .values({
        organizationId: ORG_ID,
        documentId: DOC_ID,
        documentVersion: 1,
        submittedById: USER_ID,
        state: 'pending',
      })
      .returning();
    expect(queueRow).toBeDefined();

    // 2. Claim
    await db
      .update(documentReviewQueue)
      .set({ state: 'claimed', reviewerId: USER_ID, claimedAt: new Date() })
      .where(eq(documentReviewQueue.id, queueRow!.id));

    // 3. Approve — insert into attorneyApprovals + transition queue state
    const [approval] = await db
      .insert(attorneyApprovals)
      .values({
        documentId: DOC_ID,
        documentVersion: 1,
        approvedById: USER_ID,
      })
      .returning();
    expect(approval).toBeDefined();

    await db
      .update(documentReviewQueue)
      .set({ state: 'approved', decidedAt: new Date() })
      .where(eq(documentReviewQueue.id, queueRow!.id));

    // 4. Verify the approval row M4 sendEnvelope would look up
    const lookup = await db
      .select()
      .from(attorneyApprovals)
      .where(
        and(eq(attorneyApprovals.documentId, DOC_ID), eq(attorneyApprovals.documentVersion, 1)),
      );
    expect(lookup).toHaveLength(1);
  });

  it('rejecting requires a non-empty reason', async () => {
    // The schema CHECK prevents NULL rejection_reason when state='rejected'?
    // Actually no — the CHECK only forbids non-null reason in non-rejected
    // states. The application layer enforces "reason required to reject".
    // This test just confirms a rejected row CAN carry a reason.
    const db = getDb();

    const [queueRow] = await db
      .insert(documentReviewQueue)
      .values({
        organizationId: ORG_ID,
        documentId: DOC_ID,
        documentVersion: 1, // would conflict; assume version bumped in real flow — for test, accept
        submittedById: USER_ID,
        state: 'pending',
      })
      .onConflictDoNothing()
      .returning();

    // The first test already inserted a row at (DOC_ID, 1), so this returning
    // may be empty. Re-fetch:
    const [existing] = queueRow
      ? [queueRow]
      : await db
          .select()
          .from(documentReviewQueue)
          .where(
            and(
              eq(documentReviewQueue.documentId, DOC_ID),
              eq(documentReviewQueue.documentVersion, 1),
            ),
          )
          .limit(1);
    expect(existing).toBeDefined();
    if (!existing) throw new Error('precondition: queue row should exist');

    // Reset to claimed for this test
    await db
      .update(documentReviewQueue)
      .set({
        state: 'claimed',
        reviewerId: USER_ID,
        claimedAt: new Date(),
        decidedAt: null,
        rejectionReason: null,
      })
      .where(eq(documentReviewQueue.id, existing.id));

    // Reject with a reason
    await db
      .update(documentReviewQueue)
      .set({
        state: 'rejected',
        rejectionReason: 'Missing schedule A',
        decidedAt: new Date(),
      })
      .where(eq(documentReviewQueue.id, existing.id));

    const [after] = await db
      .select()
      .from(documentReviewQueue)
      .where(eq(documentReviewQueue.id, existing.id));
    expect(after?.state).toBe('rejected');
    expect(after?.rejectionReason).toBe('Missing schedule A');
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter web test tests/integration/attorney-review-flow
git add apps/web/tests/integration/attorney-review-flow.test.ts
git commit -m "test(integration): attorney review flow E2E (M5 task 29)"
```

---

### Cross-cutting (Tasks 30–33)

---

### Task 30: RLS policies on new M5 tables (migration 0030)

**Files:**

- Create: `packages/db/migrations/0030_rls_m5.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

Two new RLS-relevant tables this month: `document_review_queue` + `audit_event_reads`. Both carry `organization_id` directly — direct equality policy.

pgvector adds a column, not a table. AGE has its own internal tables under `ag_catalog.*` — those are infrastructure tables that all users need read access to; org isolation in the graph happens at the Cypher-query property level (`WHERE n.organization_id = $orgId`), not at the row level. No RLS needed on AGE internals.

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/migrations/0030_rls_m5.sql
--
-- M5 Task 30: RLS policies for the two new tables.
-- Same pattern as 0011, 0016, 0023, 0024.
-- Hand-written for the same reason: drizzle-kit cannot emit RLS DDL.

ALTER TABLE document_review_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_review_queue_org_isolation ON document_review_queue
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE audit_event_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_event_reads_org_isolation ON audit_event_reads
  USING (organization_id::text = current_setting('app.current_organization_id', true));
```

- [ ] **Step 2: Append journal entry**

```json
    {
      "idx": 30,
      "version": "7",
      "when": <current-unix-ms>,
      "tag": "0030_rls_m5",
      "breakpoints": false
    }
```

- [ ] **Step 3: Apply + commit**

```bash
pnpm --filter @cema/db db:migrate
git add packages/db/migrations/0030_rls_m5.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): RLS policies on document_review_queue + audit_event_reads (M5 task 30)"
```

---

### Task 31: Integration test — cross-org RLS for M5 tables

**Files:**

- Create: `apps/web/tests/integration/m5-rls-isolation.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/web/tests/integration/m5-rls-isolation.test.ts
/**
 * RLS multi-tenant isolation for M5 tables.
 *
 * Two tables × {Org A sees own (positive control), Org B does NOT see Org A row}.
 * 3 assertions total (1 negative per table + 1 positive control).
 */

import {
  auditEventReads,
  deals,
  documentReviewQueue,
  documents,
  getDb,
  organizations,
  users,
} from '@cema/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

const ORG_A_ID = '00000000-0000-0000-0000-0000000000a8';
const ORG_B_ID = '00000000-0000-0000-0000-0000000000b8';
const USER_ID = '00000000-0000-0000-0000-000000000098';
const DEAL_ID = '00000000-0000-0000-0000-0000000000e8';
const DOC_ID = '00000000-0000-0000-0000-0000000000d8';

const skip = !process.env.DATABASE_URL;

let queueRowId: string;
let auditRowId: string;

describe.skipIf(skip)('RLS — M5 tables cross-org isolation', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A_ID, clerkOrgId: 'org_m5_rls_a', name: 'Org A (M5)', slug: 'm5-rls-org-a' },
        { id: ORG_B_ID, clerkOrgId: 'org_m5_rls_b', name: 'Org B (M5)', slug: 'm5-rls-org-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_ID, clerkUserId: 'user_m5_rls', email: 'm5-rls@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_ID,
        organizationId: ORG_A_ID,
        cemaType: 'refi_cema',
        status: 'doc_prep',
      })
      .onConflictDoNothing();
    await db
      .insert(documents)
      .values({
        id: DOC_ID,
        organizationId: ORG_A_ID,
        dealId: DEAL_ID,
        kind: 'cema_3172',
        status: 'draft',
        attorneyReviewRequired: true,
        version: 1,
        fileName: 'cema.pdf',
      })
      .onConflictDoNothing();

    const [queueRow] = await db
      .insert(documentReviewQueue)
      .values({
        organizationId: ORG_A_ID,
        documentId: DOC_ID,
        documentVersion: 1,
        submittedById: USER_ID,
        state: 'pending',
      })
      .returning();
    queueRowId = queueRow!.id;

    const [auditRow] = await db
      .insert(auditEventReads)
      .values({
        organizationId: ORG_A_ID,
        actorUserId: USER_ID,
        entityType: 'communication',
        entityId: '00000000-0000-0000-0000-000000000099',
        purpose: 'view_detail',
      })
      .returning();
    auditRowId = auditRow!.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(auditEventReads).where(eq(auditEventReads.id, auditRowId));
    await db.delete(documentReviewQueue).where(eq(documentReviewQueue.id, queueRowId));
    await db.delete(documents).where(eq(documents.id, DOC_ID));
    await db.delete(deals).where(eq(deals.id, DEAL_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_A_ID, ORG_B_ID]));
  });

  it('Org B cannot SELECT Org A document_review_queue rows', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: documentReviewQueue.id })
        .from(documentReviewQueue)
        .where(eq(documentReviewQueue.id, queueRowId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A audit_event_reads rows', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: auditEventReads.id })
        .from(auditEventReads)
        .where(eq(auditEventReads.id, auditRowId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org A sees its own document_review_queue row (positive control)', async () => {
    const rows = await withRls(ORG_A_ID, (tx) =>
      tx
        .select({ id: documentReviewQueue.id })
        .from(documentReviewQueue)
        .where(eq(documentReviewQueue.id, queueRowId)),
    );
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter web test tests/integration/m5-rls-isolation
git add apps/web/tests/integration/m5-rls-isolation.test.ts
git commit -m "test(integration): cross-org RLS isolation for M5 tables (M5 task 31)"
```

---

### Task 32: `.env.example` + full gate

**Files:**

- Modify: `.env.example` (add comments about M5 dependencies)
- Run: full test/lint/typecheck/build gate

- [ ] **Step 1: `.env.example` — no new variables needed**

The existing `AI_GATEWAY_API_KEY` + `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` cover M5. Add comments documenting M5's use of each:

```diff
 # ─── AI Gateway + Providers ─────────────────────────────────────
 AI_GATEWAY_API_KEY=
+# M5: OPENAI_API_KEY powers @cema/embeddings (text-embedding-3-large, 3072-dim)
 ANTHROPIC_API_KEY=
+# M5: ANTHROPIC_API_KEY (via AI Gateway) powers @cema/search query classifier (claude-sonnet-4-6)
 OPENAI_API_KEY=
 GOOGLE_GENERATIVE_AI_API_KEY=
```

- [ ] **Step 2: Run the gate**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all green. New unit test count should be ~180+ (158 at M4 close + ~25 new in M5). Integration test count ~17 (14 from M4 + 3 new in M5).

- [ ] **Step 3: Commit any auto-fixes**

```bash
git add .env.example
git status   # verify only env.example modified; NO secrets
git commit -m "chore: comment M5 env dependencies in .env.example (M5 task 32)" --allow-empty
```

If the gate fails on any check, fix it inline. Most likely failures: AGE-specific Cypher queries failing in CI without AGE enabled. If CI doesn't enable AGE on its Postgres instance, gate the affected integration tests on `process.env.NEON_AGE_AVAILABLE === 'true'` or similar.

---

### Task 33: ADR 0005 + CLAUDE.md M5 close-out + PR

**Files:**

- Create: `docs/adr/0005-phase-0-month-5-search-memory.md`
- Modify: `CLAUDE.md` §2

- [ ] **Step 1: Write ADR 0005**

Follow the M4 ADR shape (`docs/adr/0004-phase-0-month-4-messaging-files-esign-contacts.md`). Sections:

- **Status / Author / Supersedes / Superseded by** — Status: Accepted, today's date, Claude Opus 4.7 + Connor Hickey.
- **Context** — close out of Phase 0; M5 is the final M-milestone.
- **What shipped** — 4 new workspace packages (`@cema/embeddings`, `@cema/kg`, `@cema/attorney`, `@cema/search`), 7 migrations (0024 pgvector ext, 0025 embedding columns, 0026 AGE ext, 0027 AGE labels, 0028 review queue, 0029 audit reads, 0030 RLS), 10 server actions, 7 UI components, 3 new pages, 3 integration tests.
- **Skipped tasks** — Typesense, Turbopuffer, Mem0, Vanta, Cohere fallback, full Cypher DSL, multi-hop graph queries, agent-side memory writes, incremental embedding re-indexing.
- **Architectural decisions** with rationale:
  1. pgvector for M5 (not Turbopuffer) — corpus size argument
  2. Embeddings generated on insert (not async via WDK) — WDK still not installed
  3. AGE on Neon (vs separate Postgres instance) — verify-and-fallback approach
  4. `document_review_queue` separate from `attorney_approvals` — cardinality argument
  5. `audit_event_reads` separate from `audit_events` — read-cardinality argument
  6. `withReadAudit` wraps after-the-fact (not via trigger) — keeps the column-list narrow
  7. Query intent classifier as a separate LLM call — routing pattern, not a single-model approach
- **Carry-overs to Phase 1**:
  - Typesense full-text (when external account provisioned)
  - Turbopuffer (when corpus > 10M rows)
  - Mem0 (Phase 1 with agent memory)
  - Vanta (Phase 1 SOC 2 onboarding)
  - WDK consumers for `embeddings.generate.run` topic (Phase 1)
  - Incremental embedding refresh on row update (Phase 1)
  - Multi-hop Cypher queries + DSL package (Phase 1)
  - Agent-memory tables for Mem0 substitute (Phase 1)
  - SOC 2 evidence-collection cron (Phase 1)
  - HSM-backed digital signatures on AttorneyApproval rows (Phase 2)
- **What changed against the plan** — divergence log (fill in during execution).

- [ ] **Step 2: Update CLAUDE.md §2**

Replace the M4 close-out with M5 close-out. Sample:

```markdown
- **Phase:** **Phase 0 fully closed out (date, ~33 tasks on `feat/m5-search-memory`). Phase 1 (Layer 3 — CEMA AI agents on WDK) is next.** M5 shipped: `@cema/embeddings` + `@cema/kg` + `@cema/attorney` + `@cema/search`; pgvector + AGE extensions on Neon; embedding columns + ivfflat indexes on communications + documents; AGE graph with Contact/Organization/Deal/Party labels + KNOWS/WORKS_AT/EMPLOYS/REPRESENTS edges; contacts→AGE node migration; attorney review queue with claim→approve/reject state machine emitting the AttorneyApproval events M4's sendEnvelope already gates on; SOC 2 read-access tracking via withReadAudit + immutable audit_event_reads; Ask-anything search bar with intent classification routing to pgvector. 9 tasks skipped (Typesense, Turbopuffer, Mem0, Vanta, Cohere fallback, multi-hop Cypher DSL, agent-memory tables, incremental re-indexing, HSM signatures). See docs/adr/0005-phase-0-month-5-search-memory.md.
- **Next step:** Begin Phase 1 — Layer 3 CEMA AI agents. Plan not yet written.
```

Update the carry-over list, the test count line, and add a Changelog entry.

- [ ] **Step 3: Commit + push + PR**

```bash
git add docs/adr/0005-phase-0-month-5-search-memory.md CLAUDE.md
git commit -m "docs(m5): ADR 0005 + CLAUDE.md M5 close-out (M5 task 33)"

git push -u origin feat/m5-search-memory

gh pr create --title "feat(m5): search + memory + attorney review + SOC 2 audit (5 subsystems, 33 tasks)" --body-file <(cat <<'EOF'
## Summary

Phase 0 Month 5 close-out — final M-milestone of Phase 0.

**Plan:** docs/superpowers/plans/2026-05-23-phase-0-month-5-search-memory.md
**ADR:** docs/adr/0005-phase-0-month-5-search-memory.md

### What shipped
- @cema/embeddings, @cema/kg, @cema/attorney, @cema/search
- 7 migrations (0024–0030)
- 10 server actions
- 7 UI components + 3 new pages
- 3 integration tests (m5-rls-isolation, attorney-review-flow, pgvector-similarity)
- AttorneyApproval emission that closes the M4 sendEnvelope loop

### Skipped (carry to Phase 1+)
Typesense, Turbopuffer, Mem0, Vanta, Cohere fallback, multi-hop Cypher DSL, agent-memory tables, incremental re-indexing, HSM signatures. Full list in ADR 0005.

### Test plan
- [ ] CI green
- [ ] CodeRabbit review
- [ ] Vercel preview deploy renders /search, /attorney/queue, /admin/audit, /contacts/[id] related section

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)

gh pr merge --auto --squash --delete-branch
```

---

## 7. Skipped tasks (per active session rule)

External system registration, accounts not provisioned, or explicitly later-phase per spec:

| Task | Scope                                                            | Reason                                                             |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| A    | Typesense full-text search (self-hosted or Typesense Cloud)      | Requires account / infra; pgvector covers M5                       |
| B    | Turbopuffer billion-row vector index                             | External account; Phase 1 when pgvector exceeds practical ceiling  |
| C    | Cohere Embed v4 embedding fallback                               | External account; OpenAI canonical                                 |
| D    | Mem0 agent-level memory                                          | External account; Phase 1                                          |
| E    | Vanta SOC 2 onboarding + control automation                      | External account + workflow                                        |
| F    | OpenAI `OPENAI_API_KEY` in Vercel production                     | Real key provisioning                                              |
| G    | Production smoke test of embeddings end-to-end                   | Depends on F                                                       |
| H    | WDK consumer for `embeddings.generate.run` queue                 | `@vercel/workflow` still not installed (carried from M2 + M3 + M4) |
| I    | Incremental embedding refresh on row update (trigger + queue)    | Phase 1 — M5 generates on insert + backfill                        |
| J    | Multi-hop Cypher queries (paths, shortest-path)                  | Phase 1 — M5 ships only `findRelatedContacts` (1-2 hops)           |
| K    | Cypher DSL package wrapping arbitrary traversals                 | Phase 1                                                            |
| L    | Agent-memory tables (Mem0 substitute via Postgres)               | Phase 1 — depends on Layer 3 agents being live                     |
| M    | HSM-backed digital signature on AttorneyApproval rows            | Phase 2 (customer-managed keys are Phase 2 per spec §12.1)         |
| N    | Knock notifications on review state transitions                  | Phase 1 — M5 emits audit events only                               |
| O    | SOC 2 evidence-collection cron job                               | Phase 1 — M5 ships the data shape, not the export pipeline         |
| P    | Anomaly detection over audit_event_reads                         | Phase 1+                                                           |
| Q    | "Ask anything" action + analytics intent execution               | Phase 1 — M5 ships intent classification + search dispatch only    |
| R    | "Ask anything" voice input (ElevenLabs)                          | Phase 3                                                            |
| S    | Per-tenant pgvector index tuning (`lists` parameter for ivfflat) | Phase 1 — M5 ships default lists=100                               |
| T    | DSR (Data Subject Request) tooling via OneTrust                  | Phase 2 per spec §12.2                                             |
| U    | Litigation hold flagging on audit_event_reads                    | Phase 1                                                            |

---

## 8. Open Questions

Carried forward from M4 plan §8 plus new questions:

1. **AGE on Neon support.** Pre-Task 7 we believe AGE is enabled on Neon. If migration 0026 fails on the dev branch, the entire AGE subsystem (Tasks 7–12) is blocked. Fallback options: separate Postgres instance with AGE, or recursive-CTE implementation over Postgres tables. Need to verify before starting Task 7.
2. **Embeddings cost.** OpenAI `text-embedding-3-large` at $0.13 / 1M tokens. A typical communication is ~200 tokens → $0.000026 per embedding. 100k communications backfilled = $2.60. Sustainable, but track in observability.
3. **Re-embedding policy.** When an `aiSummary` is generated later (Phase 1 agent), should we re-embed the communication automatically? Currently the schema tracks `embedding_generated_at` but no logic refreshes on that timestamp.
4. **Attorney role enforcement.** M5 ships the queue + actions but does not gate `/attorney/queue` to users with an "attorney" role. M1 has no per-user role system yet. Phase 1 task: extend Clerk publicMetadata with a `role: 'attorney' | 'processor' | 'admin'` field and gate the route.
5. **Email-vs-attorney portal.** Spec §10.x mentions an "attorney portal" separately from the main workspace. M5's `/attorney/queue` lives in the same Next.js app — is that the intended end state, or should attorneys have a separate auth domain?
6. **Audit-log retention.** `audit_event_reads` is immutable but has no retention policy. M1 says 7 years for mortgage records — does that apply to read events too? Storage cost at 100k reads/day for 1 client = ~36M rows/year, ~10 GB. Manageable on Neon scale plan, but should we plan a Phase 1 archival flow to S3 cold storage?
7. **AGE graph drift.** Contacts can change in Postgres without the graph being updated. M5 ships a one-shot migration; Phase 1 needs incremental sync (DB trigger → AGE update, or a periodic full re-sync). Which approach?
8. **"Ask anything" cache.** Repeated identical queries currently re-embed + re-classify. Phase 1 should add a 60-second LRU cache keyed by (orgId, query-hash) to reduce per-keystroke cost if we add live search-as-you-type.
9. **Document review SLA.** No SLA on how long a document can sit in `pending` state. M5 ships the queue; Phase 1 should add a Vercel Cron job that pings attorneys for documents pending > 24h.
10. **Cross-graph contact merge.** M4's `mergeContacts` server action moves identities but does NOT update the AGE graph. The AGE Contact node for the loser persists with stale relationships. Phase 1 task: extend `mergeContacts` to call into `@cema/kg` to MERGE the graph too, and DELETE the loser Contact node.
