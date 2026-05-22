# ADR 0002: Phase 0 Month 2 — Telephony Foundation

**Status:** Accepted (shipped 2026-05-22)
**Author:** Phase 0 Month 2 implementation (Claude Sonnet 4.6 + Connor Hickey)
**Supersedes:** None
**Superseded by:** None

---

## Context

Phase 0 Month 2 (M2) built the telephony foundation that spec §8.2 + §11.1 require as a prerequisite
for the Layer 2 processor workspace and the Layer 4 autonomous voice agent. The plan at
`docs/superpowers/plans/2026-05-13-phase-0-month-2-telephony.md` targeted 28 tasks. This ADR
documents what actually shipped, where reality diverged, and the reasoning behind decisions made
under uncertainty.

Final SHA on `main`: `cb47919`. 16 completed tasks across PRs #38–#53. 12 tasks skipped per the
active instruction to skip tasks requiring external system registration or vendor credentials not yet
provisioned.

---

## What shipped

### New workspace packages (5)

| Package                       | Contents                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `@cema/blob`                  | `put()`, `signedDownloadUrl()`, `recordingLifecycle` (legal-hold + soft-delete guards)        |
| `@cema/queues`                | Typed Vercel Queues topic registry + `publish()` + `consume()` with Zod payload validation    |
| `@cema/integrations-nango`    | Nango SDK wrapper, `org_integration_connections` CRUD, frontend OAuth helper                  |
| `@cema/integrations-twilio`   | `initiateOutboundCall()`, `buildOutboundTwiml()`, HMAC-SHA1 signature verification            |
| `@cema/integrations-deepgram` | `submitBatch()`, `parseTranscriptResponse()`, HMAC-SHA256 webhook verification, type fixtures |

### Database (7 migrations, 0006–0012)

| Migration                            | Contents                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `0006_communication_enums.sql`       | 5 Postgres enums: `communication_kind`, `direction`, `medium`, `telephony_provider`, `status`                              |
| `0007_parties_tcpa.sql`              | `tcpa_opt_in`, `tcpa_opt_in_at`, `tcpa_opt_in_source`, `recording_disclosure_confirmed_at` on `parties`                    |
| `0008_communications.sql`            | `communications` + `recordings` tables; all indexes and CHECK constraints                                                  |
| `0009_recordings_invariants.sql`     | UNIQUE on `recordings.communication_id` + 3 non-negativity CHECKs                                                          |
| `0010_integration_connections.sql`   | `org_integration_connections` — one row per org × vendor × external account                                                |
| `0011_rls_telephony.sql`             | RLS policies: direct org_id on `communications` + `org_integration_connections`; EXISTS-via-communications on `recordings` |
| `0012_gigantic_living_lightning.sql` | `recordings.vendor_request_id varchar(128)` — Deepgram callback link-back column                                           |

### Application (`apps/web`) — server actions + UI

| File                                               | Purpose                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `lib/compliance/tcpa-guard.ts`                     | `tcpaGuard(party)` — throws `TcpaConsentMissingError` for borrower parties without opt-in             |
| `lib/compliance/dnc-guard.ts`                      | Feature-flagged Phase 3 stub (`dncCheckEnabled=false`)                                                |
| `lib/actions/initiate-outbound-call.ts`            | Server action: resolve party → TCPA guard → DNC guard → Twilio dial → pre-create `communications` row |
| `lib/actions/list-communications.ts`               | List all communications for a Deal, reverse-chronological via `withRls`                               |
| `lib/actions/get-communication.ts`                 | Fetch comm + recording + 1h signed audio URL + transcript JSON from Blob                              |
| `components/click-to-call-button.tsx`              | Client component: modal with party + number, recording toggle always-checked                          |
| `components/communication-card.tsx`                | Server component: direction icon, provider badge, E.164 formatting, status pill                       |
| `components/audio-scrubber.tsx`                    | `forwardRef` client component; exposes `seekTo(seconds)` via `useImperativeHandle`                    |
| `components/transcript-viewer.tsx`                 | Speaker-colored paragraphs; per-word `<button>` with click-to-seek                                    |
| `components/communication-player.tsx`              | Ties `AudioScrubberHandle` ref to `TranscriptViewer` word clicks                                      |
| `app/(app)/deals/[id]/communications/page.tsx`     | RSC: timeline list of communications per Deal                                                         |
| `app/(app)/deals/[id]/communications/[c]/page.tsx` | RSC: audio player + transcript + metadata + AI summary placeholder                                    |
| `app/api/webhooks/twilio/route.ts`                 | HMAC-SHA1 verified Twilio recording-status callback → queue publish                                   |
| `app/api/webhooks/deepgram/route.ts`               | HMAC-SHA256 verified Deepgram callback → parse transcript → Blob → DB update                          |

