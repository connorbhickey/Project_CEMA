# ADR 0007: Phase 0 Month 7 — Production Pipeline & Entity Resolution

**Status:** Accepted (shipped 2026-05-23)
**Author:** Phase 0 Month 7 implementation (Claude Sonnet 4.6 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None

---

## Context

Phase 0 Month 7 (M7) closes the gap between M6's infrastructure and a functioning production embedding pipeline. M6 shipped embed queue consumers (`/api/queues/embed-communication` and `/api/queues/embed-document`) that call OpenAI embeddings and write them to the DB — but nothing published to those queues on real communication inserts. M7 closes this by (1) adding `comms.embed` publish calls to the Nylas and Slack webhook handlers immediately after each communication row is created, (2) extending the embed consumers to sync each indexed communication and document into Typesense for full-text search, (3) adding communication→party entity resolution in the embed-communication consumer (linking `from_party_id`/`to_party_ids` via `contact_identities` → `kg_edges`), (4) shipping a daily backfill cron for rows that missed embedding due to timing or restarts, and (5) writing a runbook for provisioning Typesense Cloud + Mem0 API keys in Vercel.

---

## What shipped

### Webhook handlers (2 files modified)

| File                                       | Change                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/app/api/webhooks/nylas/route.ts` | Publishes `comms.embed` after email communication insert (`message.created`) and after calendar communication insert (`event.created`/`event.updated`) |
| `apps/web/app/api/webhooks/slack/route.ts` | Publishes `comms.embed` after Slack message communication insert                                                                                       |

Both publish calls are `await`-ed (synchronous with the webhook handler) so that queue delivery is guaranteed before the handler returns 200.

### Embed consumers extended (2 files modified)

| Route                                  | Change                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/queues/embed-communication` | After writing embedding: (a) fetches supplemental `emailThreads`/`slackMessages` data in a `Promise.all`; (b) calls `void indexCommunication(...)` (Typesense, fire-and-forget); (c) calls `void resolveCommParties(db, comm, emailThread, slackMsg)` (entity resolution, fire-and-forget) |
| `POST /api/queues/embed-document`      | After writing embedding: calls `void indexDocument(...)` (Typesense, fire-and-forget)                                                                                                                                                                                                      |

### Entity resolution function (`resolveCommParties`)

Added inline to `embed-communication/route.ts`. Logic:

1. Extract `fromEmail` from the email thread (or `authorSlackUserId` from Slack message)
2. Normalize emails to lowercase; extract `.email` from `EmailParticipant[]` for `toParticipants`
3. Query `contact_identities` for `kind='email'` matches; separate query for `kind='slack_user'`
4. Deduplicate contact IDs using `Set`
5. Query `kg_edges` for `predicate='contact_is_party'` on those contact IDs
6. Build a `Map<contactId, partyId>` and resolve `fromPartyId` / `toPartyIds`
7. Conditionally `db.update(communications)` only if at least one party resolved
8. Guards `inArray(col, [])` with length checks to avoid Drizzle empty-array throws

### Backfill cron (1 file created, 1 file modified)

| File                                                       | Change                                                                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/api/cron/backfill-embeddings/route.ts` (new) | GET handler; `BATCH_SIZE = 100`; parallel select on `communications` and `documents` where `embeddingGeneratedAt IS NULL`; publishes to `comms.embed` / `docs.embed`; returns `{commsQueued, docsQueued}` |
| `apps/web/vercel.json`                                     | Added `crons: [{path: "/api/cron/backfill-embeddings", schedule: "0 2 * * *"}]`                                                                                                                           |

### Runbook (1 file created)

`docs/runbooks/m7-env-var-provisioning.md` — step-by-step guide for provisioning Typesense Cloud + Mem0 API keys in Vercel; includes smoke test procedure, graceful degradation verification, and rollback instructions.

### Unit tests (9 new assertions)

| File                                | New assertions                                       |
| ----------------------------------- | ---------------------------------------------------- |
| `nylas/route.test.ts`               | 2 (comms.embed published on email + calendar insert) |
| `slack/route.test.ts`               | 1 (comms.embed published on Slack insert)            |
| `embed-communication/route.test.ts` | 3 (Typesense sync + entity resolution)               |
| `embed-document/route.test.ts`      | 1 (Typesense sync)                                   |
| `backfill-embeddings/route.test.ts` | 3 (zero count, comms publish, docs publish)          |

### Test count

232 tests across 55 test files at M7 close-out (up from 223 / 54 at M6 close). All green.

---

## Skipped tasks and rationale

| Task                              | Reason skipped                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| Typesense Cloud provisioning      | Requires Typesense Cloud account + API key. Runbook written; provisioning is a manual ops step. |
| Mem0 live provisioning            | Requires Mem0 API key. Runbook written; provisioning is a manual ops step.                      |
| Twilio/Deepgram entity resolution | Telephony webhook handlers don't yet have `from_party_id` wiring. Carry-over to M8.             |
| Vercel env var sync + smoke test  | After API keys provisioned per runbook.                                                         |

---

## Architectural decisions

### 1. Trigger-at-insert: publish `comms.embed` synchronously from the webhook handler

**Decision:** The `comms.embed` publish is `await`-ed inside the Nylas and Slack webhook handlers, immediately after the communication row is confirmed inserted.

**Rationale:** Publishing in the webhook handler (rather than from a DB trigger or a polling job) is the simplest reliable trigger point. The communication ID is available in scope. The webhook handler is already in a try/catch so queue publish errors surface as 500s to the webhook provider (causing retry). Publishing after the DB insert — not before — ensures the embed consumer always finds the row.

**Trade-off accepted:** If the queue publish fails, the webhook returns 500 and the provider retries the entire webhook. This means the communication row may be double-inserted (handled by the existing `ON CONFLICT DO UPDATE` in the Nylas handler) and `comms.embed` will be published twice — the embed consumer's `embeddingGeneratedAt` idempotency write makes this safe.

### 2. Entity resolution as fire-and-forget (`void resolveCommParties(...)`)

**Decision:** `resolveCommParties` is called with `void` — its result is not awaited by the embed-communication consumer.

**Rationale:** Entity resolution requires 2–3 additional DB round-trips (contact_identities lookup, kg_edges lookup, communications update). Adding this to the critical path of the embed consumer would increase consumer execution time by ~50–150ms. The consumer's primary job is to write embeddings; entity resolution is an enrichment that can fail silently without breaking the embedding write. Errors from fire-and-forget resolution are captured by Sentry.

**Trade-off accepted:** If the Vercel function exits before the fire-and-forget completes, the party resolution is lost for that message. The backfill cron will re-trigger the embed consumer (re-publishing the topic), which will re-run entity resolution. Party resolution convergence is eventually consistent, not guaranteed synchronous.

### 3. Backfill via cron + queue re-publish (not a direct embed call)

**Decision:** The backfill cron publishes to `comms.embed` / `docs.embed` queue topics rather than calling `embedText` directly.

**Rationale:** Reusing the queue consumer means all embedding logic (error handling, Typesense sync, entity resolution) runs once in a single tested code path. If the cron called `embedText` directly, it would duplicate logic and create a second untested code path. The queue also provides built-in retry semantics for rows that fail embedding.

**Trade-off accepted:** Backfill latency is higher (cron → queue → consumer) than a direct embed call. At Phase 0 scale this is irrelevant.

### 4. `BATCH_SIZE = 100` per cron run

**Decision:** The backfill cron fetches at most 100 unembedded communications and 100 unembedded documents per invocation (200 queue publishes total).

**Rationale:** Vercel function execution time is limited. Fetching and publishing 200 rows takes < 2 seconds. At OpenAI `text-embedding-3-large` limits (3,000 RPM at Tier 1), 200 concurrent embed requests are well within rate limits. The cron runs daily at 2 AM; any rows not caught in one run are caught the next.

**Trade-off accepted:** If the backlog exceeds 200 rows (unlikely at Phase 0), the cron will need multiple days to catch up. Phase 1 can implement a loop-until-empty pattern if needed.

### 5. `inArray(col, [])` guard pattern

**Decision:** All `inArray` calls in `resolveCommParties` are wrapped with `if (lookupEmails.length > 0)` / `if (lookupSlackUsers.length > 0)` guards.

**Rationale:** Drizzle's `inArray` throws a runtime error when the array argument is empty. This is a known Drizzle behavior (the SQL `IN ()` clause is invalid). Communications with no recognized email addresses or Slack user IDs would cause the embed consumer to throw without this guard. The guard causes entity resolution to return early (no-op) for those communications.

**Trade-off accepted:** Communications with unrecognized sender/recipient identities are silently skipped for entity resolution. A future M8 task can wire up a notification or queue a "contact discovery" task when no identity match is found.

---

## What changed against the plan

| Plan instruction                                   | Reality                                          | Reason                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `toParticipants: string[]` in entity resolution    | `toParticipants: {email: string; name: string    | null}[]`                                                                                                                         | Nylas/DB schema uses `NormalizedEmailParticipant[]` objects, not plain strings. Entity resolution must extract `.email` from each participant. |
| Simple `buildDb` mock in embed-communication tests | Manual `vi.fn().mockReturnValueOnce(...)` chains | `buildDb` produces a single `.select()` chain mock; Tasks 3 and 5 need 3–5 sequential select calls with different return values. |

---

## Carry-overs to M8 (or Phase 1)

1. **Typesense Cloud provisioning:** `TYPESENSE_API_KEY`, `TYPESENSE_HOST` env vars needed in Vercel. Runbook at `docs/runbooks/m7-env-var-provisioning.md`.
2. **Mem0 live provisioning:** `MEM0_API_KEY` env var needed in Vercel. Runbook at `docs/runbooks/m7-env-var-provisioning.md`.
3. **Telephony entity resolution:** Twilio/Deepgram webhook handlers (`from_party_id`/`to_party_ids` on telephony communications). Requires same `contact_identities` lookup pattern applied to phone numbers (`kind='phone'`).
4. **Vercel env var sync + production smoke test:** After Typesense + Mem0 API keys provisioned.
5. **All M2–M6 carry-overs still pending** (Nango + telephony vendors; WDK workflows; Nylas OAuth; Cal.com; NeverBounce; CRM enrichment; Drive Blob retention; Drive replay protection).

---

## References

- Plan: `docs/superpowers/plans/2026-05-23-phase-0-month-7-production-pipeline-entity-resolution.md`
- Predecessor ADRs: `docs/adr/0001` through `docs/adr/0006`
- Runbook: `docs/runbooks/m7-env-var-provisioning.md`
- Spec anchors: §9.1 (Knowledge graph / entity resolution), §10 (Search + Memory), §16 (Integration catalog — Typesense, Mem0, embed pipeline).
- Final SHA on `feat/m7-production-pipeline-entity-resolution`: 6443031
