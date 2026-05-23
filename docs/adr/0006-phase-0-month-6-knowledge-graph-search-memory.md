# ADR 0006: Phase 0 Month 6 — Knowledge Graph, Typesense, Embedding Consumers, and Mem0

**Status:** Accepted (shipped 2026-05-23)
**Author:** Phase 0 Month 6 implementation (Claude Sonnet 4.6 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None

---

## Context

Phase 0 Month 6 (M6) delivered five subsystems deferred from M5: (1) a knowledge graph linking contacts ↔ parties ↔ deals, (2) a Typesense full-text search client wired into the `askAnything` dispatcher, (3) background queue consumers that call OpenAI embeddings on communication and document inserts, (4) pgvector HNSW indexes for ANN query acceleration, and (5) a Mem0 agent memory wrapper integrated into `askAnything` for per-deal context recall.

Apache AGE — the graph database extension originally called for in the spec — was skipped again. AGE requires a Neon-side extension installation that is not self-service; instead M6 ships a pure-Postgres `kg_edges` adjacency table that covers the same traversal queries without the AGE dependency. Both Typesense and Mem0 are wired and tested but require API keys to activate in production; they are guarded by `isTypesenseConfigured()` and `isMemoryConfigured()` env-gates so the dev loop works without provisioning either service.

---

## What shipped

### New workspace packages (3)

| Package           | Contents                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cema/kg`        | `kg_edges` adjacency table queries: `addEdge`, `removeEdge`, `findNeighbors`, `traverse`. Pure-Postgres — no Apache AGE dependency. Includes `resolvePartyFromContact` which walks `contact_is_party → party_is_on_deal`. |
| `@cema/typesense` | Lazy singleton Typesense client; `isTypesenseConfigured()` env-gate; `searchTypesense()` using `Promise.allSettled` over two collections; `indexCommunication`, `indexDocument`, `deleteFromIndex` sync helpers.          |
| `@cema/memory`    | Mem0 `MemoryClient` wrapper; `isMemoryConfigured()` env-gate; `addMemory`, `searchMemory`, `clearSessionMemory`. Uses `user_id=dealId` and `run_id=sessionId` (Mem0 snake_case API).                                      |

### Database (2 migrations, 0029–0030)

| Migration                | Contents                                                                                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0029_kg_edges.sql`      | `kg_edges` table: `organizationId`, `subjectId`, `subjectType`, `predicate`, `objectId`, `objectType`, `createdAt`, `createdBy`. Composite unique on `(organizationId, subjectId, predicate, objectId)`. RLS policy. |
| `0030_pgvector_hnsw.sql` | `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)` on both `communications.embedding` and `documents.embedding`.                                                        |

### Queue consumers (apps/web)

| Route                                  | Purpose                                                                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/queues/embed-communication` | Parses `comms.embed` topic; fetches communication row; builds embed text from `aiSummary + sourceThreadId + kind`; calls `embedText`; writes back `embedding` + `embeddingGeneratedAt`. |
| `POST /api/queues/embed-document`      | Parses `docs.embed` topic; JOINs `documents + deals` to verify org ownership; builds embed text from `kind + JSON.stringify(extractedData)`; writes embedding.                          |

### Application surfaces (apps/web)

**Server actions (2 new):**

| Action               | Purpose                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `linkContactToParty` | Creates two `kg_edges` rows: `contact_is_party` and `party_is_on_deal`. Returns `{ edgesCreated, contactId, partyId, dealId }`. |
| `getDealGraph`       | Returns all `kg_edges` within a deal's org scoped by `organizationId`; used by the graph page for visualization.                |

**Updated server action (1):**

`askAnything` extended with: (a) Mem0 memory recall prepended to `memoryContext[]` when `dealId` is provided and memory is configured; (b) Typesense full-text hits merged after pgvector hits (deduplicated by ID, adapted via `adaptTypesenseHit`); (c) fire-and-forget `addMemory` after a search hit when both `dealId` and `sessionId` are provided.

**New page (1):**

`/deals/[id]/graph` — knowledge graph visualization page using `getDealGraph` server action.

### Vercel Queues topics (2 new)

`comms.embed` and `docs.embed` added to `@cema/queues` `TopicSchema` and to `.env.example`.

### Unit tests (6 new files, 21 new assertions)

| File                                                       | Assertions |
| ---------------------------------------------------------- | ---------- |
| `@cema/kg` unit tests                                      | 6          |
| `@cema/typesense` search tests                             | 4          |
| `@cema/memory` unit tests                                  | 4          |
| `embed-communication/route.test.ts`                        | 3          |
| `embed-document/route.test.ts`                             | 3          |
| `get-deal-graph.test.ts` + `link-contact-to-party.test.ts` | updated    |

### Test count

223 tests across 54 test files at M6 close-out (up from 202 / 48 at M5 close). All green.

---

## Skipped tasks and rationale

| Task                                   | Reason skipped                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Apache AGE extension                   | Requires Neon-side installation not available via self-service. Replaced by `kg_edges` pure-Postgres adjacency table. |
| Typesense live cluster provisioning    | Requires Typesense Cloud account + API key. Client is wired; `isTypesenseConfigured()` gates all calls.               |
| Mem0 live provisioning                 | Requires Mem0 API key. Client is wired; `isMemoryConfigured()` gates all calls.                                       |
| Production embedding pipeline          | Deferred until Typesense provisioned (ordering matters for full-text + vector hybrid query path).                     |
| Vercel env var sync + production smoke | After API keys provisioned.                                                                                           |

---

## Architectural decisions

### 1. Pure-Postgres `kg_edges` adjacency table instead of Apache AGE

**Decision:** The knowledge graph is implemented as a `kg_edges` relational table with `(subjectId, subjectType, predicate, objectId, objectType)` columns. Graph traversal is done with recursive CTEs or iterative `findNeighbors` calls. Apache AGE is not used.

**Rationale:** AGE requires `CREATE EXTENSION apache_age` on the Postgres instance. Neon does not ship AGE as a self-service extension (it requires a custom Neon plan or manual provisioning). The Phase 0 graph query requirements — find all parties on a deal from a contact, walk 2–3 hops max — are satisfiable with standard SQL recursive CTEs on a normalized adjacency table. AGE's Cypher query language is powerful for complex graph analytics but is overkill for the 3-node-type, 2-predicate graph in Phase 0. A relational adjacency table also benefits from Postgres RLS policies natively, while AGE graph queries bypass RLS.

**Trade-off accepted:** Cypher query expressiveness is lost. If Phase 2 requires complex multi-hop graph analytics (e.g., "find all lenders in a servicer's network"), migrating from a relational adjacency table to a dedicated graph store will require a data migration. The CEMA domain is small enough (< 10 edge types, < 1M edges per org at Phase 0 scale) that relational traversal is not a performance concern.

### 2. `TypesenseHit` adapter pattern to avoid circular imports

**Decision:** `@cema/typesense` exports `TypesenseHit { kind, id, textMatchScore }`. The `adaptTypesenseHit` function in `apps/web/lib/actions/ask-anything.ts` converts a `TypesenseHit` to a `SearchHit { kind, id, cosineDistance: 0.5, similarity: 0.5, preview: '(full-text match)' }` with placeholder vector scores.

**Rationale:** `SearchHit` is defined in `apps/web/lib/actions/search-similar.ts` (an app-layer file). If `@cema/typesense` imported `SearchHit` from the app, it would create a package → app dependency inversion (packages cannot import from apps in a Turborepo monorepo without restructuring the build graph). The adapter lives in the app layer where both types are available without circular dependencies.

**Trade-off accepted:** The placeholder `cosineDistance: 0.5, similarity: 0.5` values are semantically meaningless — they are only used by the `SearchResults` UI component which sorts by score. Typesense hits are always appended after pgvector hits, so their relative rank among Typesense results is determined by `textMatchScore` (applied inside `searchTypesense`) before they reach the adapter. The placeholder values do not affect result ordering.

### 3. `isTypesenseConfigured()` and `isMemoryConfigured()` env-gates

**Decision:** Both `@cema/typesense` and `@cema/memory` export an `isXxxConfigured()` predicate that checks for the presence of the required env var (`TYPESENSE_API_KEY` / `MEM0_API_KEY`). All callers guard with `if (isXxxConfigured())` before any client call. If unconfigured, all operations are silent no-ops.

**Rationale:** Phase 0 runs on a dev Neon branch without Typesense Cloud or Mem0 accounts. Hard-failing when the env var is absent would break the dev loop for every developer (and CI) that hasn't provisioned these services. The gate pattern lets the codebase ship and test without requiring all external services to be live. This matches the existing `@cema/embeddings` pattern and is consistent with the spec §20.4 "graceful degradation" principle.

**Trade-off accepted:** Silently skipping Typesense / Mem0 in production if the key is not set could cause confusing behavior (search results appear but have no full-text component, memory context is absent). The Vercel env var provisioning task (carry-over #5) must be completed before production launch.

### 4. pgvector-first merge strategy

**Decision:** `searchSimilar` (pgvector cosine) always runs first. Typesense hits are fetched in parallel only if `isTypesenseConfigured()`. The merge strategy: filter out Typesense hits whose `id` already appears in pgvector results, then append the remainder up to `k` total.

**Rationale:** pgvector results have semantic ranking (cosine distance). Typesense results have keyword ranking (BM25 / `textMatchScore`). Preserving pgvector ordering for the top results and appending Typesense-only hits at the end gives the user semantic-first, keyword-supplemented results. The alternative — interleaving by normalized score — would require normalizing two incomparable scoring functions, which is complex and brittle.

**Trade-off accepted:** A document that scores highly in Typesense but not in pgvector (e.g., an exact keyword match that isn't semantically similar to the query) will always appear below the pgvector results, even if it is the most relevant result for that query. Phase 1 can implement reciprocal rank fusion if this becomes a UX issue.

### 5. Fire-and-forget `void addMemory(...)` — memory writes don't block search

**Decision:** After a search hit, `askAnything` calls `void addMemory(dealId, query, sessionId)` without awaiting the result. The function returns the search response to the caller immediately.

**Rationale:** Mem0 `client.add()` involves a network round-trip to the Mem0 API and internal vector indexing. Adding this to the critical path of the search response would add ~200–500ms of latency on every search. Search latency is a primary UX concern; memory persistence is a background enrichment. If `addMemory` fails, the user loses future memory context for this query — an acceptable loss that does not affect the current response. Errors from the fire-and-forget are captured by Sentry via the unhandled promise rejection handler.

**Trade-off accepted:** If the process exits before the fire-and-forget completes (e.g., Vercel function timeout), the memory write is lost silently. For Phase 0 scale this is acceptable. Phase 1 can move memory writes to a background queue topic.

### 6. HNSW index without `CONCURRENTLY` — no migration isolation needed

**Decision:** Migration `0030_pgvector_hnsw.sql` uses `CREATE INDEX IF NOT EXISTS ... USING hnsw (...)` without `CONCURRENTLY`.

**Rationale:** `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block. Drizzle migrations are applied in a transaction. At Phase 0 data volumes (zero production embedding data), a regular `CREATE INDEX` completes in milliseconds and does not cause table lock contention. `CONCURRENTLY` is appropriate for production tables with live write traffic — that concern belongs in a Phase 1 migration run via a manual SQL statement outside the migration framework.

**Trade-off accepted:** The index creation takes an `AccessShareLock` on the table (blocking writes briefly). At Phase 0 scale with no production data, this is a non-issue.

### 7. drizzle-orm dual-resolution via `pnpm install --force`

**Decision:** After installing `mem0ai`, the monorepo had three distinct `drizzle-orm@0.45.2` installations in `.pnpm/`. TypeScript treated `SQL<unknown>` from each installation as incompatible types, causing typecheck failures in `@cema/memory` and the app. Fixed with `pnpm install --force` to evict stale virtual store entries.

**Rationale:** `mem0ai` declares optional peer dependencies (`better-sqlite3`, `pg`, `@cloudflare/workers-types`) that are also optional peer deps of `drizzle-orm`. When pnpm resolves these, it can create multiple drizzle-orm hoisting paths. `--force` forces a clean resolution pass and collapses back to a single installation. Root-level `pnpm.overrides` could pin the version permanently, but was not needed here since `--force` produced a clean tree.

**Trade-off accepted:** `pnpm install --force` is a blunt instrument — it re-resolves all dependencies, not just the conflicting ones. It is safe in this repo since all dependencies are pinned with `^` ranges and the lockfile is regenerated deterministically.

---

## What changed against the plan

| Plan instruction                                          | Reality                                             | Reason                                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Apache AGE graph extension                                | Pure-Postgres `kg_edges` adjacency table            | AGE not available on Neon self-service; relational adjacency table covers all Phase 0 traversal requirements.      |
| `makeDb` helper in embed-communication route.test.ts      | `buildDb` called directly; `makeDb` wrapper removed | `Partial<ReturnType<typeof buildDb>>` is the return shape (Mocks), not the arg shape (raw values) — caused TS2559. |
| `getCurrentUser()` assumed non-null in linkContactToParty | `if (!clerkUser) throw new Error(...)` guard added  | TypeScript strict null check: `getCurrentUser()` return type is `User \| null`.                                    |
| Mem0 camelCase API (`userId`, `runId`)                    | Snake_case API (`user_id`, `run_id`)                | Mem0 `MemoryClient` TypeScript types use snake_case; typecheck caught the mismatch.                                |

---

## Carry-overs to M7 (or Phase 1)

1. **Apache AGE knowledge graph (full Cypher path):** `kg_edges` replaces AGE for Phase 0; AGE carry-over is effectively resolved for this phase.
2. **Typesense live cluster provisioning:** `TYPESENSE_API_KEY`, `TYPESENSE_HOST` env vars needed in Vercel. `isTypesenseConfigured()` gates all calls until then.
3. **Mem0 live provisioning:** `MEM0_API_KEY` env var needed in Vercel. `isMemoryConfigured()` gates all calls until then.
4. **Production embedding pipeline:** Embed queue consumers are deployed but require embeddings to be triggered (either by publishing to `comms.embed` / `docs.embed` topics or by a backfill job). Deferred until Typesense is live.
5. **Vercel env var sync + production smoke test:** After API keys provisioned for Typesense and Mem0.
6. **All M2–M5 carry-overs still pending** (Nango + telephony vendors; WDK workflows; Nylas OAuth; Cal.com; NeverBounce; CRM enrichment; Drive Blob retention; Drive replay protection; AGE full Cypher analytics).

---

## References

- Plan: `docs/superpowers/plans/2026-05-23-phase-0-month-6-knowledge-graph-search-memory.md`
- Predecessor ADRs: `docs/adr/0001` through `docs/adr/0005`
- Spec anchors: §9.1 (Knowledge graph), §10 (Search + Memory), §16 (Integration catalog — Typesense, Mem0).
- Task 14 final SHA on `feat/m6-knowledge-graph-search-memory`: `dacc41e`.
