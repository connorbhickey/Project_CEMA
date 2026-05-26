# ADR 0009: Phase 0 Month 9 — Cache Hardening & Activity Feed

**Status:** Accepted (shipped 2026-05-24)
**Author:** Phase 0 Month 9 implementation (Claude Opus 4.7 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None

---

## Context

Phase 0 Month 9 (M9) closes the M2 security carry-overs (Upstash rate limiting, Twilio webhook idempotency, recording-retention cron) and ships the first major processor-workspace UX surface: a per-deal **activity feed** that unions communications and documents into a reverse-chronological timeline. It also introduces the `@cema/cache` workspace package, the eighteenth in the monorepo, which gives every package a single env-gated `getRedis()` / `isUpstashConfigured()` import path — the same shape as `@cema/typesense` and `@cema/memory`.

The cache work matters because every public-facing webhook endpoint (Twilio, Nylas, Slack, Drive, DocuSign, Deepgram) was previously unprotected against (a) inbound rate abuse and (b) duplicate vendor retries. Without rate limiting, a misconfigured caller could exhaust the Vercel function quota; without idempotency, Twilio's at-least-once recording-status callback would double-publish to `comms.embed`, leading to duplicate embeddings and a doubled OpenAI bill. Both behaviors degrade gracefully in dev (when Upstash is not provisioned) via the `isUpstashConfigured()` env-gate.

The activity feed matters because every prior milestone added entities (calls, emails, Slack messages, drive files, envelopes, documents) but no UI surface unified them. A processor working a deal needs one place to see "what happened on this deal, in what order" — not five separate tabs.

---

## What shipped

### New package (`@cema/cache`, 5 files, 6 tests)

| File                                   | Purpose                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/cache/package.json`          | `@cema/cache@0.0.0` private workspace package                                   |
| `packages/cache/tsconfig.json`         | Extends `@cema/config/tsconfig/node.json`                                       |
| `packages/cache/src/client.ts`         | `isUpstashConfigured()` env-gate, `getRedis()` singleton (lazy-init `Redis`)    |
| `packages/cache/src/ratelimit.ts`      | `makeWebhookLimiter()` (sliding window, 30 req / 10s), `checkRateLimit(ip)`     |
| `packages/cache/src/index.ts`          | Re-exports of all four symbols                                                  |
| `packages/cache/src/client.test.ts`    | 4 unit tests: env-gate true/false, getRedis throws when unset, returns instance |
| `packages/cache/src/ratelimit.test.ts` | 2 unit tests: limiter constructed, checkRateLimit returns success               |

### Webhook hardening (3 files modified)

| File                                             | Change                                                                                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/middleware.ts` (new)                   | Clerk `clerkMiddleware` for all non-public routes + env-gated Upstash `checkRateLimit` on `/api/webhooks/*` by `x-forwarded-for` IP; returns 429 on limit, fail-open on error |
| `apps/web/app/api/webhooks/twilio/route.ts`      | SETNX-based idempotency guard on `RecordingSid` (24-hour TTL); skipped when Upstash unconfigured; fail-open on Redis error                                                    |
| `apps/web/app/api/webhooks/twilio/route.test.ts` | 2 new assertions: idempotent return-200-without-publishing when key exists; normal publish when Upstash unconfigured                                                          |

### Recording retention cron (2 files created, 1 modified)

| File                                                            | Change                                                                                                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/api/cron/recording-retention/route.ts` (new)      | GET handler; `BATCH_SIZE=500`; soft-deletes `recordings` where `retention_until < now()` AND `legal_hold=false` AND `deleted_at IS NULL` |
| `apps/web/app/api/cron/recording-retention/route.test.ts` (new) | 3 unit tests: purges N expired, returns 0 when none expired, skips update call when nothing to purge                                     |
| `apps/web/vercel.json`                                          | Added cron entry: `{path: "/api/cron/recording-retention", schedule: "0 3 1 * *"}` (monthly at 03:00 UTC, 1st of month)                  |

### Activity feed (3 files created)

| File                                                    | Purpose                                                                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/queries/deal-activity.ts` (new)           | `getDealActivity(dealId)`: parallel select on `communications` (with `emailThreads` join for subject) + `documents`, merged + sorted desc by `occurredAt`, `LIMIT=200` per source |
| `apps/web/lib/queries/deal-activity.test.ts` (new)      | 3 unit tests: merged desc-order, empty deal, event shape contract                                                                                                                 |
| `apps/web/app/(app)/deals/[id]/activity/page.tsx` (new) | RSC page: vertical timeline with `date-fns` relative timestamps, empty-state copy, no client state                                                                                |

### Dependency additions

| Package              | Version   | Used by                                |
| -------------------- | --------- | -------------------------------------- |
| `@upstash/redis`     | `^1.34.0` | `@cema/cache` client singleton         |
| `@upstash/ratelimit` | `^2.0.0`  | `@cema/cache` sliding-window limiter   |
| `date-fns`           | `^4.3.0`  | activity-feed page relative timestamps |
| `@cema/cache`        | workspace | apps/web middleware + twilio webhook   |

### Test count

At M9 close-out: **472 tests passing across all packages** (apps/web: 240 passed + 2 skipped / 57 files; package tests sum: 232 across 38 files). Net additions in M9: +6 (`@cema/cache`), +3 (recording-retention), +3 (deal-activity), +2 (twilio idempotency).

---

## Skipped tasks and rationale

| Task                                         | Reason skipped                                                                                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apply rate limiting to non-Twilio webhooks   | The middleware applies to all `/api/webhooks/*` paths uniformly; no per-route opt-in needed. No skipped work, but worth calling out: the SETNX idempotency guard is currently Twilio-only. Extending it to Nylas, Slack, Drive, DocuSign, and Deepgram is M10 work. |
| `kg_edges` in activity feed                  | `kg_edges` schema has no `dealId` column — edges link contact↔party not deal↔X. Contact→party→deal traversal is Phase 1.                                                                                                                                            |
| Upstash provisioning + production smoke test | Requires Upstash account + env-var sync to Vercel. Until then, all guards no-op (rate limit skipped, idempotency skipped, retention still runs).                                                                                                                    |
| Vercel cron registration verification        | The `vercel.json` change is declarative; verification that the cron actually fires monthly requires a production deploy and a one-month wait, or manual GET on the route.                                                                                           |

---

## Architectural decisions

### 1. Env-gate pattern (`isUpstashConfigured()`) for graceful degradation

**Decision:** Every Upstash call site checks `isUpstashConfigured()` first and skips its work when the env-vars are absent — rate limiting becomes a no-op, idempotency becomes a no-op, and the cron still runs (since it doesn't depend on Redis at all).

**Rationale:** This mirrors `isTypesenseConfigured()` (M6) and `isMemoryConfigured()` (M6) — the convention the monorepo has settled on for optional managed services. Dev loops, CI, and PR previews don't need Upstash provisioned. Provisioning is a deliberate ops act (the runbook is the next milestone's first task), not an implicit dependency that breaks the dev experience.

**Trade-off accepted:** The exact same code paths behave differently in dev (Upstash off) vs prod (Upstash on). A bug in the production-only code path (e.g., a malformed SETNX TTL) won't be caught by `pnpm test` — it needs a production smoke test. We accept this in exchange for a frictionless dev loop.

### 2. Fail-open on Redis errors (rate-limit middleware + Twilio idempotency)

**Decision:** When `checkRateLimit` or the SETNX call throws (Redis down, network blip, malformed key), the handler **proceeds as if the call succeeded**. Errors are caught, logged, and swallowed; the webhook still publishes its message.

**Rationale:** A vendor webhook (Twilio, Nylas, Slack) retries on non-2xx responses. If Redis flakes for 30 seconds, fail-closing would cause every webhook in that window to retry — potentially queuing 100s of duplicate `comms.embed` jobs once Redis recovers. Fail-open keeps the primary data path running; the worst case is one duplicate embed (which the consumer's `embeddingGeneratedAt` write makes idempotent anyway).

**Trade-off accepted:** During a Redis outage, rate limiting is effectively disabled and idempotency is effectively disabled. Both are belt-and-suspenders protections — the real protection against abuse is Twilio's signature verification (which can't be bypassed by Redis going down), and the real protection against duplicate embeds is the consumer-side idempotency write.

### 3. SETNX with `nx: true, ex: 86400` for Twilio idempotency

**Decision:** The key `telephony:idempo:{RecordingSid}` is set with `nx: true` (only if not exists) and a 24-hour TTL. If `set()` returns `null`, the key already existed → already processed → return 200 without publishing.

**Rationale:** `RecordingSid` is the natural idempotency key for Twilio recording-status callbacks — it's unique per recording and stable across retries. A 24-hour TTL is well above Twilio's retry window (which is a few minutes) but bounded enough that the Redis key space doesn't grow forever. SETNX is atomic in Redis, so even concurrent webhook invocations for the same recording resolve correctly.

**Trade-off accepted:** A recording-status callback that arrives more than 24 hours after the original will be re-published. In practice this is impossible (Twilio gives up retrying after ~24 hours anyway), but worth noting for the post-mortem if it ever happens.

### 4. Recording retention via soft-delete + zero blob URLs (no `del()` call)

**Decision:** The cron sets `deleted_at = now()` and clears `recording_blob_url`, `recording_blob_pathname`, `transcript_blob_url`, `transcript_blob_pathname` on expired rows. It does **not** call Vercel Blob's `del()` to actually remove the binary.

**Rationale:** Soft-delete preserves the audit trail (which `audit_events` row caused the deletion is recorded by the cron's own audit emission) and lets us undo a wrongful deletion within the retention window. Actual binary cleanup is a separate Phase 1 job that scans `deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'` and calls `del()`. Decoupling the two means we never lose data due to a cron-config bug.

**Trade-off accepted:** Blob storage costs continue accruing for 30 days after soft-delete. At Phase 0 scale this is negligible. The actual blob cleanup is a known M10+ task.

### 5. Activity feed: TypeScript-side union, not SQL UNION

**Decision:** `getDealActivity` issues two parallel `db.select()` queries (comms, docs) inside `Promise.all`, then merges and sorts in JavaScript.

**Rationale:** The two source tables have different columns (communications has `kind`, `started_at`, joined `emailThreads.subject`; documents has `kind`, `created_at`, `blob_url`). A SQL `UNION ALL` would require aliasing every column on both sides, producing verbose Drizzle. The JS merge is 8 lines, the SQL would be 30+. Both `Promise.all` queries hit RLS-protected indices (`comm_deal_id`, `doc_deal_id`), so DB-side cost is identical.

**Trade-off accepted:** With `LIMIT=200` per source, the page renders at most 400 events. Long-running deals could exceed this. M10 can paginate by adding a cursor; for now the 200-row cap reflects what a processor can actually scan in one view.

### 6. `kg_edges` excluded from activity feed (for now)

**Decision:** Edges are skipped entirely; the implementation drops the planned third query.

**Rationale:** The `kg_edges` schema introduced in M6 links a contact to a party (e.g., "contact-123 is_party of borrower-456"). There is no direct `deal_id` column on edges — to attribute an edge to a deal, you'd traverse `kg_edges → parties → deals`. That's a 3-table join that returns very low-signal events ("contact linked to party") relative to the cost. Phase 1 (or M10) can add a `deal_id` to `kg_edges` for direct queryability if processors miss the surface.

**Trade-off accepted:** "Contact linked to party" events don't appear in the timeline. The decision is reversible — adding the column + back-populating it from the `parties` table is a single migration.

---

## What changed against the plan

| Plan instruction                                                | Reality                                                                                                  | Reason                                                                                                                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subject: documents.filename` in activity query                 | `subject: documents.blobUrl`                                                                             | The `documents` schema has `blob_url` not `filename` — `filename` doesn't exist as a column. Use blobUrl as the detail field                                           |
| Activity feed test uses `expect.any(String)` in `toMatchObject` | Split into per-property asserts: `typeof event?.label === 'string'`, `event?.occurredAt instanceof Date` | `@typescript-eslint/no-unsafe-assignment` flags `expect.any(String)` as `any` when nested in object literals. Per-property asserts are both typesafe and more explicit |
| Plan suggested `BATCH_SIZE=500` for retention cron              | Same — kept at 500                                                                                       | No change; documented here for traceability                                                                                                                            |
| Plan suggested Edge runtime middleware                          | Used standard middleware (no explicit `runtime: 'edge'` directive)                                       | Clerk's `clerkMiddleware` defaults to edge already; no need to set explicitly                                                                                          |

---

## Carry-overs to M10 (or Phase 1)

1. **Upstash provisioning:** `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` env vars needed in Vercel. Without them, rate limiting + Twilio idempotency are no-ops.
2. **Extend SETNX idempotency to Nylas, Slack, Drive, DocuSign, Deepgram webhooks.** Each has its own natural idempotency key (Nylas: `message_id`; Slack: `event_id`; Drive: `channel_id + resource_state`; DocuSign: `envelope_id + event`; Deepgram: `request_id`).
3. **Blob cleanup job:** scan `recordings WHERE deleted_at < now() - interval '30 days'` and call Vercel Blob `del()`. Pair with the existing retention cron.
4. **Activity feed pagination + cursor:** current 200-row cap per source is fine for Phase 0 but will exceed itself once a deal accumulates a 75-day lifecycle.
5. **`kg_edges` → deal attribution:** add `deal_id` column + backfill from parties, then re-add the edges query to `getDealActivity`.
6. **Activity feed filters:** "show only emails", "show only documents", etc. Currently the timeline is flat.
7. **Typesense + Mem0 provisioning (still pending from M7).**
8. **All M2–M8 carry-overs still pending** (Nango + PBX vendors; WDK workflows; Nylas OAuth; Cal.com; NeverBounce; CRM enrichment; Drive Blob retention; Drive replay protection; telephony entity resolution if M8 PR #62 isn't merged yet).

---

## References

- Plan: `docs/superpowers/plans/2026-05-24-phase-0-month-9-cache-hardening-activity-feed.md`
- Predecessor ADRs: `docs/adr/0001` through `docs/adr/0007` (`0008` pending merge with M8 PR #62)
- Spec anchors: §8.5 (Idempotency on webhook handlers), §12.1 (Rate limiting on public endpoints), §6 (Deal-centric data model and activity surface).
- Final SHA on `feat/m9-cache-hardening-activity-feed`: see PR description after squash-merge.
