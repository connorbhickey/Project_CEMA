# Phase 0 Month 2 — Telephony Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-05-13
**Phase:** 0 (Foundation), Month 2 of 5
**Prior plan:** [2026-05-12-phase-0-month-1-foundation.md](./2026-05-12-phase-0-month-1-foundation.md)
**Prior ADR:** [0001-phase-0-month-1-architecture.md](../../adr/0001-phase-0-month-1-architecture.md)

**Spec anchors:** §8.2 (Telephony), §6.5 (Communication entity), §6.6 (Task), §6.8 (Audit), §11.1 (Phase 0 Month 2 row), §16.I (Telephony catalog), §16.J (STT/TTS), §12.2 (Compliance).

---

## 1. Goal & End State

By end-of-month a Vercel preview shows the following working flow against real Neon + real Vercel Blob + real Deepgram batch + real (or sandboxed) RingCentral / Dialpad / Zoom Phone / Twilio:

1. A processor connects their org's **RingCentral, Dialpad, or Zoom Phone** account via Nango OAuth from `/settings/integrations/telephony`.
2. Inbound + outbound calls placed via the connected PBX produce a webhook → enqueue job → workflow downloads the recording → uploads to Vercel Blob → fires Deepgram batch transcription → writes a row to `communications` + a row to `recordings` + transcript JSON to Blob. End-to-end latency target: < 60 s after hangup for typical 5–10 min calls.
3. A processor can **click-to-call** a servicer number from a Deal page; Twilio dials out from a tracked org-owned number with two-party-consent verbal disclosure preamble; the call is recorded and lands in the same pipeline.
4. Per Deal, processors see a Communications timeline (call list) and can drill into a single call: audio player, paginated diarized transcript, attached files placeholder, AI summary placeholder (Phase 1).
5. TCPA opt-in flag on `parties` is enforced for any outbound to `party.role = 'borrower' | 'co_borrower'`; B2B outbound to servicers requires no opt-in but still records the disclosure preamble.
6. Every recording.create, transcription.complete, click-to-call.initiated, and consent.disclosed step emits an `auditEvents` row through `emitAuditEvent` inside `withRls`.

**Deliverable validation:**