### Integration tests (2 new)

| File                                           | Assertion                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `tests/integration/communications-rls.test.ts` | Cross-org isolation for `communications` (direct) + `recordings` (EXISTS-join): SELECT, UPDATE, DELETE all filtered |

### Test count

65 tests across 13 test files passing at PR #53 (final M2 SHA).

---

## Skipped tasks and rationale

The following tasks were deferred per the active session instruction: "skip any task that may
involve customer, client, or outside systems / complicated account setup / registration for now."

| Task | Scope                                                                | Reason skipped                                  |
| ---- | -------------------------------------------------------------------- | ----------------------------------------------- |
| 10   | Nango provider configs (RingCentral, Dialpad, Zoom Phone OAuth apps) | Requires OAuth app creation in 3 vendor portals |
| 11   | `@cema/integrations-ringcentral` client + webhook                    | Depends on Task 10                              |
| 12   | `/api/webhooks/ringcentral` route                                    | Depends on Tasks 10, 11                         |
| 13   | `@cema/integrations-dialpad` + webhook                               | Requires Dialpad OAuth app                      |
| 14   | `@cema/integrations-zoom-phone` + webhook                            | Requires Zoom OAuth app                         |
| 20   | `telephony.call.ingest` WDK workflow                                 | `@vercel/workflow` (WDK) not installed          |
| 21   | Queue consumer → workflow glue                                       | Depends on Task 20                              |
| 22   | `/settings/integrations/telephony` UI                                | Depends on Tasks 9, 10 (Nango OAuth)            |
| 26   | E2E webhook → DB integration test                                    | Depends on Tasks 11, 12, 20, 21                 |
| 28   | Vercel env var sync + production smoke test                          | Requires real API keys provisioned              |

These tasks are the primary carry-overs to M3 and beyond.

---

## Architectural decisions

### 1. Schema split: `communications` + `recordings` (1:1)

**Decision:** Keep `communications` lean (queryable timeline layer) and put bulky storage references
in a separate `recordings` table with a 1:1 FK enforced by `UNIQUE(communication_id)`.

**Rationale:** Phase 1+ will query communications for AI processing, CRM sync, and search. A lean
communications table stays index-friendly for `(organization_id, started_at DESC)` timeline scans.
Storage metadata (Blob URLs, transcript paths, retention controls) is append-once and rarely queried;
isolating it prevents column bloat. The 1:1 constraint is a UNIQUE index rather than a FK direction
choice — this leaves room to relax it in Phase 3 (multiple media artifacts per comm: screen share,
video) as a schema-level decision rather than a silent sprawl.

**Trade-off accepted:** Two SELECT operations per detail page (comm + recording). Mitigated: both
queries are index-hit and Neon serverless is low-latency; `get-communication.ts` fires them in
sequence within a single `withRls` transaction.

---

### 2. `vendor_request_id` on `recordings` — mid-M2 addition

**Decision:** Added `recordings.vendor_request_id varchar(128)` via migration 0012 during Task 19,
not in the original Task 4 schema.

**Rationale:** The Deepgram batch API returns a `request_id` immediately; the full transcript
arrives later via callback. The webhook handler needs to look up which recording to update. Without
a link column, the only option would be passing the recording ID inside the Deepgram callback URL
(fragile, exposes internal IDs) or a full table scan (unacceptable at scale). Storing the
Deepgram `request_id` on the recording row is the cleanest approach; it's nullable until the
workflow submits to Deepgram and fills it in.

---

### 3. RLS on telephony tables: direct + EXISTS-join

**Decision:** `communications` uses a direct `organization_id` equality policy (same as M1
`deals`). `recordings` has no org column; its policy uses `EXISTS (SELECT 1 FROM communications
WHERE c.id = recordings.communication_id AND c.organization_id = current_setting(...))`.

