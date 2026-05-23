# ADR 0005: Phase 0 Month 5 — Search, Memory, and Attorney Review Workflow

**Status:** Accepted (shipped 2026-05-23)
**Author:** Phase 0 Month 5 implementation (Claude Sonnet 4.6 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None

---

## Context

Phase 0 Month 5 (M5) built five subsystems that spec §10 (Search), §13 (Memory), §6.2 (Attorney Review), and §12.3 (SOC 2 audit trails) require before the unified processor workspace can surface contextual deal intelligence and route documents through the mandatory attorney gate. The plan targeted five subsystems: pgvector embeddings, Apache AGE knowledge graph, attorney review state machine, SOC 2 audit-log enhancements, and an "Ask anything" AI search interface.

The scope decision acknowledged upfront that Apache AGE (tasks 7–12) would be skipped in M5: the extension requires a Neon-side installation that was not yet provisioned, and the KG use-cases (contact ↔ party ↔ deal graph walks) are not blocking any M5 deliverable. The remaining four subsystems produce self-contained surfaces — pgvector similarity search, the `document_review_queue` state machine, the `audit_event_reads` append-only read-audit log, and the `/search` + `/attorney/queue` + `/admin/audit` pages — that compose independently without the knowledge graph.

---

## What shipped

### New workspace packages (2)

| Package            | Contents                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@cema/embeddings` | OpenAI `text-embedding-3-large` (3072-dim) client wrapper; `embedText(text: string): Promise<number[]>`. Thin wrapper over the AI SDK. Model and dimensions are constants, not env-driven. |
| `@cema/search`     | Query intent classifier (Claude Sonnet 4.6 via AI SDK + Vercel AI Gateway); pgvector cosine-distance similarity search helper; Typesense client stub (placeholder, no live cluster).       |

### Database (5 migrations, 0024–0028)

| Migration                        | Contents                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0024_pgvector_extension.sql`    | `CREATE EXTENSION IF NOT EXISTS vector` on the Neon dev branch.                                                                                                                                                                                                                                                                             |
| `0025_embeddings_columns.sql`    | `embedding vector(3072)` on `communications` and `documents`; GIN trigram index for full-text fallback.                                                                                                                                                                                                                                     |
| `0026_document_review_queue.sql` | `document_review_queue` table: state machine columns (`state` enum `{pending,claimed,approved,rejected}`), `reviewerId`, `submittedById`, `organizationId`, `documentId`, `documentVersion`, `claimedAt`, `decidedAt`, `rejectionReason`. UNIQUE on `(documentId, documentVersion)`. CHECK constraint `decided_at_requires_terminal_state`. |
| `0027_audit_event_reads.sql`     | `audit_event_reads` append-only table: `organizationId`, `actorUserId`, `entityType`, `entityId`, `purpose`, `readAt`. BEFORE UPDATE/DELETE trigger `audit_event_reads_immutable` raises `P0001` on any mutation attempt.                                                                                                                   |
| `0028_rls_m5.sql`                | RLS policies for `document_review_queue` (direct `organization_id` equality) and `audit_event_reads` (direct `organization_id` equality). `attorney_approvals` policy also added here.                                                                                                                                                      |

### Application surfaces (apps/web)

**Server actions (6 new):**

| Action                | Purpose                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `submitForReview`     | Inserts a `document_review_queue` row in `pending` state. Validates `attorney_review_required = true` on the document.                 |
| `claimReview`         | Transitions `pending → claimed`; sets `reviewerId` to calling user; enforces `canTransition` from `@cema/attorney`.                    |
| `approveDocument`     | Transitions `claimed → approved`; inserts immutable `attorney_approvals` row; emits `document.approved` audit event.                   |
| `rejectDocument`      | Transitions `claimed → rejected`; records non-empty `rejectionReason`; enforces `canTransition` from `@cema/attorney`.                 |
| `listAuditEventReads` | Paginated query over `audit_event_reads` with optional `entityType` and `days` filters; hydrates actor name from a `users` join.       |
| `askAnything`         | Intent classifier (Claude Sonnet 4.6) routes natural-language query to `semantic_search` or `full_text_search`; returns `SearchHit[]`. |

**UI components (4 new):**

`ReviewQueueRow` (attorney queue list row with state badge), `ReviewDetailPanel` (Approve / Reject actions with reason textarea), `AuditEventRow` (12-col grid: when / actor / purpose / entity type / entity ID), `SearchResults` (renders `SearchHit[]` from `askAnything`).

**New pages (3):**

`/attorney/queue` (attorney review queue index), `/attorney/queue/[id]` (review detail with approve/reject flow), `/admin/audit` (SOC 2 read-audit log with entity + days filters).

**Updated pages (1):**

`/search` — now routes the query through `askAnything` classifier before rendering results; previously rendered a static placeholder.

### Unit tests (7 new files)

| File                              | Assertions |
| --------------------------------- | ---------- |
| `claim-review.test.ts`            | 4          |
| `approve-document.test.ts`        | 5          |
| `reject-document.test.ts`         | 4          |
| `list-audit-events-reads.test.ts` | 4          |
| `@cema/search` classifier tests   | 5          |
| `@cema/embeddings` unit tests     | 2          |
| `askAnything` action tests        | 3          |

### Integration tests (4 new files, all gated on `DATABASE_URL`)

| File                           | Assertions | Notes                                                                                    |
| ------------------------------ | ---------- | ---------------------------------------------------------------------------------------- |
| `audit-read-tracking.test.ts`  | 3          | Verifies `withReadAudit` inserts row on success and NOT on thrown error.                 |
| `pgvector-similarity.test.ts`  | 3          | Hand-crafted 3072-dim orthogonal vectors; verifies cosine ordering without OpenAI calls. |
| `attorney-review-flow.test.ts` | 2          | Full submit→claim→approve flow; verify `attorney_approvals` row exists.                  |
| `m5-rls-isolation.test.ts`     | 3          | Org B cannot SELECT Org A `document_review_queue` or `audit_event_reads` rows.           |

### Test count

202 tests across 48 test files at the M5 close-out (up from 158 / 35 at M4 close). All green.

---

## Skipped tasks and rationale

| Task group                              | Scope                                                                                      | Reason skipped                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Tasks 7–12 — Apache AGE knowledge graph | Graph schema, party/contact/deal vertex seeding, traversal queries, AGE-backed search path | AGE extension not yet installed on Neon; no blocking M5 deliverable depends on it. Carry-over to M6+.         |
| Typesense live cluster                  | Full-text search index, real-time sync, faceted search API                                 | Requires Typesense Cloud account; `@cema/search` stubs the client. Carry-over to M6.                          |
| Mem0 agent memory                       | Per-session + per-deal memory, memory retrieval on `askAnything`                           | Requires Mem0 API key and account provisioning. Carry-over to M6.                                             |
| Production embedding calls              | Live OpenAI embedding on communication/document insert                                     | Integration test uses hand-crafted vectors; production hook deferred until Typesense live (ordering matters). |

---

## Architectural decisions

### 1. `ReviewDecisionError` and `ReviewClaimError` extracted from `'use server'` modules

**Decision:** Error classes live in `apps/web/lib/actions/review-errors.ts`, a plain TypeScript module with no `'use server'` directive. The action files (`approve-document.ts`, `claim-review.ts`, `reject-document.ts`) import from this file.

**Rationale:** Next.js 16 with Turbopack enforces that `'use server'` modules export only async functions (Server Actions). When `ReviewDecisionError` was exported directly from `approve-document.ts`, Turbopack emitted `Export ReviewDecisionError doesn't exist in target module` at build time. The error class itself is not a Server Action, so it does not belong in a `'use server'` module. Moving it to a plain module restores correct typing and eliminates the build failure.

**Trade-off accepted:** One extra import in each action file. The separation is arguably cleaner — error types are a separate concern from the async action implementation.

### 2. `withReadAudit` inserts AFTER `fn()` resolves, not before

**Decision:** The `withReadAudit` middleware runs the wrapped function first, awaits its result, then inserts the `audit_event_reads` row. If `fn()` throws, no audit row is created.

**Rationale:** An audit row for a _read_ should record that the data was actually delivered to the caller. If `fn()` throws a database error or authorization error, the caller never received the data — recording a read audit in that case would be misleading. SOC 2 CC6.1 "logical access" controls require accurate records of who saw what, not records of who attempted to see what. The distinction matters: a failed read is a potential error worth logging to Sentry (which happens via the unhandled exception path), not an audit event.

**Trade-off accepted:** If the audit INSERT itself fails (e.g., Neon connection lost after the read succeeds), the data was delivered but the audit trail has a gap. This is the correct trade-off — denying reads because audit storage is down would be worse than a missing audit row. Sentry will capture the INSERT failure.

### 3. `sql\`NULL\`` pattern for Drizzle UPDATE explicit NULL

**Decision:** When an integration test needs to reset a `document_review_queue` row from `rejected` back to `claimed` (for test idempotency), it uses `decidedAt: sql\`NULL\``, `rejectionReason: sql\`NULL\``in the`.set()` call.

**Rationale:** Drizzle ORM's `.set()` may omit columns when the JS value is `null` for nullable columns (the behavior depends on the Drizzle version and column definition). The `document_review_queue_decided_at_requires_terminal_state` CHECK constraint requires `(decidedAt IS NULL) OR (state IN ('approved', 'rejected'))`. If `decidedAt` is not explicitly set to `NULL` when transitioning back to `claimed`, the constraint fires. `sql\`NULL\``forces the raw SQL`SET decided_at = NULL` regardless of Drizzle's null-elision behavior.

**Trade-off accepted:** Slightly less idiomatic Drizzle. This is a test-only pattern — the application code never needs to transition away from terminal states.

### 4. Integration test idempotency via `onConflictDoNothing` + re-fetch

**Decision:** All integration tests that insert into tables with immutability triggers (`attorney_approvals`, `audit_event_reads`) use `INSERT ... ON CONFLICT DO NOTHING` followed by a SELECT to fetch the actual row. Tests do not try to clean up immutable rows in `afterAll`.

**Rationale:** The immutability triggers on `attorney_approvals` and `audit_event_reads` raise `P0001` on any DELETE or UPDATE attempt. A test that inserts a row and then tries to delete it in `afterAll` will fail — and the failure propagates to block the cleanup of the parent tables (`documents`, `deals`, `organizations`) via FK CASCADE. The correct pattern is to make inserts idempotent (stable UUIDs + `ON CONFLICT DO NOTHING`) so that re-runs of the test suite don't accumulate conflicting state, and to leave immutable rows behind permanently.

**Trade-off accepted:** The test database accumulates `attorney_approvals` and `audit_event_reads` rows over time. Both tables use stable UUIDs so re-runs add at most one row per unique (documentId, documentVersion) per test file. This is acceptable for a dev Neon branch.

### 5. `document_review_queue` UNIQUE on `(documentId, documentVersion)`

**Decision:** A unique constraint `document_review_queue_doc_version_uidx` is defined on `(document_id, document_version)`.

**Rationale:** Each version of a document should have exactly one active review queue entry. If a document is revised (version bump), a new queue entry is created — the old one is terminal (`approved` or `rejected`). Allowing multiple `pending` entries for the same document version would create an ambiguous review race condition where two attorneys claim the same work. The unique constraint at the DB level enforces this invariant without relying on application-level checks.

**Trade-off accepted:** If a document version is somehow submitted twice (network retry on the `submitForReview` action), the second insert fails with a unique constraint violation rather than creating a duplicate. The action handles this with `ON CONFLICT DO NOTHING` and re-fetches the existing queue row.

### 6. askAnything classifier routes intent before hitting any search index

**Decision:** The `/search` page and the `askAnything` server action run the user's query through a Claude Sonnet 4.6 intent classifier first. The classifier returns `{ intent: 'semantic_search' | 'full_text_search', query }`. The action then dispatches to the appropriate search path.

**Rationale:** Full-text search (keyword match) and semantic search (cosine distance on embeddings) have complementary strengths. A query like "get me the Citibank payoff letter from last week" is a full-text retrieval task; "show me communications where the servicer seemed uncooperative" is a semantic similarity task. The classifier uses the spec §10 intent taxonomy to route before wasting embedding computation on keyword-intent queries, and before wasting Typesense latency on semantic-intent queries.

**Trade-off accepted:** The classifier adds one LLM round-trip (~200ms) before every search. For the Phase 0 user base (single-tenant, few concurrent users), this is acceptable. Phase 1 can add a fast intent cache (Upstash) keyed on a normalized query hash.

### 7. pgvector integration test uses hand-crafted vectors (no OpenAI call)

**Decision:** The `pgvector-similarity.test.ts` integration test constructs three deterministic 3072-dimensional vectors — VEC_A (unit vector along dim 0), VEC_A_NEAR (0.99 on dim 0, 0.01 on dim 1), and VEC_B (unit vector along dim 1) — using `new Array(3072).fill(0).map(...)`. It inserts these directly and asserts cosine ordering without calling the OpenAI API.

**Rationale:** An integration test that calls OpenAI would require network access in CI, incur API cost per run, and produce non-deterministic results if the model updates its embedding. The goal of the test is to verify that: (a) the `vector(3072)` column accepted the data, (b) the cosine distance operator `<=>` works on Neon, and (c) the ordering is correct. All three goals are achievable with deterministic synthetic vectors.

**Trade-off accepted:** The test does not verify that real OpenAI embeddings produce semantically meaningful results. That verification belongs in a Braintrust eval (Phase 1), not a unit/integration test.

---

## What changed against the plan

| Plan instruction                                            | Reality                                                                          | Reason                                                                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReviewDecisionError` / `ReviewClaimError` in action files  | Extracted to `review-errors.ts` (no `'use server'`)                              | Turbopack build constraint: `'use server'` modules can only export async functions.                                                                             |
| Integration test `afterAll` cleans up attorney_approvals    | `afterAll` only deletes `documentReviewQueue` rows; immutable tables left behind | `attorney_approvals` and `audit_event_reads` have BEFORE DELETE triggers that raise P0001; cleanup via FK cascade also blocked.                                 |
| `documents` insert includes `organizationId` and `fileName` | Fields removed from all integration test inserts                                 | `documents` schema has no `organizationId` column (org is via `dealId → deals.organizationId`) and no `fileName` column; plan had incorrect field names.        |
| `decidedAt: null` in Drizzle UPDATE resets column           | Changed to `decidedAt: sql\`NULL\``                                              | Drizzle `.set()` with JS `null` may elide the column; `sql\`NULL\``forces explicit`SET decided_at = NULL` required by the CHECK constraint.                     |
| `async () => value` mock implementations                    | Changed to `() => Promise.resolve(value)` in all test mocks                      | `@typescript-eslint/require-await` rule blocks `async` arrow functions with no `await` expression; `Promise.resolve()` is the idiomatic lint-clean alternative. |
| M5 RLS audit test tracks a specific audit row ID            | Uses `organizationId` filter instead of row ID                                   | `audit_event_reads` is append-only (new row per run); using org filter tests the RLS policy without needing to track an ephemeral row ID.                       |

---

## Carry-overs to M6 (or Phase 1)

1. **Apache AGE knowledge graph (Tasks 7–12):** Requires AGE extension on Neon. Graph schema (contact/party/deal vertices), traversal queries, AGE-backed search path. Target: M6 or Phase 1 start.
2. **Typesense live cluster:** Full-text index, real-time sync from `communications` + `documents`, faceted search. Requires Typesense Cloud account provisioning.
3. **Mem0 agent memory:** Per-session + per-deal memory persistence; retrieval integrated into `askAnything`. Requires Mem0 API key.
4. **Production embedding calls:** Live OpenAI embedding on `communications` / `documents` insert (background queue consumer). Deferred until Typesense live.
5. **pgvector HNSW index:** Once embedding data volume justifies it; currently a full scan (acceptable at Phase 0 scale).
6. **Vercel env var provisioning + production smoke test:** After `MEM0_API_KEY`, `TYPESENSE_API_KEY` provisioned.
7. **All M2–M4 carry-overs still pending** (Nango + telephony vendors; WDK workflows; Nylas OAuth; Cal.com; NeverBounce; AGE; CRM enrichment; Drive Blob retention; Drive replay protection).

---

## References

- Plan: `docs/superpowers/plans/2026-05-23-phase-0-month-5-search-memory.md` (embedded in task instructions)
- Predecessor ADRs: `docs/adr/0001` through `docs/adr/0004`
- Spec anchors: §10 (Search + Memory), §6.2 (Attorney Review state machine), §12.3 (SOC 2 audit log), §9.1 (Knowledge graph — AGE, deferred).
- Task 32 final SHA on `feat/m5-search-memory`: `0bb97be`.