- `pnpm dev` runs locally with Nango sandbox + Twilio test creds + Deepgram (real, paid) and the click-to-call → record → transcribe loop completes for a self-test number.
- `pnpm test` passes (~25 new unit tests on top of M1's 59).
- `pnpm test:integration` adds 2 new integration tests: cross-org `communications` RLS isolation and an end-to-end webhook → workflow → DB happy-path with mocked vendor signatures.
- Vercel preview deploy green (if Vercel preview is still broken from M1 carry-over, the local + CI path is the gate; see §8 Risks).

---

## 2. Hard Non-Goals (out of scope this month)

Reproduced verbatim from the M2 brief so reviewers can scan:

- **No autonomous voice agent** ("Twilio outbound, no agent yet"). Phase 3.
- **No Deepgram Nova-3 real-time streaming.** Batch only (`/v1/listen` pre-recorded API). Phase 3.
- **No ElevenLabs / no TTS work.** Phase 3.
- **No Microsoft Teams Phone.** Lands Month 3 with M365 Graph email/calendar.
- **No 8x8 / Vonage / GoTo / Nextiva / OpenPhone / Aircall / JustCall / Telnyx.** Phase 1.5+ per §16.I.
- **No Gryphon Networks DNC scrubbing.** Phase 3. Outbound flow has a feature-flag gate (`dncCheckEnabled = false`) where the check would later sit.
- **No STIR/SHAKEN A-attestation work.** M2 outbound is processor → servicer (B2B); STIR/SHAKEN lands with Phase 3 borrower-facing voice agent.
- **No CallCabinet compliance vault.** Vercel Blob is the M2 recording store; CallCabinet evaluation is Phase 1.5.
- **No SMS, WhatsApp, voicemail-only flows.** Voicemails captured by PBX vendors are not separately processed — they arrive as call recordings of `direction=inbound` with `to_party=org_main_number`.
- **No work-cell softphone tracking.** Mobile softphone calls already route through the cloud PBX vendors above; native-cell calls are explicitly excluded per spec §8.2.

If reality forces a change, raise as Open Question and update the spec (hard rule #11), don't silently expand.

---

## 3. Architecture Sketch

```
   ┌──────────────────────────────────────────────────────────────────┐
   │                 Cloud PBX vendors (M2: 3 only)                   │
   │   RingCentral          Dialpad           Zoom Phone              │
   │   call.recording       call.ended        recording_completed     │
   │       webhook             webhook             webhook            │
   └────────┬─────────────────┬──────────────────────┬────────────────┘
            │ vendor-signed   │                      │
            ▼                 ▼                      ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  POST /api/webhooks/{ringcentral|dialpad|zoom-phone|twilio}      │
   │   1. Verify vendor signature (per-vendor scheme)                 │
   │   2. Resolve connection → org_id via Nango account_id            │
   │   3. Idempotency check (vendor_event_id seen?)                   │
   │   4. Enqueue Vercel Queues: telephony.call.ingest                │
   │   5. 200 OK (<2s SLA; everything else is async)                  │
   └──────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  Vercel Workflow DevKit: telephony.call.ingest                   │
   │   step.run("fetch-vendor-call-meta")    → vendor REST GET        │
   │   step.run("download-recording")        → vendor signed URL      │
   │   step.run("upload-to-blob")            → Vercel Blob put()      │
   │   step.run("create-communications-row") → withRls(orgId, …)      │
   │   step.run("create-recording-row")      → withRls(orgId, …)      │
   │   step.run("emit-audit-recording-ingested")                      │
   │   step.run("deepgram-submit-batch")     → Deepgram /v1/listen    │
   │   step.run("deepgram-poll-or-callback") → save transcript JSON   │
   │   step.run("save-transcript-and-emit")  → withRls + audit        │
   └──────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ Neon Postgres (RLS-enforced via withRls)                         │
   │  communications  ←→  parties  ←→  deals  ←→  organizations       │
   │  recordings (transcript_blob_url, recording_blob_url, …)         │
   │  audit_events (append-only)                                      │
   └──────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ TanStack/RSC reads
                                  │
   ┌──────────────────────────────┴───────────────────────────────────┐
   │ Next.js 16 apps/web (RSC)                                        │
   │  /deals/[id]/communications       (timeline list)                │
   │  /deals/[id]/communications/[c]   (player + transcript)          │
   │  /settings/integrations/telephony (Nango Connect UI)             │
   │  POST /api/click-to-call          (server action → Twilio dial)  │
   └──────────────────────────────────────────────────────────────────┘
```

**Click-to-call (outbound) variant** routes through `/api/click-to-call` → server action → Twilio outbound TwiML with `<Say>` two-party-consent preamble → `<Dial record="record-from-answer-dual">` → Twilio `recording-status-callback` lands in the same `/api/webhooks/twilio` → `telephony.call.ingest` workflow as the inbound flows. Single ingest pipeline regardless of source vendor.

---

## 4. Pre-flight / Dependencies

### 4.1 Vercel Marketplace add-ons to provision (use `vercel:marketplace`)

| Add-on        | Purpose                                      | Notes                                               |
| ------------- | -------------------------------------------- | --------------------------------------------------- |
| Twilio        | Outbound voice + recording status callbacks  | Buy 1 NY area-code DID for org-test                 |
| Deepgram      | Batch transcription (`/v1/listen`)           | Nova-3 model id for diarization                     |
| Nango Cloud   | OAuth broker for RingCentral/Dialpad/ZoomPhn | Free tier sufficient for 3 vendors; Pro at Phase 1  |
| Vercel Blob   | Already provisioned in M1; verify quotas     | Bump tier if billing review flags                   |
| Vercel Queues | Webhook → workflow enqueue                   | Beta; create topic `telephony.call.ingest`          |
| Upstash Redis | Webhook idempotency dedupe TTL (24h)         | Already in M1 stack; key prefix `telephony:idempo:` |

### 4.2 Env vars (added to `.env.example` and Vercel via `vercel env`)

```
# Nango
NANGO_SECRET_KEY=...
NANGO_PUBLIC_KEY=...
NANGO_HOST=https://api.nango.dev

# RingCentral OAuth app (via Nango)
RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN=...

# Dialpad OAuth app (via Nango)
DIALPAD_WEBHOOK_SIGNING_SECRET=...

# Zoom Phone OAuth app (via Nango)
ZOOM_WEBHOOK_SECRET_TOKEN=...

# Twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_OUTBOUND_NUMBER=+1XXXXXXXXXX
TWILIO_STATUS_CALLBACK_URL=https://<deploy>/api/webhooks/twilio

# Deepgram
DEEPGRAM_API_KEY=...
DEEPGRAM_MODEL=nova-3-general
DEEPGRAM_CALLBACK_URL=https://<deploy>/api/webhooks/deepgram

# Vercel Blob (M1)
BLOB_READ_WRITE_TOKEN=...

# Vercel Queues
VERCEL_QUEUE_TELEPHONY_TOPIC=telephony.call.ingest

# Upstash Redis (M1)
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

All managed via `vercel env`. No secret values committed (hard rule #1).

### 4.3 Packages to add (workspace, per CLAUDE.md §6)

```
packages/integrations/nango/         # OAuth broker client + token storage
packages/integrations/ringcentral/   # Client + webhook + sync
packages/integrations/dialpad/       # Client + webhook + sync
packages/integrations/zoom-phone/    # Client + webhook + sync
packages/integrations/twilio/        # Outbound dial + recording status
packages/integrations/deepgram/      # Batch transcription client
packages/blob/                       # Vercel Blob wrapper (signed URLs, lifecycle)
packages/workflows/                  # WDK workflow definitions (first occupant: telephony.call.ingest)
packages/queues/                     # Vercel Queues wrapper (topic registry + typed publish/consume)
```

Each integration package follows the M1 convention: `client.ts`, `types.ts`, `webhook.ts`, `README.md`, colocated `*.test.ts`. The spec §16 catalog entries already exist for RingCentral, Dialpad, Zoom Phone, Twilio, Deepgram, Nango (per CLAUDE.md hard rule #12).

### 4.4 Skills to invoke during execution (mirrors M1's mapping pattern)

Pervasive: `superpowers:using-superpowers`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`, `commit-commands:commit`, `vercel:knowledge-update`.

Per-area:

| Area                              | Skill(s)                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Schema work                       | `legal:compliance-check`, `vercel:vercel-storage`                                                                                        |
| Vercel Blob                       | `vercel:vercel-storage`                                                                                                                  |
| Vercel Queues                     | `vercel:vercel-queues`                                                                                                                   |
| WDK workflow                      | `vercel:workflow`, `engineering:system-design`                                                                                           |
| OAuth (Nango)                     | `legal:vendor-check` (Nango), `legal:compliance-check` (token storage)                                                                   |
| RingCentral/Dialpad/Zoom webhooks | `vercel:vercel-functions`, `vercel:routing-middleware`                                                                                   |
| Twilio click-to-call              | `vercel:vercel-functions`, `legal:legal-risk-assessment` (TCPA, 2-party)                                                                 |
| Deepgram                          | `vercel:ai-sdk` (for callback handler patterns)                                                                                          |
| UI surfaces                       | `vercel:nextjs`, `vercel:react-best-practices`, `vercel:shadcn`, `design:accessibility-review`, `vercel:ai-elements` (transcript viewer) |
| Compliance audit                  | `legal:compliance-check` (TCPA + recording disclosure)                                                                                   |
| Tests                             | `engineering:testing-strategy`, `vercel:verification`                                                                                    |
| Phase-end                         | `engineering:architecture` (ADR 0002), `operations:runbook`, `claude-md-management:revise-claude-md`                                     |

---

## 5. File Structure (new + modified)

```
packages/
├── blob/
│   ├── src/
│   │   ├── index.ts
│   │   ├── client.ts            # put(), signedDownloadUrl(), del()
│   │   ├── recordings.ts        # 7-year retention helpers, legal-hold suspend
│   │   └── recordings.test.ts
│   ├── package.json
│   └── tsconfig.json
├── queues/
│   ├── src/
│   │   ├── index.ts
│   │   ├── topics.ts            # typed topic registry (telephony.call.ingest, …)
│   │   ├── publish.ts
│   │   └── consume.ts
│   └── …
├── workflows/
│   ├── src/
│   │   ├── index.ts
│   │   └── telephony/
│   │       ├── call-ingest.workflow.ts
│   │       └── call-ingest.workflow.test.ts
│   └── …
├── integrations/
│   ├── nango/
│   │   ├── src/
│   │   │   ├── client.ts        # Nango SDK wrapper
│   │   │   ├── connections.ts   # CRUD on org_integration_connections
│   │   │   ├── token-vault.ts   # encrypt-at-rest token storage
│   │   │   ├── types.ts
│   │   │   └── *.test.ts
│   │   └── README.md
│   ├── ringcentral/
│   │   ├── src/{client,webhook,types,sync}.ts
│   │   └── README.md
│   ├── dialpad/
│   ├── zoom-phone/
│   ├── twilio/
│   │   ├── src/
│   │   │   ├── client.ts        # outbound dial via Twilio Voice REST
│   │   │   ├── twiml.ts         # buildOutboundTwiml() w/ consent preamble
│   │   │   ├── webhook.ts       # status callback verification
│   │   │   └── *.test.ts
│   │   └── README.md
│   └── deepgram/
│       ├── src/{client,webhook,types}.ts
│       └── README.md

packages/db/src/schema/
├── communications.ts     # NEW — Communication entity (spec §6.5)
├── recordings.ts         # NEW — call_recording rows w/ retention metadata
├── integrations.ts       # NEW — org_integration_connections (Nango)
├── parties.ts            # MODIFIED — add tcpa_opt_in, recording_disclosure_confirmed_at
├── enums.ts              # MODIFIED — add communication_kind, communication_direction, communication_medium, telephony_provider
└── index.ts              # MODIFIED — re-exports

packages/db/migrations/
├── 0003_communications.sql        # tables + RLS policies
├── 0004_audit_immutability.sql    # carry-over: BEFORE UPDATE/DELETE triggers on audit_events + attorney_approvals
└── 0005_doc_version_fk.sql        # carry-over: composite UNIQUE on documents(id, version) + FK from attorney_approvals

apps/web/
├── app/
│   ├── api/
│   │   ├── webhooks/
│   │   │   ├── ringcentral/route.ts
│   │   │   ├── dialpad/route.ts
│   │   │   ├── zoom-phone/route.ts
│   │   │   ├── twilio/route.ts
│   │   │   └── deepgram/route.ts
│   │   └── click-to-call/route.ts
│   └── (app)/
│       ├── deals/[id]/
│       │   ├── communications/page.tsx
│       │   └── communications/[c]/page.tsx
│       └── settings/integrations/telephony/page.tsx
├── components/
│   ├── click-to-call-button.tsx
│   ├── communication-card.tsx
│   ├── transcript-viewer.tsx
│   └── telephony-connection-card.tsx
├── lib/
│   ├── actions/
│   │   ├── initiate-outbound-call.ts
│   │   ├── list-communications.ts
│   │   ├── get-communication.ts
│   │   └── create-telephony-connection.ts
│   └── compliance/
│       └── tcpa-guard.ts        # requires tcpa_opt_in for borrower parties
└── tests/integration/
    ├── communications-rls.test.ts
    └── webhook-to-db.test.ts
```

---

## 6. Tasks

> Target: 28 tasks. Each is one PR ≤ 400 LOC. Dependencies cited by task number.

### Task 1 — Carry-over: audit immutability triggers + doc-version FK

**Scope:** Sweep the two remaining M1 ADR carry-overs that are tiny but block compliance hygiene. Husky v10 prep already shipped in PR #31 (`37f4884`) and RLS production enforcement in PR #30 (`c852efb`); those rows in the M1 ADR are now resolved.

**Files touched:**

- `packages/db/migrations/0004_audit_immutability.sql` (new — `BEFORE UPDATE OR DELETE` triggers on `audit_events` and `attorney_approvals` that `RAISE EXCEPTION` to enforce append-only-ness at the DB layer; hard rule #2 + audit-log rule become DB-enforced, not just app-enforced)
- `packages/db/migrations/0005_doc_version_fk.sql` (new — composite `UNIQUE(id, version)` on `documents` + matching composite FK on `attorney_approvals(documentId, documentVersion) → documents(id, version)`, ensuring an approval can never point at a non-existent document version)
- `packages/db/migrations/meta/_journal.json` (entries 0004, 0005)
- `packages/db/src/schema/documents.ts` (add `uniqueIndex` on `(id, version)`)
- `packages/db/src/schema/attorney-review.ts` (composite FK to `documents(id, version)`)

**Acceptance:**

- `pnpm db:migrate` against dev branch applies 0004 + 0005 cleanly.
- New test `packages/db/src/schema/audit-immutability.test.ts` asserts that `UPDATE audit_events SET …` and `DELETE FROM audit_events` both raise from the trigger; same for `attorney_approvals`.

**Dependencies:** none.

**Compliance touchpoints:** ADR 0001 §"Negative / accepted trade-offs" items 2 and 3. Hard rules #2 (attorney gate) and audit-log immutability become DB-enforced, not advisory.

**Carry-overs to next month:** none.

---

### Task 2 — Enums for the Communication entity

**Scope:** Add the four Postgres enums that the new schema needs, before any table that references them.

**Files touched:**

- `packages/db/src/schema/enums.ts` (append)
- `packages/db/src/schema/enums.test.ts` (extend)

```ts
// communication_kind, communication_direction, communication_medium,
// telephony_provider, communication_status
```

Values (spec §6.5):

- `communication_kind`: `call | email | sms | slack | teams | meeting | letter | fax`
- `communication_direction`: `inbound | outbound | internal`
- `communication_medium`: `phone_landline | phone_softphone | gmail | m365 | slack | teams | sms_twilio | webrtc | other`
- `telephony_provider`: `ringcentral | dialpad | zoom_phone | twilio | manual_upload`
- `communication_status`: `pending | ingested | transcribing | ready | failed`

Email/slack/teams kinds land schema-wise this month but only `call` is populated. Lock the values now so M3 doesn't break enums.

**Acceptance:** `pnpm test --filter @cema/db` adds 5 enum-values tests; `pnpm db:generate` produces clean diff.

**Dependencies:** Task 1 only because both ship as the first migrations of M2 and we want ordering stable.

**Compliance touchpoints:** none.

---

### Task 3 — Schema: `parties` TCPA opt-in + recording-disclosure timestamps

**Scope:** Add two columns to `parties` and a CHECK constraint. CLAUDE.md hard rule #4 requires a TCPA opt-in column on the borrower entity. M1's `parties` table has `role` and `email/phone` but no consent surface.

**Files touched:**

- `packages/db/src/schema/parties.ts`
  - `tcpa_opt_in boolean NOT NULL DEFAULT false`
  - `tcpa_opt_in_at timestamptz`
  - `tcpa_opt_in_source varchar(64)` (e.g. `app_form`, `loan_app_addendum`, `recorded_verbal`)
  - `recording_disclosure_confirmed_at timestamptz`
  - CHECK: `tcpa_opt_in = false OR tcpa_opt_in_at IS NOT NULL` (can't be opted-in without a timestamp)
- `packages/db/migrations/0006_parties_tcpa.sql`
- `packages/db/src/schema/parties.test.ts` (extend)

**Acceptance:** Default of `false` honored on insert; CHECK rejects `tcpa_opt_in=true, tcpa_opt_in_at=null`. Existing M1 RLS policy on `parties` continues to work (it joins via deals; no policy change needed).

**Dependencies:** Task 1, 2.

**Compliance touchpoints:** Hard rule #4. The `tcpaGuard()` helper in Task 17 reads these columns.

---

### Task 4 — Schema: `communications` + `recordings` tables

**Scope:** The two new tables for §6.5. Keep `communications` lean (the queryable layer) and put bulky storage references in `recordings`.

**Files touched:**

- `packages/db/src/schema/communications.ts` (new)
- `packages/db/src/schema/recordings.ts` (new)
- `packages/db/src/schema/index.ts`
- `packages/db/migrations/0007_communications.sql`
- Colocated `*.test.ts`

`communications` columns (essentials):

- `id uuid pk`, `organization_id uuid not null fk→organizations restrict`
- `deal_id uuid fk→deals` (nullable per spec §6.5)
- `kind communication_kind not null`
- `direction communication_direction not null`
- `medium communication_medium not null`
- `provider telephony_provider` (nullable for non-call kinds)
- `vendor_call_id varchar(128)` (the PBX's call id, used for dedupe)
- `vendor_event_id varchar(128) unique` (idempotency key for inbound webhooks)
- `from_party_id uuid fk→parties` nullable
- `to_party_ids uuid[]` (Postgres array; nullable)
- `from_e164 varchar(20)` (raw E.164 when party not yet resolved)
- `to_e164 varchar(20)`
- `started_at timestamptz`, `ended_at timestamptz`, `duration_seconds int`
- `source_thread_id varchar(128)` (vendor thread/conversation id; nullable)
- `status communication_status not null default 'pending'`
- `ai_summary text`, `ai_action_items jsonb default '[]'`, `ai_sentiment varchar(16)` (placeholder; populated Phase 1)
- `created_at`, `updated_at`

Indexes: `(organization_id, started_at desc)`, `(deal_id, started_at desc)`, `vendor_event_id unique`, `(provider, vendor_call_id)`.

CHECK constraints:

- `duration_seconds IS NULL OR duration_seconds >= 0`
- `direction = 'outbound' OR direction = 'inbound' OR direction = 'internal'` (enum already enforces; keep doc)
- `kind <> 'call' OR provider IS NOT NULL` — a call must have a provider.

`recordings` columns:

- `id uuid pk`
- `communication_id uuid not null fk→communications cascade`
- `recording_blob_url text not null` (Vercel Blob URL, never plaintext signed)
- `recording_blob_pathname text not null`
- `recording_bytes bigint`, `recording_duration_seconds int`
- `mime_type varchar(64)` (e.g. `audio/wav`, `audio/mpeg`)
- `transcript_blob_url text`, `transcript_blob_pathname text` (filled by Deepgram step)
- `transcript_words_count int`, `transcript_language varchar(8)` (e.g. `en-US`)
- `transcript_provider varchar(32)` (`deepgram-nova-3`)
- `consent_disclosure_emitted_at timestamptz`
- `legal_hold boolean not null default false`
- `retention_until timestamptz not null` (set to `now() + interval '7 years'` per spec §8.2 + §10.3)
- `deleted_at timestamptz` (soft delete; deletion respects `legal_hold = true`)
- `created_at`, `updated_at`

CHECK constraints:

- `retention_until > created_at`
- `deleted_at IS NULL OR legal_hold = false` (cannot soft-delete under hold)

Indexes: `(communication_id)`, `(retention_until)` for the lifecycle cron (Phase 1, but the index is cheap to add now).

**Acceptance:** Drizzle types build; migration applies cleanly; CHECKs reject bad input in tests; `pnpm typecheck` green.

**Dependencies:** Tasks 1–3.

**Compliance touchpoints:** Hard rule #5 (recording disclosure tracked via `consent_disclosure_emitted_at`). Spec §10.3 (7-year retention) encoded in `retention_until`.

---

### Task 5 — Schema: `org_integration_connections` (Nango broker rows)

**Scope:** One table that captures which orgs have linked which vendors via Nango. Token material lives in Nango's vault, not our DB — we only store the Nango `connection_id` plus surface metadata.

**Files touched:**

- `packages/db/src/schema/integrations.ts` (new)
- `packages/db/migrations/0008_integration_connections.sql`
- `packages/db/src/schema/index.ts`
- Colocated `*.test.ts`

Columns:

- `id uuid pk`
- `organization_id uuid not null fk→organizations restrict`
- `provider telephony_provider not null` (M3 extends to email/calendar providers via a new enum or shared `integration_provider` enum — decide in M3)
- `nango_connection_id varchar(128) not null` (Nango's unique key)
- `nango_provider_config_key varchar(64) not null` (`ringcentral`, `dialpad`, `zoom-phone`)
- `external_account_id varchar(128)` (vendor's account id; populated post-connect)
- `external_account_label text` (display name for UI)
- `connection_status varchar(32) not null default 'pending'` (`pending | active | error | revoked`)
- `last_synced_at timestamptz`, `last_error text`
- `created_by_id uuid fk→users restrict`, `created_at`, `updated_at`
- `revoked_at timestamptz`

Unique: `(organization_id, provider, external_account_id)` — one row per org/vendor/external account.
Indexes: `(organization_id, connection_status)`, `nango_connection_id unique`.

RLS policy: equality on `organization_id` (mirrors `deals` policy).

**Acceptance:** Migration applies; RLS policy active; insert under org A invisible under org B (covered by Task 25 integration test).

**Dependencies:** Tasks 2, 4 (`telephony_provider` enum).

**Compliance touchpoints:** Hard rule #12 (one integration package per vendor + spec §16 entry; rows here are the runtime instance).

---

### Task 6 — RLS policies on `communications`, `recordings`, `org_integration_connections`

**Scope:** Three new policies and grants for `cema_app_user`. Mirrors M1 0001_rls.sql pattern: direct equality where the row has `organization_id`, EXISTS-subquery where indirect.

**Files touched:**

- `packages/db/migrations/0009_rls_telephony.sql`
- Update `packages/db/migrations/0002_app_role.sql`? No — the M1 ADR §"Phase 0 Month 2 carry-over: RLS production enforcement" already added `ALTER DEFAULT PRIVILEGES`, so new tables auto-inherit `SELECT/INSERT/UPDATE/DELETE` for `cema_app_user`. Verify this assumption in the task: query `pg_default_acl` on dev branch before writing the migration. If the default privileges didn't fire (e.g., they were set after these tables were created), the migration adds explicit GRANTs.

Policies:

- `communications`: direct `organization_id` equality.
- `recordings`: EXISTS through `communications`.
- `org_integration_connections`: direct `organization_id` equality.

**Acceptance:** RLS isolation test (Task 25) proves cross-org invisibility.

**Dependencies:** Tasks 4, 5.

**Compliance touchpoints:** Multi-tenancy hard guarantee (M1 carry-over fix path now load-bearing).

---

### Task 7 — `packages/blob` — Vercel Blob wrapper + recording lifecycle helpers

**Scope:** Thin wrapper around `@vercel/blob` with three responsibilities:

1. `putRecording(orgId, communicationId, stream, mimeType)` → returns `{ url, pathname, bytes }`. Path convention: `org/<orgId>/communications/<communicationId>/recording.<ext>`.
2. `signedDownloadUrl(pathname, ttlSeconds)` → returns short-lived signed URL (default 5 min).
3. `recordingLifecycle.markLegalHold(recordingId, true|false)`, `recordingLifecycle.softDelete(recordingId)` — guards: refuses to delete when `legal_hold = true`.

**Files touched:**

- `packages/blob/src/{client,recordings,index}.ts` + tests
- `packages/blob/package.json`
- Root `pnpm-workspace.yaml`? No — turbo picks up new packages automatically.

**Acceptance:**

- Unit tests stub `@vercel/blob` and assert the path convention.
- Integration test (skipped unless `BLOB_READ_WRITE_TOKEN` is present) uploads a 1KB synthetic WAV and downloads via signed URL.

**Dependencies:** none (independent infra).

**Compliance touchpoints:** Encryption at rest is Vercel Blob's default (spec §12.1). 7-year retention handled at DB layer (Task 4). Legal-hold gate enforced in `softDelete()`.

**Carry-overs to next month:** Cron job that scans `recordings.retention_until < now() AND legal_hold = false` and soft-deletes ships in Phase 1 or as a Task in M5 — out of scope here.

---

### Task 8 — `packages/queues` — Vercel Queues wrapper with typed topic registry

**Scope:** Codify topics so producers/consumers can't mismatch payloads. Single topic in M2: `telephony.call.ingest`.

**Files touched:**

- `packages/queues/src/topics.ts` — Zod schema per topic
- `packages/queues/src/publish.ts` — `publish('telephony.call.ingest', payload)` with runtime Zod validation
- `packages/queues/src/consume.ts` — typed handler factory

Payload schema for `telephony.call.ingest`:

```ts
{
  orgId: string,
  provider: 'ringcentral' | 'dialpad' | 'zoom_phone' | 'twilio',
  vendorCallId: string,
  vendorEventId: string, // idempotency key
  vendorPayload: Record<string, unknown>, // webhook body verbatim, for replay
  receivedAt: string, // ISO
}
```

**Acceptance:** `pnpm test --filter @cema/queues` proves Zod rejects bad payloads at publish time.

**Dependencies:** none.

**Compliance touchpoints:** none direct, but consistent payload shape is what lets the audit log emit a per-step event with a stable schema.

---

### Task 9 — `packages/integrations/nango` — broker client + connection storage

**Scope:** Nango is the M2 OAuth broker for the 3 PBX vendors and the planned broker for Nylas/Slack/Teams in M3. Get the abstraction right now.

**Files touched:**

- `packages/integrations/nango/src/`:
  - `client.ts` — Nango SDK wrapper (lazy-init like M1's `getDb()` factory; see ADR 0001 §2)
  - `connections.ts` — `createConnection({ orgId, provider, nangoConnectionId, … })`, `listConnections({ orgId })`, `revokeConnection({ orgId, connectionId })` — all wrap `org_integration_connections` writes inside `withRls`.
  - `frontend.ts` — exports a small client helper that calls Nango Frontend SDK from a Client Component (Nango handles the popup OAuth flow).
  - `types.ts`, `README.md`
- Tests for `connections.ts` (Drizzle integration, can use the same in-memory pattern as M1 audit-log tests).

**Acceptance:**

- `pnpm test --filter @cema/integrations-nango` green.
- A scripted check (`pnpm tsx packages/integrations/nango/scripts/list-configs.ts`) lists Nango provider configs from the Nango dashboard for the org owner.

**Dependencies:** Tasks 5, 6.

**Compliance touchpoints:** Token storage is delegated to Nango's vault — no OAuth refresh/access tokens land in our DB. CLAUDE.md hard rule #1 (no secrets) thus structurally enforced.

**Carry-overs to next month:** Add Nylas, Slack, Teams provider configs in M3 (config-only; the client + table support it already).

---

### Task 10 — Nango provider configs (RingCentral + Dialpad + Zoom Phone)

**Scope:** No code — registration. Create OAuth apps in each vendor's developer portal; register them in Nango with the right scopes; commit the resulting provider config keys to a config file consumed by `packages/integrations/nango` and the UI.

**Files touched:**

- `packages/integrations/nango/src/provider-configs.ts` (registry):
  ```ts
  export const TELEPHONY_PROVIDERS = [
    { id: 'ringcentral', configKey: 'ringcentral', scopes: ['ReadAccounts','ReadCallLog','ReadCallRecording','WebhookSubscriptions'], … },
    { id: 'dialpad',     configKey: 'dialpad',     scopes: ['recordings.read','calls.read','webhooks'], … },
    { id: 'zoom_phone',  configKey: 'zoom-phone',  scopes: ['phone:read','phone:read:admin','phone_recording:read'], … },
  ] as const;
  ```
- `docs/runbooks/nango-onboarding.md` — manual steps for the owner; Connor or a future ops engineer follows this to provision a new tenant's OAuth apps.

**Acceptance:** Each provider key resolves to a working sandbox connection from Nango's "Try OAuth" UI.

**Dependencies:** Task 9.

**Compliance touchpoints:** Scopes are minimum-viable per spec §8.4 messaging principle ("minimum viable permission scopes").

---

### Task 11 — `packages/integrations/ringcentral` — client + types + sync helpers

**Scope:** Thin REST client around `https://platform.ringcentral.com`. Auth via Nango (`nango.proxy()` issues calls with the broker-managed token). Only the endpoints M2 needs:

- `GET /restapi/v1.0/account/~/extension/~/call-log/{callId}`
- `GET /restapi/v1.0/account/~/recording/{recordingId}/content` (returns redirect to media URL)
- `POST /restapi/v1.0/subscription` (webhook subscription registration)

**Files touched:**

- `packages/integrations/ringcentral/src/{client,types,sync,webhook}.ts`
- `README.md`
- Tests with MSW for vendor responses.

**Acceptance:** Unit tests cover happy paths; one negative-path test asserts the 401 → "reconnect" error class.

**Dependencies:** Task 9.

**Compliance touchpoints:** none direct.

---

### Task 12 — `/api/webhooks/ringcentral` route + signature verification

**Scope:** Vercel Function (Node runtime, not Edge — needs Node crypto for HMAC). Verifies the `Verification-Token` header against `RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN`, validates the payload shape with Zod, dedupes via Upstash Redis `SETNX telephony:idempo:<vendor_event_id> EX 86400`, looks up the matching `org_integration_connections.external_account_id` → `organization_id`, and publishes to `telephony.call.ingest`. Returns 200 within ≤ 2 s regardless of downstream.

**Files touched:**

- `apps/web/app/api/webhooks/ringcentral/route.ts`
- Helpers in `packages/integrations/ringcentral/src/webhook.ts`
- Test in `apps/web/tests/integration/webhook-to-db.test.ts` (Task 26 covers cross-vendor; this one has its own unit test of the route handler).

**Acceptance:**

- Unit test posts a synthetic webhook with valid token → asserts `publish()` called with expected payload + 200 response.
- Same body posted twice → second call short-circuits at dedupe and emits no queue message.

**Dependencies:** Tasks 5, 6, 8, 9, 11.

**Compliance touchpoints:** Hard rule #3 — the webhook body is logged with `redactPii` (vendor payloads occasionally contain caller names + phones). Audit event `telephony.webhook.received` emitted post-dedupe.

---

### Task 13 — `packages/integrations/dialpad` + webhook route

**Scope:** Same shape as Tasks 11 + 12, adapted to Dialpad's webhook signing scheme (HMAC-SHA256 of body using `DIALPAD_WEBHOOK_SIGNING_SECRET`). Dialpad's `call.ended` event carries the recording URL inline, which simplifies the workflow (no `GET /recording` step needed for Dialpad).

**Files touched:**

- `packages/integrations/dialpad/src/{client,types,sync,webhook}.ts` + `README.md`
- `apps/web/app/api/webhooks/dialpad/route.ts`
- Tests.

**Acceptance:** Same as Task 12, with Dialpad-shaped fixtures.

**Dependencies:** Tasks 5, 6, 8, 9.

---

### Task 14 — `packages/integrations/zoom-phone` + webhook route

**Scope:** Same shape, with Zoom's specific quirks: webhooks signed via `ZOOM_WEBHOOK_SECRET_TOKEN` + URL validation challenge handshake. The route handler returns `200 { plainToken, encryptedToken }` on the `endpoint.url_validation` event and follows the standard pipeline for everything else.

**Files touched:**

- `packages/integrations/zoom-phone/src/{client,types,sync,webhook}.ts` + `README.md`
- `apps/web/app/api/webhooks/zoom-phone/route.ts`
- Tests.

**Acceptance:** Validation handshake works; `recording_completed` event publishes to queue.

**Dependencies:** Tasks 5, 6, 8, 9.

---

### Task 15 — `packages/integrations/twilio` — outbound dial + TwiML builder

**Scope:** Two functions:

1. `initiateOutboundCall({ orgId, fromPartyId, toE164, dealId, recordingDisclosure: 'two_party' })`:
   - Builds a TwiML response URL pointing at `/api/twiml/outbound/<communicationId>`.
   - Calls `POST https://api.twilio.com/2010-04-01/Accounts/{Sid}/Calls.json` with `From=TWILIO_OUTBOUND_NUMBER`, `To=<e164>`, `Url=<twiml-url>`, `Record=record-from-answer-dual`, `RecordingStatusCallback=TWILIO_STATUS_CALLBACK_URL`, `RecordingStatusCallbackMethod=POST`, `RecordingChannels=dual`.
   - Pre-creates the `communications` row with `status='pending'` and `direction='outbound'` so the recording callback has somewhere to land.
2. `buildOutboundTwiml({ communicationId, calleeIsBorrower })` produces:
   ```xml
   <Response>
     <Say voice="Polly.Joanna">This call is being recorded by …</Say>
     <Pause length="1"/>
     <Dial recordingStatusCallback="…" record="record-from-answer-dual">
       <Number>{toE164}</Number>
     </Dial>
   </Response>
   ```
   Disclosure script copy lives in `packages/integrations/twilio/src/disclosure.ts` (separate file so Legal can review one location).

**Files touched:**

- `packages/integrations/twilio/src/{client,twiml,disclosure,types}.ts`
- `apps/web/app/api/twiml/outbound/[id]/route.ts` (serves TwiML in response to Twilio's GET on the call)
- Tests with `twilio` mock.

**Acceptance:**

- Unit tests assert recording is enabled (`record="record-from-answer-dual"`) and disclosure preamble appears before `<Dial>` — disabling either is the entire compliance failure mode.
- `<Say>` text matches the canonical NY two-party-consent script signed off by Legal (placeholder for design partner counsel; Connor reviews the text inline).

**Dependencies:** Tasks 4.

**Compliance touchpoints:** Hard rule #5 (recording disclosure). Hard rule #4 deferred to the server action in Task 17 (which checks TCPA opt-in before calling `initiateOutboundCall` if the callee is a borrower).

---

### Task 16 — `/api/webhooks/twilio` recording-status callback

**Scope:** Verifies the `X-Twilio-Signature` header (HMAC-SHA1 of URL + sorted params using `TWILIO_AUTH_TOKEN`), then publishes to the same `telephony.call.ingest` queue with `provider='twilio'`. Twilio's payload contains `RecordingUrl`, `RecordingSid`, `CallSid`, `CallDuration`, `RecordingStatus`.

**Files touched:**

- `apps/web/app/api/webhooks/twilio/route.ts`
- `packages/integrations/twilio/src/webhook.ts` (signature verification helper)
- Tests.

**Acceptance:** Signature verification rejects forged bodies; valid `recording-status=completed` enqueues; `recording-status=in-progress` no-ops (we only ingest on completion).

**Dependencies:** Tasks 5, 6, 8, 15.

**Compliance touchpoints:** Audit event `telephony.recording.callback_received`.

---

### Task 17 — Click-to-call server action + UI button + TCPA guard

**Scope:** End-to-end UX glue. A button on `/deals/[id]` opens a small modal "Call <party name> at <phone>" with a "Record this call" toggle pre-checked-and-disabled (no opt-out — hard rule #5). On submit, server action `initiateOutboundCall` runs:

1. Resolves party from `dealId + partyId`.
2. If `party.role ∈ ('borrower','co_borrower')`, calls `tcpaGuard(party)` which throws `TcpaConsentMissingError` unless `party.tcpa_opt_in = true AND tcpa_opt_in_at IS NOT NULL`. Servicer-role parties skip the guard (B2B; spec §10.2).
3. Calls a DNC placeholder `dncGuard(party)` that currently no-ops behind a `FEATURE_DNC_CHECK_ENABLED=false` flag (Phase 3 wires Gryphon).
4. Calls `packages/integrations/twilio` `initiateOutboundCall(...)`.
5. Pre-creates `communications` row inside `withRls(orgId, …)` and emits audit events `communication.outbound.initiated` + `compliance.consent.disclosed`.

**Files touched:**

- `apps/web/components/click-to-call-button.tsx` (Client Component)
- `apps/web/lib/actions/initiate-outbound-call.ts` (Server Action)
- `apps/web/lib/compliance/tcpa-guard.ts`, `apps/web/lib/compliance/dnc-guard.ts`
- Tests in `apps/web/lib/actions/initiate-outbound-call.test.ts` covering: borrower-without-opt-in throws; servicer-without-opt-in succeeds; non-call-recording attempt is impossible (button toggle is disabled in HTML, server enforces).

**Acceptance:**

- Throws on missing TCPA opt-in (test asserts custom error class).
- Audit log contains both events post-call.
- Manual e2e against Twilio test creds places a call to a personal phone, plays disclosure, records.

**Dependencies:** Tasks 3, 4, 6, 15.

**Compliance touchpoints:** Hard rules #4 + #5. The single most compliance-sensitive task this month — request `legal:compliance-check` skill before starting.

---

### Task 18 — `packages/integrations/deepgram` — batch transcription client

**Scope:** Two operations:

1. `submitBatch({ audioUrl, model: 'nova-3-general', callbackUrl, options: { punctuate: true, diarize: true, smart_format: true, paragraphs: true } })` → submits to `POST https://api.deepgram.com/v1/listen?callback=<url>` and returns `{ requestId }`.
2. `parseTranscriptResponse(deepgramJson)` → normalized `{ language, words: [{text, start, end, speaker}], paragraphs: [...], confidence }`.

**Files touched:**

- `packages/integrations/deepgram/src/{client,types,parse}.ts`
- Tests using a fixture transcript JSON checked into `packages/integrations/deepgram/fixtures/`.

**Acceptance:**

- Submit returns the requestId from a mocked response.
- Parse normalizes a real Deepgram response correctly (use a Deepgram docs sample as fixture).

**Dependencies:** none direct, but Tasks 19 and 20 depend on it.

**Compliance touchpoints:** Deepgram is a sub-processor — `legal:vendor-check` before merge to confirm DPA terms cover PII (call audio inherently contains PII).

---

### Task 19 — `/api/webhooks/deepgram` callback handler

**Scope:** Receives Deepgram's POST when batch transcription completes. Looks up the `recordings` row by `deepgram_request_id` (stored from Task 18 submit), parses the transcript, uploads JSON to Blob as `recordings/<id>/transcript.json`, updates `recordings.transcript_blob_url + transcript_words_count + transcript_language + transcript_provider`, and flips `communications.status='ready'`. Emits audit `communication.transcript.ready`.

**Files touched:**

- `apps/web/app/api/webhooks/deepgram/route.ts`
- `packages/integrations/deepgram/src/webhook.ts` (verifies request comes from Deepgram via `Deepgram-Signature` header)

**Acceptance:** Test with synthetic Deepgram callback → asserts transcript row updated + audit event present.

**Dependencies:** Tasks 4, 7, 18.

**Compliance touchpoints:** Audit log on transcript materialization (covers the spec §6.8 list "communication recording" event).

---

### Task 20 — `telephony.call.ingest` workflow (Vercel Workflow DevKit)

**Scope:** The orchestrator. Each step is a separately-retried function with idempotent semantics. Use `vercel:workflow` skill for the WDK API surface — the team is new to WDK and the docs evolve.

Workflow signature: `(orgId, provider, vendorCallId, vendorEventId, vendorPayload) → void`.

Steps (each `step.run("<name>", async () => …)`):

1. `fetch-vendor-call-meta` — Call vendor REST to get duration, parties, recording media URL. Skipped for Twilio (payload is complete).
2. `download-recording` — Stream the media file from the vendor URL. Returns a temp readable stream (Vercel Functions tmpfs).
3. `upload-to-blob` — `packages/blob` `putRecording(...)`. Returns `{ url, pathname, bytes }`.
4. `upsert-communications-row` — Inside `withRls(orgId, …)`: idempotent upsert keyed on `(provider, vendor_call_id)`. Sets `status='ingested'`.
5. `create-recording-row` — Inside `withRls`: insert into `recordings` with `retention_until = now() + interval '7 years'`.
6. `emit-audit-recording-ingested`.
7. `deepgram-submit-batch` — Calls `packages/integrations/deepgram` `submitBatch` with `recordings.recording_blob_url` (via short-lived signed URL).
8. `mark-transcribing` — `communications.status='transcribing'`.

The Deepgram callback handler (Task 19) drives the final `ready` transition; the workflow ends after step 8.

**Files touched:**

- `packages/workflows/src/telephony/call-ingest.workflow.ts`
- `packages/workflows/src/telephony/call-ingest.workflow.test.ts` (test each step in isolation; full workflow integration covered by Task 26).

**Acceptance:**

- All steps unit-testable via WDK's `runWorkflow()` test harness.
- Re-running a step is a no-op (idempotency by `vendor_event_id` everywhere).

**Dependencies:** Tasks 4–8, 11, 13, 14, 16, 18.

**Compliance touchpoints:** Audit event per step. Spec §12.4 "Workflow durability: zero-loss across deploys" honored by WDK.

---

### Task 21 — Wire the Vercel Queue consumer to the workflow

**Scope:** A Vercel Function (or WDK trigger) that consumes `telephony.call.ingest` and invokes the workflow. Single file; mostly glue.

**Files touched:**

- `apps/web/app/api/internal/queue/telephony-call-ingest/route.ts` (the queue consumer endpoint; protected by a shared-secret header `X-Vercel-Queue-Secret` rotated via env)
- `packages/queues/src/consume.ts` (typed handler wrapper)

**Acceptance:** Unit test simulates queue delivery → asserts workflow invocation. Integration covered by Task 26.

**Dependencies:** Tasks 8, 20.

---

### Task 22 — UI: Org telephony connection page (`/settings/integrations/telephony`)

**Scope:** Lists the 3 supported providers as cards; "Connect" button opens the Nango Frontend popup; after success, a server action `createTelephonyConnection({ provider, nangoConnectionId })` persists a row. Shows existing connections with status, last sync time, and a "Disconnect" action.

**Files touched:**

- `apps/web/app/(app)/settings/integrations/telephony/page.tsx` (RSC)
- `apps/web/components/telephony-connection-card.tsx` (Client)
- `apps/web/lib/actions/create-telephony-connection.ts`
- `apps/web/lib/actions/revoke-telephony-connection.ts`
- Tests for both actions.

**Acceptance:** Manual flow: click Connect on RingCentral card → Nango popup completes → DB row appears → card flips to "Connected".

**Dependencies:** Tasks 5, 9, 10.

**Compliance touchpoints:** Audit events `integration.connection.created` + `integration.connection.revoked`.

---

### Task 23 — UI: Communications list per Deal

**Scope:** `/deals/[id]/communications` server component. Lists calls in reverse chronological order with: direction icon, provider badge, from/to E.164 (or party name if resolved), duration, status pill (`pending | ingested | transcribing | ready | failed`), `started_at` formatted via `Intl.DateTimeFormat`. Empty-state UX from `design:ux-copy` skill.

**Files touched:**

- `apps/web/app/(app)/deals/[id]/communications/page.tsx`
- `apps/web/components/communication-card.tsx`
- `apps/web/lib/actions/list-communications.ts`
- Tests.

**Acceptance:** Renders deterministically from a seeded dev DB; e2e test in Task 26 hits this page.

**Dependencies:** Tasks 4, 6.

---

### Task 24 — UI: Communication detail (audio player + transcript viewer)

**Scope:** `/deals/[id]/communications/[c]` server component. Fetches communication + recording + signed audio URL (1-hour TTL, refreshed on each page load). Renders:

- Audio player (`<audio controls>` + a thin `apps/web/components/audio-scrubber.tsx` for timestamp jumps).
- Transcript viewer (`apps/web/components/transcript-viewer.tsx`) — paragraphs grouped by speaker, click-to-seek into audio (set `audio.currentTime` from word start). Use `vercel:ai-elements` `Message` / `Reasoning` patterns where they fit.
- Metadata panel: provider, parties, duration, started_at, consent disclosure timestamp.
- Placeholder card "AI summary — coming in Phase 1".

**Files touched:**

- `apps/web/app/(app)/deals/[id]/communications/[c]/page.tsx`
- `apps/web/components/audio-scrubber.tsx`, `apps/web/components/transcript-viewer.tsx`
- `apps/web/lib/actions/get-communication.ts`
- Tests.

**Acceptance:** Renders for a seeded recording; e2e in Task 26 asserts transcript words visible.

**Dependencies:** Tasks 4, 6, 7.

**Compliance touchpoints:** Audit `pii.accessed` event emitted whenever a transcript is fetched (the transcript contains PII per hard rule #3).

---

### Task 25 — Integration test: cross-org Communications RLS isolation

**Scope:** Same shape as M1's `withrls-enforcement.test.ts` but for `communications` and `recordings`. Insert as Org A, assert invisibility under Org B's `withRls`.

**Files touched:**

- `apps/web/tests/integration/communications-rls.test.ts`

**Acceptance:** Three assertions: (1) Org B cannot SELECT Org A's communications; (2) cannot UPDATE; (3) cannot DELETE. All three rely on the M1 `cema_app_user` role downgrade in `withRls`.

**Dependencies:** Task 6.

**Compliance touchpoints:** Multi-tenancy hard guarantee.

---

### Task 26 — Integration test: end-to-end webhook → DB happy path (mocked vendors)

**Scope:** One of three vendors (RingCentral chosen for breadth — its flow has all the steps including the separate recording fetch). Test:

1. POST `/api/webhooks/ringcentral` with synthetic signed body.
2. Mock Nango proxy responses for the `GET /call-log` and `GET /recording/content` calls.
3. Mock `@vercel/blob` to capture the upload bytes.
4. Mock Deepgram `submitBatch` to return a fake request id.
5. Run the WDK workflow inline.
6. Assert `communications` row exists with `status='transcribing'`, `recordings` row exists, signed audio URL works, 3 audit events emitted.
7. Simulate Deepgram callback → assert `status='ready'`.

**Files touched:**

- `apps/web/tests/integration/webhook-to-db.test.ts`
- Fixtures under `apps/web/tests/fixtures/ringcentral/`.

**Acceptance:** Passes against the dev Neon branch with all external services mocked. Run time < 30 s.

**Dependencies:** Tasks 11, 12, 18, 19, 20, 21.

---

### Task 27 — ADR 0002 + runbook + CLAUDE.md status update

**Scope:** Phase-end deliverable. Mirror ADR 0001's structure: "What shipped", "Architectural decisions", "Plan-vs-reality divergences", "Type-design investment", "Consequences (positive / negative)", "Carry-overs to M3", "References".

**Files touched:**

- `docs/adr/0002-phase-0-month-2-telephony.md` (new)
- `docs/runbooks/telephony-incident-triage.md` (new) — "a webhook is failing, how do I triage?" + "a recording wasn't transcribed, how do I retry?"
- `docs/runbooks/nango-onboarding.md` (modified in Task 10)
- `CLAUDE.md` §2 — update Phase status: "Phase 0 Month 2 complete; Month 3 in progress (email + calendar)".

**Acceptance:** ADR reviewed in PR; CLAUDE.md status reflects M2 closure.

**Dependencies:** Tasks 1–26 merged.

**Compliance touchpoints:** Update CLAUDE.md changelog row.

---

### Task 28 — Vercel project env var sync + production deploy verification

**Scope:** Bring all the new env vars into Vercel preview + production environments via `vercel env`. Trigger a production deploy on `main` and run a smoke test: connect a real RingCentral sandbox org → place a test call → see it land in the workspace. If Vercel preview was broken from M1 carry-over (see §8 Risks), the production deploy is the validation path.

**Files touched:**

- `.env.example` (final state with all M2 vars documented; values omitted)
- No code changes otherwise.

**Acceptance:** Production deploy green; smoke test verified manually; screenshot attached to PR description for the audit trail.

**Dependencies:** Tasks 1–27.

**Compliance touchpoints:** `legal:vendor-check` for Twilio, Deepgram, Nango DPAs (one-time vendor diligence; hard rule #12).

---

## 7. Phase-end Deliverables Summary

1. **ADR `docs/adr/0002-phase-0-month-2-telephony.md`** — what shipped, divergences, trade-offs, M3 carry-overs.
2. **Runbooks** — `docs/runbooks/telephony-incident-triage.md`, `docs/runbooks/nango-onboarding.md`.
3. **CLAUDE.md §2 status update** + changelog row.
4. **Spec §16.I integration catalog rows** — verify RingCentral, Dialpad, Zoom Phone, Twilio, Deepgram, Nango all marked ✓ and dated.
5. **Test count target:** ~85 unit + 3 integration (existing 2 + new 2; M1 had 59 unit + 2 integration).
6. **Migration count:** 0003–0009 applied across dev + preview + prod Neon branches.
7. **Vercel Marketplace add-ons** provisioned + billing reviewed against §12.5 cost model (call out telephony budget envelope).

---

## 8. Risks

1. **Vercel preview deploys may still be broken** (carry-over from M1 §"Negative / accepted trade-offs"; not in the documented carry-overs but reported in M2 brief). Mitigation: validate end-to-end locally + via PR CI (lint/typecheck/test/build/e2e). Production deploy at Task 28 doubles as the canonical environment check. If preview is fixed mid-month, retro-validate the M2 PRs in their previews.

2. **Twilio TCPA exposure on borrower outbound.** Despite the TCPA guard in Task 17, a bug that bypasses it could call a borrower without opt-in. Mitigation: in addition to the runtime guard, the click-to-call modal hides the "Call" button entirely when `party.role ∈ borrower-set AND tcpa_opt_in=false`. UI-layer defense in depth.

3. **Deepgram cost per minute.** Nova-3 batch is ~$0.0043 / min. 1,000 deals/yr × ~6 servicer calls/deal × ~7 min/call ≈ 42k call-minutes/yr ≈ $180/yr per client — comfortably within the §12.5 envelope. M3 voice agent (Phase 3) will balloon this; budget alarm at $500/mo per tenant in `vercel:observability` setup.

4. **Vendor webhook signature schemes vary** (RingCentral verification-token header, Dialpad HMAC-SHA256, Zoom URL-validation handshake + signed token, Twilio HMAC-SHA1 of URL+sorted-params, Deepgram custom header). Mitigation: per-vendor unit tests against documented signature examples from each provider's docs (`context7` for fresh docs).

5. **Webhook → workflow latency unbounded by vendor.** Some PBX vendors send the `recording_completed` event minutes after `call.ended`. UI must surface `status='pending' | 'ingested' | 'transcribing'` accurately so processors don't think the system dropped the call. Mitigation: the `communication-card.tsx` shows the status pill prominently; a Phase 1 cron checks for stuck-in-transcribing > 10 min and re-submits to Deepgram.

6. **Nango free tier limits.** 3 connections × N orgs may exceed free-tier limits at scale. Mitigation: stay on free tier through M2 (single internal test org); upgrade to Pro before onboarding the design partner in M3.

7. **`packages/blob` legal-hold metadata** lives in Postgres `recordings.legal_hold` rather than Blob-side. A direct Blob delete via the Vercel dashboard or API can bypass the application-level guard. Mitigation: document this in the runbook; Phase 1 evaluates moving to a Blob with object-lock semantics (CallCabinet vault is the eventual answer per spec §16.I).

8. **Recording disclosure script** is product-counsel sensitive. Mitigation: keep the canonical text in one file (`packages/integrations/twilio/src/disclosure.ts`); flag changes to it as compliance-blocking in CODEOWNERS.

---

## 9. Open Questions (resolve before Task 1 dispatch)

1. **Twilio outbound DID:** buy from Vercel Marketplace add-on or directly from Twilio? Marketplace billing simplifies AP; direct Twilio gives finer control over number provisioning. Connor's call.

2. **Nango self-hosted vs cloud:** stay on Nango Cloud (free → Pro) or self-host the OSS open-source build? Cloud is faster to ship; self-host avoids a vendor for the OAuth broker (the spec lists Nango ✓ but not the deployment model). Recommend Cloud for M2, revisit at design-partner go-live.

3. **`telephony_provider` enum vs general `integration_provider` enum:** Task 2 introduces `telephony_provider`. M3 adds `nylas`, `google`, `microsoft`, `slack`, `teams` — should we expand the enum now (forward-looking) or add a separate `email_provider` enum and migrate later? Recommend: keep `telephony_provider` narrow now; in M3 introduce a general `integration_provider` enum on `org_integration_connections.provider` and migrate values. Cheap migration; clearer schemas in the interim.

4. **Deepgram callback vs polling:** callback is faster (push) but requires our hostname to be reachable from Deepgram (it is on Vercel preview/prod, but local dev needs a tunnel). For local dev convenience, allow a `DEEPGRAM_MODE=poll` env to fall back to polling. Recommend implementing both; default callback in preview/prod and poll in local.

5. **Communication ↔ Party resolution:** the M2 webhook flow knows E.164 numbers but doesn't always know which `party` row they map to. For M2, leave `from_party_id` / `to_party_ids` nullable and only set them when an exact phone match exists. M3+ adds the Apache AGE knowledge-graph entity resolution (spec §6.7); call out as known gap in ADR 0002.

6. **Two-party-consent disclosure copy:** the literal `<Say>` text in Task 15 — does Connor's counsel have a preferred phrasing, or do we ship a vendor-neutral default ("This call is being recorded for quality and compliance purposes. By continuing the call, you consent to this recording.")? Recommend default for M2; review during design-partner counsel engagement.

---

## 10. Execution

When ready, dispatch this plan via `superpowers:subagent-driven-development` (one subagent per task, type-design + spec review per task per the M1 pattern, fix-forward on findings, merge via `gh pr merge --admin --squash --delete-branch`).