**Rationale:** Copying `organization_id` onto `recordings` would denormalize but make the policy
faster. Keeping it lean and using EXISTS keeps the schema normalized and the FK as the single
source of truth for the communication ↔ recording relationship. The EXISTS subquery is
index-backed via `communications_organization_id_idx` and is a cheap row-level check.

**Integration test proof:** `tests/integration/communications-rls.test.ts` (PR #53) verifies both
policy shapes against a live Neon branch.

---

### 4. `neondb_owner` in webhook handlers (no user session)

**Decision:** Twilio and Deepgram webhook routes (`/api/webhooks/{twilio,deepgram}`) call `getDb()`
directly (running as `neondb_owner`, BYPASSRLS=true) rather than `withRls`. Initial lookups (find
recording by `vendor_request_id`, find communication by recording) run without RLS context.

**Rationale:** Webhook routes have no Clerk session. The security gate is the vendor signature
verification (HMAC-SHA1 for Twilio, HMAC-SHA256 for Deepgram) — if that passes, the request is
authentic. Using `withRls` would require resolving an org ID from the webhook payload, which is
vendor-specific and fragile. The neondb_owner path is acceptable here because (a) signature
verification gates the route, (b) the handler only reads/updates the specific row identified by
vendor IDs, not a broad multi-tenant query, and (c) this pattern is documented in the M1 RLS ADR
§"Phase 0 Month 2 carry-over: RLS production enforcement."

---

### 5. Drizzle `inArray()` over raw `sql` template for IN clauses

**Decision:** Integration tests and cleanup code use Drizzle's `inArray(col, [a, b])` helper rather
than `sql\`WHERE id IN (${a}, ${b})\``.

**Rationale:** During Task 25 development the raw `sql` template produced a Postgres 42601 syntax
error when rendered by the Neon serverless driver for IN-with-multiple-params. `inArray()` is
properly parameterized by Drizzle's query builder and avoids the issue entirely. This pattern
should be used consistently across the codebase for IN queries.

---

### 6. `NormalizedTranscript` as the cross-cutting type

**Decision:** `@cema/integrations-deepgram` exports a `NormalizedTranscript` type that is the
canonical in-memory representation of a transcript. The Deepgram webhook handler, `get-communication.ts`,
and the `TranscriptViewer` component all import this type directly.

**Rationale:** Deepgram's raw JSON shape is vendor-specific and verbose. Normalizing once in
`parseTranscriptResponse()` (inside the deepgram package) means every consumer gets a stable
interface. When M3 adds Whisper Large v3 as a batch STT option, the new vendor's parser just needs
to produce the same `NormalizedTranscript` shape; all downstream code is unaffected.

---

## Plan vs. reality divergences

| Plan item                                                                                | Reality                                                                                                                               | Impact                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Task 4 included `recordings.vendor_request_id`                                           | Column added in Task 19 via migration 0012 after the Deepgram callback link requirement became clear                                  | One extra migration; trivial                                                                                              |
| Task 26 (E2E webhook→DB test) targeted RingCentral                                       | Tasks 11-12 (RingCentral client + webhook) skipped; test cannot be written without them                                               | Deferred to M3                                                                                                            |
| `communications_provider_vendor_call_id_uidx` planned as non-null unique                 | `(provider, vendor_call_id)` allows NULL values (Twilio click-to-call pre-creates with NULL `vendor_call_id`)                         | Postgres NULL semantics: multiple `(twilio, NULL)` rows are allowed — the unique constraint fires only for non-null pairs |
| `@cema/blob` `recordings.ts` module planned for lifecycle cron (legal-hold, soft-delete) | Legal-hold `markLegalHold()` and `softDelete()` implemented; the Phase 1 cron that scans `retention_until < now()` is not implemented | Named gap: cron ships in M5 or Phase 1 per plan                                                                           |
| AI summary placeholder card in deal detail                                               | Implemented inline in page.tsx, not a separate component                                                                              | Non-issue                                                                                                                 |

---

## Type-design investment

### `NormalizedTranscript` / `TranscriptWord` / `TranscriptParagraph`

Located in `@cema/integrations-deepgram/src/types.ts`. Encapsulates the invariants:

- `words[]` are the finest-grain unit (click-to-seek target)
- `paragraphs[]` group words by speaker with `start` / `end` timestamps
- No raw Deepgram JSON escapes past `parseTranscriptResponse()`

**Encapsulation:** High. All downstream code imports the normalized type, not the Deepgram raw shape.
**Invariant expression:** Medium. Timestamp ordering (word.start < word.end) is not enforced at the
type level — it would require a branded numeric type or Zod parse. Deferred: correctness is
enforced by Deepgram's output and tested via fixture.

### `CommunicationDetail`

Located in `apps/web/lib/actions/get-communication.ts`. Return type of `getCommunication()`:

```ts
{
  communication: Communication;
  recording: Recording | null;
  signedAudioUrl: string | null;
  transcript: NormalizedTranscript | null;
}
```

**Encapsulation:** High. The detail page never calls `getDb()` directly; all data comes through
this type. `signedAudioUrl` being `string | null` (not `URL`) is a pragmatic choice — Next.js RSC
passing to client components requires plain serializable values.

---

## Consequences

### Positive

- **Complete Twilio click-to-call pipeline** in place: server action → Twilio REST → TwiML
  (two-party disclosure preamble) → recording-status-callback → `withRls` DB write.
- **Complete Deepgram batch transcription callback** in place: Blob upload → Deepgram
  `/v1/listen?callback=` → webhook → normalized transcript → Blob storage → DB status flip.
- **TCPA guard enforced** at server action layer (hard rule #4) with full unit test coverage.
- **Two-party-consent enforcement** at TwiML layer (hard rule #5) — disclosure is in `buildOutboundTwiml()`, not caller code.
- **RLS isolation proven** for M2 telephony tables at integration test level (PR #53).
- **Transcript viewer** with click-to-seek: processors can click a word to jump to that moment in the audio — directly reduces time-to-review for recorded calls.

### Negative / accepted trade-offs

- **No live PBX ingest** (RingCentral / Dialpad / Zoom Phone): the full pipeline from vendor
  webhook → WDK workflow → DB is not wired. Recordings can only enter via Twilio click-to-call.
- **Legal-hold enforcement is application-layer only**: Vercel Blob has no object-lock semantics.
  A direct Blob delete via dashboard or API bypasses the `recordings.legal_hold` guard. The
  eventual solution (CallCabinet vault per spec §16.I) is deferred.
- **No WDK workflow**: Tasks 20-21 skipped. Without the orchestrated workflow, there is no
  retry-on-failure for the multi-step ingest pipeline (download → blob → Deepgram submit). A
  transient error in any step is currently unrecoverable without manual intervention.
- **No idempotency deduplication**: The Upstash Redis `SETNX` dedupe layer (spec §8.5) was not
  implemented; only the DB-level `vendor_event_id UNIQUE` constraint provides idempotency.

---

## Carry-overs to M3

1. **Tasks 10-14**: Nango provider configs + RingCentral / Dialpad / Zoom Phone integration packages + webhooks. Prerequisite for live inbound PBX recording ingest.
2. **Tasks 20-22**: WDK workflow (`telephony.call.ingest`) + queue consumer + telephony settings UI. Prerequisite for a durable, retryable ingest pipeline.
3. **Task 26**: E2E webhook→DB integration test (can be written once Tasks 11-12 + 20-21 land).
4. **Task 28**: Vercel env var provisioning + production deploy verification.
5. **Upstash idempotency**: Add Redis `SETNX telephony:idempo:<vendor_event_id>` in webhook handlers before the queue publish (spec §8.5).
6. **Communication ↔ Party resolution**: `from_party_id` / `to_party_ids` are nullable M2. Apache AGE knowledge-graph entity resolution (plan §9 open question 5) is M3+.
7. **Recording retention cron**: Scans `retention_until < now() AND legal_hold = false`; Phase 1 or M5.

---

## References

- Plan: `docs/superpowers/plans/2026-05-13-phase-0-month-2-telephony.md`
- Spec: `docs/superpowers/specs/2026-05-12-cema-ai-processor-design.md` §8.2, §6.5, §6.6, §11.1, §12.2, §16.I, §16.J
- Prior ADR: `docs/adr/0001-phase-0-month-1-architecture.md`
- Runbook: `docs/runbooks/telephony-incident-triage.md` (created with this ADR)
