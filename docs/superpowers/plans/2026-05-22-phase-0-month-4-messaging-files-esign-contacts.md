# Phase 0 Month 4 — Internal Messaging + Files + eSignature + Contact Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-05-22
**Phase:** 0 (Foundation), Month 4 of 5
**Prior plan:** [2026-05-22-phase-0-month-3-email-calendar.md](./2026-05-22-phase-0-month-3-email-calendar.md)
**Prior ADR:** [0003-phase-0-month-3-email-calendar.md](../../adr/0003-phase-0-month-3-email-calendar.md)

**Spec anchors:** §8.4 (Internal Messaging), §8.6 (Files + eSignature), §8.7 (Contacts & Relationship Graph), §11.1 Month 4 row, §16 (Integration Catalog).

**Goal:** Ship four canonical integrations — Slack (messaging), Google Drive (files), DocuSign (eSignature), and a Postgres-only contact entity-resolution layer — wired into the existing Communications timeline and a new Contacts surface, with cross-org RLS proofs for all eight new tables.

**Architecture:** Mirror the M3 Nylas pattern (verified-webhook → upsert `communications` + a kind-specific extension row → publish to a queue topic for Phase 1 enrichment) for Slack and Drive. DocuSign adds an outbound action (`sendEnvelope`) that is attorney-review-gated. Contacts introduces a canonical `contacts` table plus a `contact_identities` join table; deterministic match on normalized (email, phone) is the only matcher in M4 — ML similarity defers to Phase 1.

**Tech Stack:** Slack `@slack/web-api` + Events API HMAC, Google Drive v3 SDK + push channels, DocuSign eSign v2.1 + Connect HMAC, Drizzle + Neon + Postgres RLS, Vercel Queues for the enrichment hook.

---

## 1. Goal & End State

By the end of M4, the Vercel preview shows the following working against real Neon + real Vercel Blob + sandboxed Slack/Drive/DocuSign grants:

1. A processor in a Slack workspace where the `@cema` bot is installed sees Slack channel messages appear in the per-deal Communications timeline alongside calls + emails + meetings.
2. The slash command `/cema status DEAL-1234` posted in any workspace channel returns an ephemeral message with the deal's status, lender, servicer, and last activity timestamp.
3. When a processor links a Google Drive folder to a deal, every file in that folder is mirrored into Vercel Blob (read-only) and visible in a new per-deal Files tab. Drive push notifications keep the mirror current.
4. When a processor clicks "Send for Signature" on a CEMA-kind document, an attorney-review gate runs first; only documents with `attorney_review_required=false` OR an `AttorneyApproval` event are eligible. DocuSign envelope status (created → sent → delivered → signed → completed) is mirrored back via DocuSign Connect.
5. A new `/contacts` index lists every distinct person the workspace has ever touched (extracted from `parties`, email participants, Slack users, phone E.164 numbers). The Contact detail page shows all merged source identities.
6. RLS is enforced: every M4 table (`org_slack_connections`, `slack_messages`, `org_drive_connections`, `drive_files`, `org_docusign_connections`, `docusign_envelopes`, `contacts`, `contact_identities`) is invisible across organization boundaries.

**Deliverable validation:**

- `pnpm test` passes (unit tests on 4 new integration packages + dedup engine + new actions, all TDD-verified).
- `pnpm test` adds 2 new integration test files: `m4-rls-isolation.test.ts` (8 assertions across the 8 tables) and `contact-dedup-e2e.test.ts` (5 assertions).
- `pnpm typecheck` and `pnpm lint` clean.
- `pnpm build` green.

---

## 2. Hard Non-Goals (out of scope this month)

- **No Microsoft Teams.** Same OAuth gap as M3 Teams Phone — requires Azure Entra app registration. Slack covers the messaging surface for M4. Teams is M5 or Phase 1.
- **No OneDrive / SharePoint / Box / Dropbox / Egnyte.** All depend on vendor OAuth app registration. Google Drive is the canonical file integration this month. Spec §8.6 lists these for completeness; they ship in M5+ as OAuth gets provisioned.
- **No NetDocuments / iManage (law-firm DMS).** Phase 2.
- **No Adobe Acrobat Sign / PandaDoc / Snapdocs / Pavaso / Stavvy.** DocuSign is the canonical eSignature integration this month. RON (Pavaso/Stavvy) is Phase 2 per spec §8.6.
- **No ML similarity matching for ambiguous contact merges.** Only deterministic match on normalized (email, phone) lands in M4. ML-based name/employer-history similarity defers to Phase 1 with Mem0 confidence storage (spec §8.7).
- **No Apache AGE knowledge graph.** Spec §11.1 explicitly owns the AGE graph in M5 (Search + Memory month). M4 ships the lighter `contacts` + `contact_identities` table pair that AGE will later wrap.
- **No Mem0 integration.** Phase 1 — confidence storage for ambiguous merges.
- **No CRM contact pulls (Salesforce, HubSpot, Total Expert, Velocify, Surefire, BNTouch).** All depend on Merge.dev unified API and CRM-specific OAuth. Phase 1+.
- **No phone contact enrichment (Clay / Apollo / ZoomInfo).** Phase 2.
- **No SMS as a messaging surface in M4.** SMS shipped in M2 via Twilio (`communication_medium='sms_twilio'`). No new SMS work here.
- **No WhatsApp Business API.** Phase 1.5 per spec §8.4.
- **No Drive write operations.** Read-only mirror only — Drive remains source-of-truth. No upload-from-CEMA-to-Drive flow.
- **No Reducto IDP for Drive file classification.** Same gap as M3 attachments — requires Reducto account. Phase 1 work.
- **No virus scanning on Drive files.** Spec §8.6 calls for ClamAV in Vercel Sandbox — defer to Phase 1.
- **No DocuSign template creation / management UI.** Templates are configured in DocuSign Admin; M4 ships the envelope-send + status-mirror, not the template authoring surface.
- **No Pavaso / Stavvy / Snapdocs Remote Online Notarization.** Phase 2.
- **No outbound Slack scheduled messages / digests.** Phase 1 with Knock or a cron-driven action.
- **No WDK workflow for async enrichment.** Same gap as M2 + M3 — `@vercel/workflow` still not installed. Queue topics are published for future consumption; no consumer ships in M4.
- **No Vercel env var provisioning + production smoke test.** Requires real `SLACK_*`, `GOOGLE_*`, `DOCUSIGN_*` keys not yet provisioned. Skipped per session rule.
- **No `/settings/integrations/messaging|files|esign` UI.** Depends on Nango OAuth flows being live — same gap shape as M2 Task 22 and M3 Task C. The packages and webhook routes are wired; the connection-management UI lands when OAuth is provisioned.

---

## 3. Architecture Sketch

### 3.1 Slack (messaging)

```
Slack workspace
     │
     │ (bot installed; events subscribed)
     ▼
Slack platform
     │  POSTs /api/webhooks/slack
     │  X-Slack-Signature: v0=HMAC-SHA256(signing_secret, "v0:{ts}:{rawBody}")
     │  X-Slack-Request-Timestamp: {unix-seconds}
     ▼
┌─────────────────────────────────────────────────────────┐
│  POST /api/webhooks/slack/route.ts                      │
│   0. Replay-protect: reject if |now - ts| > 5 minutes  │
│   1. Verify HMAC-SHA256 (SLACK_SIGNING_SECRET)         │
│   2. Branch on payload kind:                            │
│      url_verification → respond { challenge }           │
│      event_callback   → handle message / app_mention    │
│      command          → handle slash command            │
│   3. For message events: resolve team_id → org_id via   │
│      org_slack_connections (neondb_owner, BYPASSRLS)    │
│   4. Upsert communications (kind=slack) + slack_messages│
│   5. Publish to comms.slack.ingest queue (Phase 1 hook) │
│   6. 200 OK                                             │
└─────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Neon Postgres (RLS-enforced via withRls)               │
│   communications  (kind='slack', medium='slack')        │
│   slack_messages  (1:1 via communication_id)            │
│   org_slack_connections (one row per workspace)         │
└─────────────────────────────────────────────────────────┘
```

**Why a single route handles three event shapes?** Slack's URL verification handshake (one-shot challenge response on initial endpoint configuration) shares the path with the event callback and the slash command, all distinguished by payload `type`. Splitting them is the easy refactor when scope grows; M4 keeps them together for simplicity.

### 3.2 Drive (files)

```
Google Drive
     │
     │ (file change in watched folder)
     ▼
Google push channel
     │  POSTs /api/webhooks/drive
     │  X-Goog-Channel-Id: {channel-uuid}
     │  X-Goog-Channel-Token: {hex-secret matched against channel record}
     │  X-Goog-Resource-State: sync|update|exists|trash|untrash|change
     │  (body is empty)
     ▼
┌─────────────────────────────────────────────────────────┐
│  POST /api/webhooks/drive/route.ts                      │
│   1. Match channel_id → org_drive_connections row       │
│      (token equality is the auth gate; no HMAC because  │
│       Google does not sign these notifications)         │
│   2. Branch on resource_state:                          │
│      sync      → 200 OK (initial subscribe handshake)   │
│      exists    → fetch file metadata via Drive API      │
│      update    → upsert drive_files row + Blob mirror   │
│      trash     → soft-delete drive_files row            │
│   3. For new/changed files: download bytes → blobPut() │
│   4. 200 OK                                             │
└─────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Vercel Blob + Neon                                     │
│   drive_files  (drive_file_id, blob_pathname, mime, …)  │
│   org_drive_connections (one row per linked Drive acct) │
└─────────────────────────────────────────────────────────┘
```

**Why channel-token equality instead of HMAC?** Google does not sign push notifications — the only authentication primitive available is the `channel.token` value the caller chooses when subscribing. We store a random hex token in `org_drive_connections.channel_token` and reject any inbound notification whose `X-Goog-Channel-Token` header doesn't match. This is the documented Google pattern.

**Why mirror into Blob instead of streaming on read?** Two reasons. (1) Drive's signed-URL TTL is at most 1 hour; presenting a 5-minute-old link to a processor is fragile. (2) Phase 1 IDP requires durable bytes for Reducto classification; the mirror is the natural home. Drive remains the canonical source; the mirror is read-only from CEMA's side.

### 3.3 DocuSign (eSignature)

```
CEMA app                                            DocuSign platform
   │                                                       │
   │ (1) processor clicks "Send for Signature" on doc      │
   │     → server action sendEnvelope()                    │
   │                                                       │
   │ (2) attorney-review gate (hard rule #2)               │
   │     If doc.attorney_review_required = true            │
   │     AND no AttorneyApproval event:                    │
   │     throw AttorneyReviewMissingError                  │
   │                                                       │
   │ (3) POST /restapi/v2.1/accounts/{accountId}/envelopes │
   │ ─────────────────────────────────────────────────────►│
   │                                                       │
   │ (4) Envelope created; status='sent'                   │
   │ ◄─────────────────────────────────────────────────────│
   │                                                       │
   │ (5) Insert docusign_envelopes row + audit event       │
   │                                                       │
   │ (... time passes; recipient signs ...)                │
   │                                                       │
   │                          (6) DocuSign Connect POSTs   │
   │                          /api/webhooks/docusign       │
   │                          X-DocuSign-Signature-1: hex  │
   │                                                       │
   │ (7) Verify HMAC-SHA256(connect_secret, rawBody)       │
   │ (8) Update docusign_envelopes row + audit event       │
   │ (9) Update documents.status if envelope completed     │
   │                                                       │
   ▼                                                       │
Neon Postgres                                              │
 docusign_envelopes (status, recipients_jsonb, …)          │
 org_docusign_connections                                  │
 audit_events (envelope.created, envelope.completed, …)    │
```

**Why is `sendEnvelope` a server action, not an inline call from the UI?** Server actions run with full org context (Clerk-authenticated, RLS-bound to the user's org). The attorney-review gate must run server-side; trusting client code to enforce it would violate hard rule #2 in CLAUDE.md. The action also writes the audit event, which must be neondb_owner-scoped (audit events are immutable, see migration 0003).

### 3.4 Contacts (entity resolution)

```
Source identifiers (all org-scoped)
   ┌─ parties.email ───────────────────────────┐
   │                                            │
   ├─ parties.phone ──────────────────────────► contact_identities
   │                                            │  (one row per source ID)
   ├─ email_threads.from_email ────────────────┤   kind ∈ {email, phone, slack_user}
   │                                            │   normalized_value (unique per org)
   ├─ email_threads.to_participants[].email ───┤   source ∈ {party, comm_from, comm_to,
   │                                            │             slack_message, manual}
   ├─ communications.from_e164 ────────────────┤   source_id (UUID of source row)
   │                                            │   confidence (1.0 for deterministic)
   ├─ communications.to_e164 ──────────────────┤
   │                                            │
   └─ slack_messages.author_slack_user_id ─────┘
                                                │
                                                ▼
                                          contacts
                                          (canonical entity per real person)
                                            id (uuid)
                                            organization_id
                                            primary_name
                                            primary_email
                                            primary_phone
                                            metadata jsonb
```

**Dedup algorithm (M4 only deterministic, ML deferred):**

```
ensureContact({ orgId, kind, value, source, sourceId }) →
    normalize(kind, value)
    SELECT contact_id FROM contact_identities
      WHERE organization_id = orgId
        AND kind = $kind
        AND normalized_value = $normalized
      LIMIT 1
    if found:
        ensure (kind, normalized) → contact_id identity row exists with the new (source, sourceId)
        return contact_id
    else:
        INSERT INTO contacts (organization_id, primary_<kind>) VALUES (orgId, value)
          RETURNING id
        INSERT INTO contact_identities (contact_id, organization_id, kind, normalized_value,
                                        source, source_id, confidence)
        return contact_id
```

**Normalization rules (locked in M4):**

- `email`: trim, lowercase, strip `+suffix` aliases (`bob+notes@example.com` → `bob@example.com`).
- `phone`: parse to E.164 assuming US `+1` country code if the input has 10 digits and no `+` prefix; reject invalid inputs.
- `slack_user`: lowercase Slack user ID (`U01234567` → `u01234567`); team-prefixed so the same letters across workspaces don't collide.

**Why one canonical `primary_*` column per kind instead of a single `primary_identifier`?** Querying "find me the contact with email X" is the dominant access pattern, and a typed column hits the right partial index. JSONB or polymorphic shapes would force a CAST or a function index that's slower for the same lookup.

**Manual-merge UI:** A processor can move identities between contacts via a "Merge into..." action. The action does an UPDATE on `contact_identities.contact_id`, never deletes; the orphaned contact row is GC'd by a follow-up job (Phase 1). M4 lets the orphan stay — it's a tiny row.

---

## 4. Pre-flight / Dependencies

### 4.1 Packages to add to workspace

```
packages/integrations/slack/      # Slack Web API + Events API HMAC + payload parsing
packages/integrations/drive/      # Google Drive v3 SDK wrapper + watch channel mgmt
packages/integrations/docusign/   # DocuSign eSign v2.1 + Connect HMAC + envelope client
packages/contacts/                # Dedup engine — normalize + match + ensureContact
```

All four follow the M2/M3 layout: `client.ts`, `types.ts`, `webhook.ts` (where applicable), `index.ts`, colocated `*.test.ts`.

### 4.2 npm packages to install

```bash
# Slack
pnpm --filter @cema/integrations-slack add @slack/web-api
pnpm --filter @cema/integrations-slack add -D @types/node

# Drive
pnpm --filter @cema/integrations-drive add googleapis
pnpm --filter @cema/integrations-drive add -D @types/node

# DocuSign
pnpm --filter @cema/integrations-docusign add docusign-esign
pnpm --filter @cema/integrations-docusign add -D @types/node

# Contacts — no SDK; only libphonenumber-js for E.164 parsing
pnpm --filter @cema/contacts add libphonenumber-js
```

### 4.3 Env vars (add to `.env.example`; do NOT commit values)

```
# Slack
SLACK_SIGNING_SECRET=...        # Slack signing secret (Events API HMAC)
SLACK_BOT_TOKEN=xoxb-...        # Bot token (used for chat.postMessage replies)
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...

# Google Drive
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_DRIVE_WEBHOOK_URL=https://app.cema.example/api/webhooks/drive

# DocuSign
DOCUSIGN_ACCOUNT_ID=...
DOCUSIGN_INTEGRATION_KEY=...
DOCUSIGN_USER_ID=...
DOCUSIGN_PRIVATE_KEY=...        # RSA private key for JWT auth
DOCUSIGN_CONNECT_SECRET=...     # HMAC secret for Connect webhooks
DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi  # demo for dev; account-specific in prod

# Vercel Queues (new topics)
VERCEL_QUEUE_SLACK_TOPIC=comms.slack.ingest
VERCEL_QUEUE_DRIVE_TOPIC=files.drive.ingest
VERCEL_QUEUE_DOCUSIGN_TOPIC=esign.docusign.events
```

### 4.4 Skipped provisioning tasks

| Task                                                                  | Reason                                 |
| --------------------------------------------------------------------- | -------------------------------------- |
| Slack App creation (api.slack.com) — bot, signing secret, scopes      | Requires Slack account — skip per rule |
| Google Cloud OAuth app for Drive — scopes drive.readonly + drive.file | Requires GCP project — skip            |
| DocuSign Developer Sandbox + Integration Key + RSA keypair            | Requires DocuSign account — skip       |
| Nango provider configs for Slack/Drive/DocuSign                       | Depends on the above — skip            |
| `SLACK_*` / `GOOGLE_*` / `DOCUSIGN_*` env vars in Vercel              | Requires real keys — skip              |

---

## 5. File Map

### New files

```
packages/integrations/slack/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── types.ts
    ├── webhook.ts             + webhook.test.ts
    ├── client.ts              + client.test.ts

packages/integrations/drive/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── types.ts
    ├── client.ts              + client.test.ts
    ├── webhook.ts             + webhook.test.ts

packages/integrations/docusign/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── types.ts
    ├── webhook.ts             + webhook.test.ts
    ├── client.ts              + client.test.ts

packages/contacts/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── normalize.ts           + normalize.test.ts
    ├── dedup.ts               + dedup.test.ts

packages/db/src/schema/
├── slack-connections.ts       (new)
├── slack-messages.ts          (new)
├── drive-connections.ts       (new)
├── drive-files.ts             (new)
├── docusign-connections.ts    (new)
├── docusign-envelopes.ts      (new)
├── contacts.ts                (new)

packages/db/migrations/
├── 0017_slack_connections.sql
├── 0018_slack_messages.sql
├── 0019_drive_connections.sql
├── 0020_drive_files.sql
├── 0021_docusign_connections.sql
├── 0022_docusign_envelopes.sql
├── 0023_contacts.sql
├── 0024_rls_m4.sql

apps/web/
├── lib/actions/
│   ├── list-slack-messages.ts           + list-slack-messages.test.ts
│   ├── get-slack-message.ts             + get-slack-message.test.ts
│   ├── list-drive-files.ts              + list-drive-files.test.ts
│   ├── send-envelope.ts                 + send-envelope.test.ts
│   ├── list-envelopes.ts                + list-envelopes.test.ts
│   ├── get-envelope.ts                  + get-envelope.test.ts
│   ├── list-contacts.ts                 + list-contacts.test.ts
│   ├── get-contact.ts                   + get-contact.test.ts
│   └── merge-contacts.ts                + merge-contacts.test.ts
├── lib/contacts/
│   ├── backfill.ts                      + backfill.test.ts
├── components/
│   ├── slack-message-card.tsx
│   ├── drive-file-card.tsx
│   ├── envelope-status-card.tsx
│   ├── send-for-signature-button.tsx
│   ├── contact-card.tsx
│   ├── contact-detail.tsx
│   └── party-resolution-sidebar.tsx
├── app/api/webhooks/slack/route.ts      + route.test.ts
├── app/api/webhooks/drive/route.ts      + route.test.ts
├── app/api/webhooks/docusign/route.ts   + route.test.ts
├── app/(app)/contacts/page.tsx
├── app/(app)/contacts/[id]/page.tsx
├── app/(app)/deals/[id]/files/page.tsx
└── tests/integration/
    ├── m4-rls-isolation.test.ts
    └── contact-dedup-e2e.test.ts
```

### Modified files

```
packages/db/src/schema/index.ts                            (+7 exports)
packages/queues/src/topics.ts                              (+3 topics)
apps/web/package.json                                      (+4 workspace deps)
apps/web/app/(app)/deals/[id]/communications/page.tsx      (render SlackMessageCard in timeline)
apps/web/app/(app)/deals/[id]/communications/[c]/page.tsx  (kind=slack → SlackMessageCard detail)
apps/web/app/(app)/deals/[id]/page.tsx                     (add Files tab + Envelopes tab)
apps/web/components/sidebar.tsx                            (add Contacts nav item)
.env.example                                               (+13 env vars)
CLAUDE.md                                                  (Section 2 close-out)
```

---

## 6. Tasks

The 33 tasks are grouped into 5 logical batches. Each can be its own PR, or all 33 can ship under a single `feat/m4-messaging-files-esign-contacts` branch following the M3 pattern. Either way, commit per-task with the task number in the message.

### Subsystem 1 — Slack (Tasks 1–8)

---

### Task 1: DB — `org_slack_connections` table (migration 0017)

**Files:**

- Create: `packages/db/src/schema/slack-connections.ts`
- Create: `packages/db/migrations/0017_slack_connections.sql`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// packages/db/src/schema/slack-connections.ts
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { organizations, users } from './tenants';

export const orgSlackConnections = pgTable(
  'org_slack_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // Slack team (workspace) ID — Tnnnnnnnn. Globally unique across Slack.
    slackTeamId: varchar('slack_team_id', { length: 32 }).notNull(),
    slackTeamName: varchar('slack_team_name', { length: 256 }),
    // Bot token from the OAuth install — xoxb-... Stored encrypted in
    // Phase 2 (customer-managed keys); M4 stores plaintext per the
    // existing pattern for telephony tokens. The DB CHECK below ensures
    // we never accidentally store a user (xoxp) or app (xapp) token.
    slackBotToken: text('slack_bot_token').notNull(),
    slackBotUserId: varchar('slack_bot_user_id', { length: 32 }),
    connectionStatus: varchar('connection_status', { length: 32 }).notNull().default('active'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('org_slack_connections_team_uidx').on(t.slackTeamId),
    uniqueIndex('org_slack_connections_org_team_uidx').on(t.organizationId, t.slackTeamId),
    index('org_slack_connections_org_id_idx').on(t.organizationId),
    check(
      'org_slack_connections_status_valid',
      sql`${t.connectionStatus} IN ('active', 'error', 'revoked')`,
    ),
    check(
      'org_slack_connections_revoked_at_required',
      sql`(${t.connectionStatus} = 'revoked' AND ${t.revokedAt} IS NOT NULL) OR (${t.connectionStatus} <> 'revoked' AND ${t.revokedAt} IS NULL)`,
    ),
    check('org_slack_connections_bot_token_prefix', sql`${t.slackBotToken} LIKE 'xoxb-%'`),
  ],
);
```

- [ ] **Step 2: Export from schema index**

In `packages/db/src/schema/index.ts`, append:

```typescript
export * from './slack-connections';
```

- [ ] **Step 3: Generate migration**

```bash
pnpm --filter @cema/db db:generate
```

Rename the produced file to `0017_slack_connections.sql`. Update the corresponding journal entry's `tag` field.

- [ ] **Step 4: Apply migration**

```bash
pnpm --filter @cema/db db:migrate
```

Expected: `migrations applied successfully!`

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add packages/db/src/schema/slack-connections.ts packages/db/src/schema/index.ts packages/db/migrations/0017_slack_connections.sql packages/db/migrations/meta/
git commit -m "feat(db): add org_slack_connections table (M4 task 1)"
```

---

### Task 2: DB — `slack_messages` table (migration 0018)

**Files:**

- Create: `packages/db/src/schema/slack-messages.ts`
- Create: `packages/db/migrations/0018_slack_messages.sql`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// packages/db/src/schema/slack-messages.ts
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { communications } from './communications';

// One row per Slack message we have captured for a Deal context.
// 1:1 with communications via communication_id (UNIQUE).
//
// The `slack_message_ts` column is Slack's per-channel monotonically
// increasing message ID (e.g. "1716000000.000100"). It is unique within a
// channel but NOT globally; pair it with channel_id for global dedup.
export const slackMessages = pgTable(
  'slack_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    communicationId: uuid('communication_id')
      .notNull()
      .references(() => communications.id, { onDelete: 'restrict' }),
    slackTeamId: varchar('slack_team_id', { length: 32 }).notNull(),
    slackChannelId: varchar('slack_channel_id', { length: 32 }).notNull(),
    slackChannelName: varchar('slack_channel_name', { length: 128 }),
    slackMessageTs: varchar('slack_message_ts', { length: 32 }).notNull(),
    // Slack thread parent timestamp — present iff this message is in a
    // thread. Used to render reply chains; null for top-level posts.
    slackThreadTs: varchar('slack_thread_ts', { length: 32 }),
    authorSlackUserId: varchar('author_slack_user_id', { length: 32 }),
    authorDisplayName: varchar('author_display_name', { length: 128 }),
    text: text('text'),
    // Raw payload retained for forward compat (e.g. Block Kit blocks,
    // file attachments). Phase 1 will parse blocks for richer rendering.
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().default({}).notNull(),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    messageType: varchar('message_type', { length: 32 }).notNull().default('message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('slack_messages_communication_id_uidx').on(t.communicationId),
    uniqueIndex('slack_messages_channel_ts_uidx').on(
      t.slackTeamId,
      t.slackChannelId,
      t.slackMessageTs,
    ),
    index('slack_messages_team_channel_idx').on(t.slackTeamId, t.slackChannelId),
    index('slack_messages_thread_idx').on(t.slackThreadTs),
    check(
      'slack_messages_type_valid',
      sql`${t.messageType} IN ('message', 'app_mention', 'thread_reply')`,
    ),
  ],
);
```

- [ ] **Step 2: Export from schema index**

```typescript
export * from './slack-messages';
```

- [ ] **Step 3: Generate + rename migration + apply**

```bash
pnpm --filter @cema/db db:generate
# Rename the produced file to 0018_slack_messages.sql + update journal tag.
pnpm --filter @cema/db db:migrate
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/slack-messages.ts packages/db/src/schema/index.ts packages/db/migrations/0018_slack_messages.sql packages/db/migrations/meta/
git commit -m "feat(db): add slack_messages table (M4 task 2)"
```

---

### Task 3: `@cema/integrations-slack` package scaffold + types

**Files:**

- Create: `packages/integrations/slack/package.json`
- Create: `packages/integrations/slack/tsconfig.json`
- Create: `packages/integrations/slack/src/index.ts`
- Create: `packages/integrations/slack/src/types.ts`
- Create stubs: `packages/integrations/slack/src/webhook.ts`, `packages/integrations/slack/src/client.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@cema/integrations-slack",
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
    "@slack/web-api": "^7.10.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Copy from `packages/integrations/deepgram/tsconfig.json` (identical structure).

- [ ] **Step 3: Install the Slack SDK**

```bash
pnpm install
pnpm --filter @cema/integrations-slack list
```

Confirm `@slack/web-api` resolves to `^7.10.0`.

- [ ] **Step 4: Write `types.ts`**

```typescript
// packages/integrations/slack/src/types.ts

export interface NormalizedSlackMessage {
  slackTeamId: string;
  slackChannelId: string;
  slackChannelName: string | null;
  slackMessageTs: string;
  slackThreadTs: string | null;
  authorSlackUserId: string | null;
  authorDisplayName: string | null;
  text: string | null;
  hasAttachments: boolean;
  messageType: 'message' | 'app_mention' | 'thread_reply';
  rawPayload: Record<string, unknown>;
}

// Slack Events API outer envelope variants we handle.
export type SlackEventPayload =
  | { type: 'url_verification'; token: string; challenge: string }
  | {
      type: 'event_callback';
      team_id: string;
      api_app_id: string;
      event_id: string;
      event_time: number;
      event:
        | {
            type: 'message';
            subtype?: string;
            channel: string;
            channel_type?: string;
            user?: string;
            text?: string;
            ts: string;
            thread_ts?: string;
            files?: unknown[];
          }
        | {
            type: 'app_mention';
            user: string;
            text: string;
            ts: string;
            channel: string;
            thread_ts?: string;
          };
    };

// Slack slash-command payload (application/x-www-form-urlencoded).
export interface SlackSlashCommand {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
}
```

- [ ] **Step 5: Write `index.ts`**

```typescript
// packages/integrations/slack/src/index.ts
export * from './types';
export * from './client';
export * from './webhook';
```

- [ ] **Step 6: Stub `client.ts` and `webhook.ts`**

```typescript
// packages/integrations/slack/src/client.ts
export {};
```

```typescript
// packages/integrations/slack/src/webhook.ts
export {};
```

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter @cema/integrations-slack typecheck
git add packages/integrations/slack/ pnpm-lock.yaml
git commit -m "feat(integrations): scaffold @cema/integrations-slack (M4 task 3)"
```

---

### Task 4: Slack webhook signature verification + payload parser

**Files:**

- Modify: `packages/integrations/slack/src/webhook.ts`
- Create: `packages/integrations/slack/src/webhook.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/integrations/slack/src/webhook.test.ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseSlackEventPayload, parseSlackSlashCommand, verifySlackSignature } from './webhook';

const SECRET = 'test-slack-signing-secret-abc123';

function sign(timestamp: string, body: string): string {
  const base = `v0:${timestamp}:${body}`;
  return 'v0=' + createHmac('sha256', SECRET).update(base).digest('hex');
}

const MESSAGE_PAYLOAD = JSON.stringify({
  type: 'event_callback',
  team_id: 'T0123',
  api_app_id: 'A0123',
  event_id: 'Ev0123',
  event_time: 1716000000,
  event: {
    type: 'message',
    channel: 'C0123',
    user: 'U0123',
    text: 'CEMA payoff request to Wells Fargo',
    ts: '1716000000.000100',
  },
});

describe('verifySlackSignature', () => {
  it('returns true for a valid v0 HMAC signature', () => {
    const ts = '1716000000';
    const sig = sign(ts, MESSAGE_PAYLOAD);
    expect(verifySlackSignature(SECRET, sig, ts, MESSAGE_PAYLOAD)).toBe(true);
  });

  it('returns false for a tampered body', () => {
    const ts = '1716000000';
    const sig = sign(ts, MESSAGE_PAYLOAD);
    expect(verifySlackSignature(SECRET, sig, ts, MESSAGE_PAYLOAD + 'x')).toBe(false);
  });

  it('returns false for a stale timestamp (> 5 minutes old)', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const sig = sign(ts, MESSAGE_PAYLOAD);
    expect(verifySlackSignature(SECRET, sig, ts, MESSAGE_PAYLOAD)).toBe(false);
  });

  it('returns false when the signature does not start with v0=', () => {
    const ts = '1716000000';
    expect(verifySlackSignature(SECRET, 'bogus', ts, MESSAGE_PAYLOAD)).toBe(false);
  });
});

describe('parseSlackEventPayload', () => {
  it('parses a message event_callback', () => {
    const parsed = parseSlackEventPayload(MESSAGE_PAYLOAD);
    expect(parsed.type).toBe('event_callback');
    if (parsed.type !== 'event_callback') throw new Error('unreachable');
    expect(parsed.team_id).toBe('T0123');
    expect(parsed.event.type).toBe('message');
  });

  it('parses a url_verification challenge', () => {
    const parsed = parseSlackEventPayload(
      JSON.stringify({ type: 'url_verification', token: 'tok', challenge: 'CHALLENGE-XYZ' }),
    );
    expect(parsed.type).toBe('url_verification');
    if (parsed.type !== 'url_verification') throw new Error('unreachable');
    expect(parsed.challenge).toBe('CHALLENGE-XYZ');
  });
});

describe('parseSlackSlashCommand', () => {
  it('parses a form-urlencoded slash command body', () => {
    const body = new URLSearchParams({
      token: 'tok',
      team_id: 'T0123',
      team_domain: 'acme',
      channel_id: 'C0123',
      channel_name: 'cema-pipeline',
      user_id: 'U0123',
      user_name: 'connor',
      command: '/cema',
      text: 'status DEAL-1234',
      response_url: 'https://hooks.slack.com/commands/Txxx/yyy',
      trigger_id: 'trig',
    }).toString();
    const parsed = parseSlackSlashCommand(body);
    expect(parsed.command).toBe('/cema');
    expect(parsed.text).toBe('status DEAL-1234');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm --filter @cema/integrations-slack test
```

Expected: FAIL — `verifySlackSignature is not a function`.

- [ ] **Step 3: Implement `webhook.ts`**

```typescript
// packages/integrations/slack/src/webhook.ts
import { createHmac } from 'node:crypto';

import type { SlackEventPayload, SlackSlashCommand } from './types';

// Slack docs: https://api.slack.com/authentication/verifying-requests-from-slack
// Signed base: "v0:{timestamp}:{rawBody}", HMAC-SHA256 keyed with signing secret.
// Replay window: 5 minutes (300 seconds).

const REPLAY_WINDOW_SECONDS = 300;

export function verifySlackSignature(
  signingSecret: string,
  signatureHeader: string,
  timestampHeader: string,
  rawBody: string,
): boolean {
  if (!signatureHeader.startsWith('v0=')) return false;
  const tsNum = Number(timestampHeader);
  if (!Number.isFinite(tsNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > REPLAY_WINDOW_SECONDS) return false;
  const base = `v0:${timestampHeader}:${rawBody}`;
  const expected = 'v0=' + createHmac('sha256', signingSecret).update(base).digest('hex');
  return expected === signatureHeader;
}

export function parseSlackEventPayload(rawBody: string): SlackEventPayload {
  return JSON.parse(rawBody) as SlackEventPayload;
}

export function parseSlackSlashCommand(rawBody: string): SlackSlashCommand {
  const params = new URLSearchParams(rawBody);
  return {
    token: params.get('token') ?? '',
    team_id: params.get('team_id') ?? '',
    team_domain: params.get('team_domain') ?? '',
    channel_id: params.get('channel_id') ?? '',
    channel_name: params.get('channel_name') ?? '',
    user_id: params.get('user_id') ?? '',
    user_name: params.get('user_name') ?? '',
    command: params.get('command') ?? '',
    text: params.get('text') ?? '',
    response_url: params.get('response_url') ?? '',
    trigger_id: params.get('trigger_id') ?? '',
  };
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
pnpm --filter @cema/integrations-slack test
```

Expected: PASS — 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/slack/src/webhook.ts packages/integrations/slack/src/webhook.test.ts
git commit -m "feat(integrations): Slack signature verification + payload parsers (M4 task 4)"
```

---

### Task 5: Slack Web API client wrapper

**Files:**

- Modify: `packages/integrations/slack/src/client.ts`
- Create: `packages/integrations/slack/src/client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/integrations/slack/src/client.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    chat: {
      postMessage: vi
        .fn()
        .mockResolvedValue({ ok: true, ts: '1716000000.000200', channel: 'C0123' }),
      postEphemeral: vi.fn().mockResolvedValue({ ok: true }),
    },
    users: {
      info: vi.fn().mockResolvedValue({
        ok: true,
        user: { id: 'U0123', real_name: 'Connor Hickey', profile: { display_name: 'connor' } },
      }),
    },
  })),
}));

import { fetchSlackUserDisplayName, getSlackClient, postEphemeralReply } from './client';

describe('getSlackClient', () => {
  it('constructs a WebClient with the provided bot token', () => {
    const client = getSlackClient('xoxb-fake-token');
    expect(client).toBeDefined();
  });
});

describe('fetchSlackUserDisplayName', () => {
  it('returns the display_name when present', async () => {
    const client = getSlackClient('xoxb-fake-token');
    const name = await fetchSlackUserDisplayName(client, 'U0123');
    expect(name).toBe('connor');
  });
});

describe('postEphemeralReply', () => {
  it('calls chat.postEphemeral on the WebClient', async () => {
    const client = getSlackClient('xoxb-fake-token');
    await expect(
      postEphemeralReply(client, { channel: 'C0123', user: 'U0123', text: 'Deal: ready' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

```bash
pnpm --filter @cema/integrations-slack test
```

- [ ] **Step 3: Implement `client.ts`**

```typescript
// packages/integrations/slack/src/client.ts
import { WebClient } from '@slack/web-api';

export function getSlackClient(botToken: string): WebClient {
  return new WebClient(botToken);
}

export async function fetchSlackUserDisplayName(
  client: WebClient,
  userId: string,
): Promise<string | null> {
  const res = await client.users.info({ user: userId });
  if (!res.ok || !res.user) return null;
  const profile = (res.user as { profile?: { display_name?: string }; real_name?: string }).profile;
  return profile?.display_name || (res.user as { real_name?: string }).real_name || null;
}

export interface PostEphemeralReplyParams {
  channel: string;
  user: string;
  text: string;
}

export async function postEphemeralReply(
  client: WebClient,
  params: PostEphemeralReplyParams,
): Promise<void> {
  await client.chat.postEphemeral({
    channel: params.channel,
    user: params.user,
    text: params.text,
  });
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm --filter @cema/integrations-slack test
pnpm --filter @cema/integrations-slack typecheck
```

Expected: PASS — 11 tests green (3 new + 8 from Task 4).

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/slack/src/client.ts packages/integrations/slack/src/client.test.ts
git commit -m "feat(integrations): Slack Web API client wrappers (M4 task 5)"
```

---

### Task 6: Slack webhook route (events + slash command)

**Files:**

- Create: `apps/web/app/api/webhooks/slack/route.ts`
- Create: `apps/web/app/api/webhooks/slack/route.test.ts`
- Modify: `packages/queues/src/topics.ts` (add `comms.slack.ingest` topic)
- Modify: `apps/web/package.json` (add `@cema/integrations-slack` dep)

- [ ] **Step 1: Add the new queue topic**

In `packages/queues/src/topics.ts`, extend `TopicSchema`:

```typescript
'comms.slack.ingest': z.object({
  orgId: z.string(),
  communicationId: z.string(),
  slackTeamId: z.string(),
  slackChannelId: z.string(),
  slackMessageTs: z.string(),
  receivedAt: z.string().datetime(),
}),
```

- [ ] **Step 2: Add `@cema/integrations-slack` to `apps/web` deps**

In `apps/web/package.json`, add under `dependencies`:

```json
"@cema/integrations-slack": "workspace:*",
```

Then run `pnpm install`.

- [ ] **Step 3: Write the failing tests**

```typescript
// apps/web/app/api/webhooks/slack/route.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/integrations-slack', () => ({
  verifySlackSignature: vi.fn(),
  parseSlackEventPayload: vi.fn(),
  parseSlackSlashCommand: vi.fn(),
  getSlackClient: vi.fn().mockReturnValue({}),
  fetchSlackUserDisplayName: vi.fn().mockResolvedValue('connor'),
  postEphemeralReply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  orgSlackConnections: {
    slackTeamId: 'team_col',
    organizationId: 'org_col',
    slackBotToken: 'tok_col',
  },
  communications: { vendorEventId: 'vendor_event_col' },
  slackMessages: { communicationId: 'comm_id_col' },
  deals: { id: 'id_col', organizationId: 'org_col', status: 'status_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/queues', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/queue', () => ({
  vercelQueueSend: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from '@cema/db';
import { parseSlackEventPayload, verifySlackSignature } from '@cema/integrations-slack';

const SECRET = 'test-secret';

function makeRequest(body: string, sig: string, ts: string, contentType = 'application/json') {
  return new Request('https://example.com/api/webhooks/slack', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-slack-signature': sig,
      'x-slack-request-timestamp': ts,
    },
    body,
  });
}

describe('POST /api/webhooks/slack', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns 500 when SLACK_SIGNING_SECRET is missing', async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'v0=x', '1716000000'));
    expect(res.status).toBe(500);
  });

  it('returns 401 when signature verification fails', async () => {
    process.env.SLACK_SIGNING_SECRET = SECRET;
    vi.mocked(verifySlackSignature).mockReturnValue(false);
    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'v0=bad', '1716000000'));
    expect(res.status).toBe(401);
  });

  it('responds to a url_verification challenge', async () => {
    process.env.SLACK_SIGNING_SECRET = SECRET;
    vi.mocked(verifySlackSignature).mockReturnValue(true);
    vi.mocked(parseSlackEventPayload).mockReturnValue({
      type: 'url_verification',
      token: 'tok',
      challenge: 'CHALLENGE-1234',
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'v0=ok', '1716000000'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge: string };
    expect(body.challenge).toBe('CHALLENGE-1234');
  });

  it('returns 200 when the team_id is not known to us', async () => {
    process.env.SLACK_SIGNING_SECRET = SECRET;
    vi.mocked(verifySlackSignature).mockReturnValue(true);
    vi.mocked(parseSlackEventPayload).mockReturnValue({
      type: 'event_callback',
      team_id: 'T-unknown',
      api_app_id: 'A0',
      event_id: 'Ev0',
      event_time: 0,
      event: { type: 'message', channel: 'C0', user: 'U0', text: 'hi', ts: '1.0' },
    });
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>);
    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'v0=ok', '1716000000'));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 4: Run — verify failing**

```bash
pnpm --filter web test app/api/webhooks/slack
```

- [ ] **Step 5: Implement `route.ts`**

```typescript
// apps/web/app/api/webhooks/slack/route.ts
import { communications, deals, getDb, orgSlackConnections, slackMessages } from '@cema/db';
import {
  fetchSlackUserDisplayName,
  getSlackClient,
  parseSlackEventPayload,
  parseSlackSlashCommand,
  postEphemeralReply,
  verifySlackSignature,
} from '@cema/integrations-slack';
import { publish } from '@cema/queues';
import { and, eq } from 'drizzle-orm';

import { vercelQueueSend } from '@/lib/queue';

export async function POST(req: Request): Promise<Response> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return new Response('SLACK_SIGNING_SECRET not configured', { status: 500 });
  }

  const sig = req.headers.get('x-slack-signature') ?? '';
  const ts = req.headers.get('x-slack-request-timestamp') ?? '';
  const rawBody = await req.text();

  if (!verifySlackSignature(signingSecret, sig, ts, rawBody)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';

  // Slash commands arrive as application/x-www-form-urlencoded.
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return handleSlashCommand(rawBody);
  }

  const payload = parseSlackEventPayload(rawBody);

  if (payload.type === 'url_verification') {
    return Response.json({ challenge: payload.challenge });
  }

  if (payload.type !== 'event_callback') {
    return new Response('OK', { status: 200 });
  }

  const db = getDb();
  const [conn] = await db
    .select({
      organizationId: orgSlackConnections.organizationId,
      slackBotToken: orgSlackConnections.slackBotToken,
    })
    .from(orgSlackConnections)
    .where(eq(orgSlackConnections.slackTeamId, payload.team_id))
    .limit(1);

  if (!conn) {
    return new Response('OK', { status: 200 });
  }

  const evt = payload.event;
  if (evt.type !== 'message' && evt.type !== 'app_mention') {
    return new Response('OK', { status: 200 });
  }

  const orgId = conn.organizationId;
  const client = getSlackClient(conn.slackBotToken);
  const displayName = evt.user ? await fetchSlackUserDisplayName(client, evt.user) : null;

  const vendorEventId = `${payload.team_id}:${evt.channel}:${evt.ts}`;
  const messageType =
    evt.type === 'app_mention' ? 'app_mention' : evt.thread_ts ? 'thread_reply' : 'message';

  const [comm] = await db
    .insert(communications)
    .values({
      organizationId: orgId,
      kind: 'slack',
      direction: 'inbound',
      medium: 'slack',
      vendorEventId,
      sourceThreadId: evt.thread_ts ?? evt.ts,
      startedAt: new Date(Math.floor(Number(evt.ts) * 1000)),
      status: 'ready',
    })
    .onConflictDoUpdate({
      target: communications.vendorEventId,
      set: { status: 'ready', updatedAt: new Date() },
    })
    .returning();

  if (!comm) {
    return new Response('OK', { status: 200 });
  }

  await db
    .insert(slackMessages)
    .values({
      communicationId: comm.id,
      slackTeamId: payload.team_id,
      slackChannelId: evt.channel,
      slackChannelName: null,
      slackMessageTs: evt.ts,
      slackThreadTs: evt.thread_ts ?? null,
      authorSlackUserId: evt.user ?? null,
      authorDisplayName: displayName,
      text: evt.text ?? null,
      rawPayload: evt as unknown as Record<string, unknown>,
      hasAttachments: 'files' in evt && Array.isArray(evt.files) && evt.files.length > 0,
      messageType,
    })
    .onConflictDoUpdate({
      target: slackMessages.communicationId,
      set: { text: evt.text ?? null, updatedAt: new Date() },
    });

  await publish(
    'comms.slack.ingest',
    {
      orgId,
      communicationId: comm.id,
      slackTeamId: payload.team_id,
      slackChannelId: evt.channel,
      slackMessageTs: evt.ts,
      receivedAt: new Date().toISOString(),
    },
    vercelQueueSend,
  );

  return new Response('OK', { status: 200 });
}

async function handleSlashCommand(rawBody: string): Promise<Response> {
  const cmd = parseSlackSlashCommand(rawBody);
  // `/cema status DEAL-1234`
  const [verb, dealRef] = cmd.text.split(/\s+/);
  if (verb !== 'status' || !dealRef) {
    return Response.json({
      response_type: 'ephemeral',
      text: 'Usage: `/cema status DEAL-1234`',
    });
  }

  const db = getDb();
  const [conn] = await db
    .select({
      organizationId: orgSlackConnections.organizationId,
      slackBotToken: orgSlackConnections.slackBotToken,
    })
    .from(orgSlackConnections)
    .where(eq(orgSlackConnections.slackTeamId, cmd.team_id))
    .limit(1);

  if (!conn) {
    return Response.json({ response_type: 'ephemeral', text: 'Workspace not linked to CEMA.' });
  }

  // Look up the deal by its human-readable ref. The `deals` table has a
  // `humanRef` column maintained by M1; the lookup is org-scoped.
  const [deal] = await db
    .select({ id: deals.id, status: deals.status })
    .from(deals)
    .where(and(eq(deals.organizationId, conn.organizationId), eq(deals.id, dealRef)))
    .limit(1);

  const replyText = deal
    ? `Deal ${dealRef}: status \`${deal.status}\``
    : `Deal ${dealRef} not found.`;

  // Use the bot token to post the ephemeral reply rather than the
  // response_url URL — keeps the auth pattern consistent with other
  // outbound chats and gives us a stable retry path.
  const client = getSlackClient(conn.slackBotToken);
  await postEphemeralReply(client, {
    channel: cmd.channel_id,
    user: cmd.user_id,
    text: replyText,
  });

  return new Response('', { status: 200 });
}
```

- [ ] **Step 6: Run tests + typecheck**

```bash
pnpm --filter web test app/api/webhooks/slack
pnpm typecheck
```

Expected: PASS — 4 route tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/webhooks/slack/ apps/web/package.json packages/queues/src/topics.ts pnpm-lock.yaml
git commit -m "feat(webhooks): Slack events + slash command webhook (M4 task 6)"
```

---

### Task 7: Server actions — `listSlackMessages` + `getSlackMessage`

**Files:**

- Create: `apps/web/lib/actions/list-slack-messages.ts` + `list-slack-messages.test.ts`
- Create: `apps/web/lib/actions/get-slack-message.ts` + `get-slack-message.test.ts`

- [ ] **Step 1: Write `list-slack-messages.ts`**

```typescript
// apps/web/lib/actions/list-slack-messages.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { communications, getDb, organizations, slackMessages } from '@cema/db';
import { and, desc, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Communication = typeof communications.$inferSelect;
type SlackMessage = typeof slackMessages.$inferSelect;

export interface SlackMessageRow {
  communication: Communication;
  slackMessage: SlackMessage | null;
}

export async function listSlackMessages(dealId: string): Promise<SlackMessageRow[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const rows = await withRls(org.id, async (tx) =>
    tx
      .select()
      .from(communications)
      .leftJoin(slackMessages, eq(slackMessages.communicationId, communications.id))
      .where(and(eq(communications.dealId, dealId), eq(communications.kind, 'slack')))
      .orderBy(desc(communications.startedAt)),
  );

  return rows.map((row) => ({
    communication: row.communications,
    slackMessage: row.slack_messages,
  }));
}
```

- [ ] **Step 2: Write `get-slack-message.ts`**

```typescript
// apps/web/lib/actions/get-slack-message.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { communications, getDb, organizations, slackMessages } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Communication = typeof communications.$inferSelect;
type SlackMessage = typeof slackMessages.$inferSelect;

export interface SlackMessageDetail {
  communication: Communication;
  slackMessage: SlackMessage | null;
}

export async function getSlackMessage(
  dealId: string,
  communicationId: string,
): Promise<SlackMessageDetail | null> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return null;

  const rows = await withRls(org.id, async (tx) =>
    tx
      .select()
      .from(communications)
      .leftJoin(slackMessages, eq(slackMessages.communicationId, communications.id))
      .where(and(eq(communications.id, communicationId), eq(communications.dealId, dealId)))
      .limit(1),
  );

  const row = rows[0];
  if (!row) return null;

  return { communication: row.communications, slackMessage: row.slack_messages };
}
```

- [ ] **Step 3: Write the tests**

Mirror the M3 `list-emails.test.ts` / `get-email.test.ts` shapes — mock `@cema/auth`, `@cema/db`, `drizzle-orm`, and `../with-rls`; assert empty-org, no-row, happy-path, and `withRls` call-with-org-id behaviours. Four tests per action, eight total. (See M3 Task 9 for the exact mock structure.)

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm --filter web test lib/actions/list-slack-messages lib/actions/get-slack-message
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/list-slack-messages.ts apps/web/lib/actions/list-slack-messages.test.ts apps/web/lib/actions/get-slack-message.ts apps/web/lib/actions/get-slack-message.test.ts
git commit -m "feat(actions): list/get slack messages (M4 task 7)"
```

---

### Task 8: UI — `SlackMessageCard` + extend Communications timeline + detail

**Files:**

- Create: `apps/web/components/slack-message-card.tsx`
- Modify: `apps/web/app/(app)/deals/[id]/communications/page.tsx`
- Modify: `apps/web/app/(app)/deals/[id]/communications/[c]/page.tsx`

- [ ] **Step 1: Create the card component**

```tsx
// apps/web/components/slack-message-card.tsx
import type { communications, slackMessages } from '@cema/db';
import type { Route } from 'next';
import Link from 'next/link';

type Communication = typeof communications.$inferSelect;
type SlackMessage = typeof slackMessages.$inferSelect;

interface SlackMessageCardProps {
  communication: Communication;
  slackMessage: SlackMessage | null;
  dealId: string;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const TYPE_BADGE: Record<string, string> = {
  message: 'bg-purple-100 text-purple-700',
  app_mention: 'bg-orange-100 text-orange-700',
  thread_reply: 'bg-blue-100 text-blue-700',
};

export function SlackMessageCard({ communication, slackMessage, dealId }: SlackMessageCardProps) {
  const author = slackMessage?.authorDisplayName ?? slackMessage?.authorSlackUserId ?? '—';
  const channel = slackMessage?.slackChannelName ?? slackMessage?.slackChannelId ?? '—';
  const type = slackMessage?.messageType ?? 'message';

  return (
    <Link
      href={`/deals/${dealId}/communications/${communication.id}` as Route}
      className="hover:bg-muted/50 block rounded-lg border bg-white p-4 shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span aria-label="Slack" className="text-muted-foreground text-xs">
              💬
            </span>
            <p className="truncate text-sm font-medium">
              {author} <span className="text-muted-foreground">in #{channel}</span>
            </p>
          </div>
          {slackMessage?.text ? (
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{slackMessage.text}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="text-muted-foreground text-xs">{formatDate(communication.startedAt)}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[type] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {type.replace('_', ' ')}
          </span>
          {slackMessage?.hasAttachments ? (
            <span className="text-muted-foreground text-xs">📎</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Extend the communications list page**

In `apps/web/app/(app)/deals/[id]/communications/page.tsx`:

- Import: `import { SlackMessageCard } from '@/components/slack-message-card';` and `import { listSlackMessages } from '@/lib/actions/list-slack-messages';`
- In the `Promise.all` add `listSlackMessages(dealId)`.
- Add a `SlackItem` union variant with `slackMessage: …`.
- Map slack rows into the merged timeline.
- In the render branch, add `if (item.kind === 'slack') return <SlackMessageCard …/>`.

- [ ] **Step 3: Extend the detail page**

In `apps/web/app/(app)/deals/[id]/communications/[c]/page.tsx`:

```tsx
if (comm.kind === 'slack') {
  const slackData = await getSlackMessage(dealId, communicationId);
  if (!slackData) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Slack message</h1>
        <p className="text-muted-foreground mt-1 text-sm">{formatDate(comm.startedAt)}</p>
      </div>
      <SlackMessageCard
        communication={slackData.communication}
        slackMessage={slackData.slackMessage}
        dealId={dealId}
      />
      {slackData.slackMessage?.text ? (
        <div className="rounded-lg border p-4">
          <pre className="text-muted-foreground whitespace-pre-wrap text-sm">
            {slackData.slackMessage.text}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
pnpm --filter web test
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/slack-message-card.tsx "apps/web/app/(app)/deals/"
git commit -m "feat(ui): SlackMessageCard + extend Communications surfaces (M4 task 8)"
```

---

### Subsystem 2 — Google Drive (Tasks 9–15)

---

### Task 9: DB — `org_drive_connections` table (migration 0019)

**Files:**

- Create: `packages/db/src/schema/drive-connections.ts`
- Create: `packages/db/migrations/0019_drive_connections.sql`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// packages/db/src/schema/drive-connections.ts
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { organizations, users } from './tenants';

// One row per Google account a CEMA org has linked. We store the
// account email (for display), the OAuth refresh token (encrypted in
// Phase 2; plaintext for M4 per the existing pattern), and a per-channel
// secret used to authenticate Drive push notifications.
export const orgDriveConnections = pgTable(
  'org_drive_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    googleAccountEmail: varchar('google_account_email', { length: 256 }).notNull(),
    googleAccountId: varchar('google_account_id', { length: 128 }),
    oauthRefreshToken: text('oauth_refresh_token').notNull(),
    // Channel info for files.watch — Drive does not sign push
    // notifications, so the channel_token is the auth gate. We choose
    // it (random 32-byte hex). Each connection has at most one active
    // channel; a re-subscribe rotates these fields.
    driveChannelId: varchar('drive_channel_id', { length: 128 }),
    driveChannelToken: varchar('drive_channel_token', { length: 128 }),
    driveChannelExpiresAt: timestamp('drive_channel_expires_at', { withTimezone: true }),
    connectionStatus: varchar('connection_status', { length: 32 }).notNull().default('active'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('org_drive_connections_channel_id_uidx').on(t.driveChannelId),
    uniqueIndex('org_drive_connections_org_email_uidx').on(t.organizationId, t.googleAccountEmail),
    index('org_drive_connections_org_id_idx').on(t.organizationId),
    check(
      'org_drive_connections_status_valid',
      sql`${t.connectionStatus} IN ('active', 'error', 'revoked')`,
    ),
    check(
      'org_drive_connections_revoked_at_required',
      sql`(${t.connectionStatus} = 'revoked' AND ${t.revokedAt} IS NOT NULL) OR (${t.connectionStatus} <> 'revoked' AND ${t.revokedAt} IS NULL)`,
    ),
  ],
);
```

- [ ] **Step 2: Export from schema index**

```typescript
export * from './drive-connections';
```

- [ ] **Step 3: Generate + rename migration + apply**

```bash
pnpm --filter @cema/db db:generate
# Rename produced file to 0019_drive_connections.sql + update journal tag.
pnpm --filter @cema/db db:migrate
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/drive-connections.ts packages/db/src/schema/index.ts packages/db/migrations/0019_drive_connections.sql packages/db/migrations/meta/
git commit -m "feat(db): add org_drive_connections table (M4 task 9)"
```

---

### Task 10: DB — `drive_files` table (migration 0020)

**Files:**

- Create: `packages/db/src/schema/drive-files.ts`
- Create: `packages/db/migrations/0020_drive_files.sql`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// packages/db/src/schema/drive-files.ts
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { deals } from './deals';
import { orgDriveConnections } from './drive-connections';
import { organizations } from './tenants';

// One row per Google Drive file we are mirroring into Vercel Blob.
// dealId is nullable — files can be linked to a deal explicitly, but
// new files from a watched folder arrive un-linked and a Phase 1
// classifier maps them to deals later.
export const driveFiles = pgTable(
  'drive_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    driveConnectionId: uuid('drive_connection_id')
      .notNull()
      .references(() => orgDriveConnections.id, { onDelete: 'restrict' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    // Google Drive file ID — globally unique per Drive instance.
    driveFileId: varchar('drive_file_id', { length: 128 }).notNull(),
    driveFolderId: varchar('drive_folder_id', { length: 128 }),
    fileName: text('file_name'),
    mimeType: varchar('mime_type', { length: 128 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    // Mirror state — blob_pathname is null until the first successful
    // download. blob_url is the signed URL valid for `signed_url_ttl_s`
    // seconds at issue time; re-issue on access.
    blobPathname: text('blob_pathname'),
    blobUrl: text('blob_url'),
    syncStatus: varchar('sync_status', { length: 32 }).notNull().default('pending'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    trashedAt: timestamp('trashed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('drive_files_connection_drive_file_id_uidx').on(t.driveConnectionId, t.driveFileId),
    index('drive_files_organization_id_idx').on(t.organizationId),
    index('drive_files_deal_id_idx').on(t.dealId),
    index('drive_files_sync_status_idx').on(t.organizationId, t.syncStatus),
    check(
      'drive_files_sync_status_valid',
      sql`${t.syncStatus} IN ('pending', 'syncing', 'synced', 'error', 'trashed')`,
    ),
    check('drive_files_size_nonneg', sql`${t.sizeBytes} IS NULL OR ${t.sizeBytes} >= 0`),
  ],
);
```

- [ ] **Step 2: Export, generate, rename to `0020_drive_files.sql`, apply, commit**

```bash
pnpm --filter @cema/db db:generate
# Rename produced file + update journal tag
pnpm --filter @cema/db db:migrate
pnpm typecheck
git add packages/db/src/schema/drive-files.ts packages/db/src/schema/index.ts packages/db/migrations/0020_drive_files.sql packages/db/migrations/meta/
git commit -m "feat(db): add drive_files table (M4 task 10)"
```

---

### Task 11: `@cema/integrations-drive` package scaffold + types

**Files:**

- Create: `packages/integrations/drive/package.json`
- Create: `packages/integrations/drive/tsconfig.json`
- Create: `packages/integrations/drive/src/index.ts`
- Create: `packages/integrations/drive/src/types.ts`
- Stubs: `packages/integrations/drive/src/client.ts`, `packages/integrations/drive/src/webhook.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@cema/integrations-drive",
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
    "googleapis": "^144.0.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Copy from `packages/integrations/deepgram/tsconfig.json`.

- [ ] **Step 3: Install**

```bash
pnpm install
```

- [ ] **Step 4: Write `types.ts`**

```typescript
// packages/integrations/drive/src/types.ts

export interface NormalizedDriveFile {
  driveFileId: string;
  driveFolderId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  trashed: boolean;
  modifiedTime: Date | null;
}

// Drive push-notification header set we care about.
export interface DriveNotificationHeaders {
  channelId: string;
  channelToken: string;
  resourceState: 'sync' | 'add' | 'remove' | 'update' | 'trash' | 'untrash' | 'change';
  resourceId: string;
  messageNumber: string;
}

export interface StartDriveWatchInput {
  fileId: string;
  channelId: string;
  channelToken: string;
  webhookUrl: string;
  ttlSeconds: number;
}

export interface StartDriveWatchResult {
  channelId: string;
  expiration: Date;
  resourceId: string;
}
```

- [ ] **Step 5: Write `index.ts` + stubs + typecheck + commit**

```typescript
// packages/integrations/drive/src/index.ts
export * from './types';
export * from './client';
export * from './webhook';
```

```typescript
// packages/integrations/drive/src/client.ts
export {};

// packages/integrations/drive/src/webhook.ts
export {};
```

```bash
pnpm --filter @cema/integrations-drive typecheck
git add packages/integrations/drive/ pnpm-lock.yaml
git commit -m "feat(integrations): scaffold @cema/integrations-drive (M4 task 11)"
```

---

### Task 12: Drive client — `fetchDriveFile`, `downloadDriveFileBytes`, `startDriveWatch`

**Files:**

- Modify: `packages/integrations/drive/src/client.ts`
- Create: `packages/integrations/drive/src/client.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/integrations/drive/src/client.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn().mockReturnValue({
      files: {
        get: vi.fn().mockImplementation(async (params: { fileId: string; alt?: string }) => {
          if (params.alt === 'media') {
            return { data: Buffer.from('hello-drive-bytes') };
          }
          return {
            data: {
              id: params.fileId,
              name: 'payoff.pdf',
              mimeType: 'application/pdf',
              size: '12345',
              parents: ['parentFolder'],
              trashed: false,
              modifiedTime: '2026-05-20T12:00:00.000Z',
            },
          };
        }),
        watch: vi.fn().mockResolvedValue({
          data: {
            id: 'channel-abc',
            expiration: '1716100000000',
            resourceId: 'resource-xyz',
          },
        }),
      },
    }),
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
      })),
    },
  },
}));

import { downloadDriveFileBytes, fetchDriveFile, getDriveClient, startDriveWatch } from './client';

describe('fetchDriveFile', () => {
  it('returns NormalizedDriveFile', async () => {
    const drive = getDriveClient({ refreshToken: 'rt' });
    const file = await fetchDriveFile(drive, 'file-1');
    expect(file.fileName).toBe('payoff.pdf');
    expect(file.mimeType).toBe('application/pdf');
    expect(file.sizeBytes).toBe(12345);
    expect(file.driveFolderId).toBe('parentFolder');
    expect(file.trashed).toBe(false);
  });
});

describe('downloadDriveFileBytes', () => {
  it('returns the file bytes as a Buffer', async () => {
    const drive = getDriveClient({ refreshToken: 'rt' });
    const bytes = await downloadDriveFileBytes(drive, 'file-1');
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.toString()).toBe('hello-drive-bytes');
  });
});

describe('startDriveWatch', () => {
  it('starts a watch channel and returns expiration + resourceId', async () => {
    const drive = getDriveClient({ refreshToken: 'rt' });
    const result = await startDriveWatch(drive, {
      fileId: 'file-1',
      channelId: 'channel-abc',
      channelToken: 'tok',
      webhookUrl: 'https://example.com/api/webhooks/drive',
      ttlSeconds: 86400,
    });
    expect(result.channelId).toBe('channel-abc');
    expect(result.resourceId).toBe('resource-xyz');
    expect(result.expiration).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Implement `client.ts`**

```typescript
// packages/integrations/drive/src/client.ts
import { google, type drive_v3 } from 'googleapis';

import type { NormalizedDriveFile, StartDriveWatchInput, StartDriveWatchResult } from './types';

export interface GetDriveClientInput {
  refreshToken: string;
  clientId?: string;
  clientSecret?: string;
}

export function getDriveClient(input: GetDriveClientInput): drive_v3.Drive {
  const oauth2 = new google.auth.OAuth2(
    input.clientId ?? process.env.GOOGLE_CLIENT_ID,
    input.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: input.refreshToken });
  return google.drive({ version: 'v3', auth: oauth2 });
}

export async function fetchDriveFile(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<NormalizedDriveFile> {
  const res = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, parents, trashed, modifiedTime',
  });
  const f = res.data as {
    id?: string;
    name?: string;
    mimeType?: string;
    size?: string;
    parents?: string[];
    trashed?: boolean;
    modifiedTime?: string;
  };
  return {
    driveFileId: f.id ?? fileId,
    driveFolderId: f.parents?.[0] ?? null,
    fileName: f.name ?? '',
    mimeType: f.mimeType ?? 'application/octet-stream',
    sizeBytes: f.size ? Number(f.size) : null,
    trashed: Boolean(f.trashed),
    modifiedTime: f.modifiedTime ? new Date(f.modifiedTime) : null,
  };
}

export async function downloadDriveFileBytes(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<Buffer> {
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  const data = res.data as ArrayBuffer | Buffer;
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

export async function startDriveWatch(
  drive: drive_v3.Drive,
  input: StartDriveWatchInput,
): Promise<StartDriveWatchResult> {
  const res = await drive.files.watch({
    fileId: input.fileId,
    requestBody: {
      id: input.channelId,
      type: 'web_hook',
      address: input.webhookUrl,
      token: input.channelToken,
      expiration: String(Date.now() + input.ttlSeconds * 1000),
    },
  });
  const d = res.data as { id?: string; expiration?: string; resourceId?: string };
  return {
    channelId: d.id ?? input.channelId,
    expiration: d.expiration ? new Date(Number(d.expiration)) : new Date(),
    resourceId: d.resourceId ?? '',
  };
}
```

- [ ] **Step 3: Run + typecheck + commit**

```bash
pnpm --filter @cema/integrations-drive test
pnpm --filter @cema/integrations-drive typecheck
git add packages/integrations/drive/src/client.ts packages/integrations/drive/src/client.test.ts
git commit -m "feat(integrations): Drive client — fetch + download + watch (M4 task 12)"
```

---

### Task 13: Drive push-notification webhook route

**Files:**

- Create: `apps/web/app/api/webhooks/drive/route.ts`
- Create: `apps/web/app/api/webhooks/drive/route.test.ts`
- Modify: `packages/integrations/drive/src/webhook.ts` (header parser)
- Modify: `packages/queues/src/topics.ts` (add `files.drive.ingest`)
- Modify: `apps/web/package.json` (add `@cema/integrations-drive`, `@cema/blob` already in deps)

- [ ] **Step 1: Implement `webhook.ts` header parser**

```typescript
// packages/integrations/drive/src/webhook.ts
import type { DriveNotificationHeaders } from './types';

export function parseDriveNotificationHeaders(headers: Headers): DriveNotificationHeaders | null {
  const channelId = headers.get('x-goog-channel-id');
  const channelToken = headers.get('x-goog-channel-token');
  const resourceState = headers.get('x-goog-resource-state');
  const resourceId = headers.get('x-goog-resource-id');
  const messageNumber = headers.get('x-goog-message-number');
  if (!channelId || !resourceState || !resourceId) return null;
  return {
    channelId,
    channelToken: channelToken ?? '',
    resourceState: resourceState as DriveNotificationHeaders['resourceState'],
    resourceId,
    messageNumber: messageNumber ?? '',
  };
}

export function verifyDriveChannelToken(expectedToken: string, presentedToken: string): boolean {
  if (!expectedToken) return false;
  return expectedToken === presentedToken;
}
```

- [ ] **Step 2: Add the queue topic**

```typescript
// packages/queues/src/topics.ts
'files.drive.ingest': z.object({
  orgId: z.string(),
  driveFileId: z.string(),
  driveConnectionId: z.string(),
  receivedAt: z.string().datetime(),
}),
```

- [ ] **Step 3: Add the integration package to apps/web deps**

```json
"@cema/integrations-drive": "workspace:*",
```

Then `pnpm install`.

- [ ] **Step 4: Implement `route.ts`**

```typescript
// apps/web/app/api/webhooks/drive/route.ts
import { blobPut } from '@cema/blob';
import { driveFiles, getDb, orgDriveConnections } from '@cema/db';
import {
  downloadDriveFileBytes,
  fetchDriveFile,
  getDriveClient,
  parseDriveNotificationHeaders,
  verifyDriveChannelToken,
} from '@cema/integrations-drive';
import { publish } from '@cema/queues';
import { eq } from 'drizzle-orm';

import { vercelQueueSend } from '@/lib/queue';

export async function POST(req: Request): Promise<Response> {
  const headers = parseDriveNotificationHeaders(req.headers);
  if (!headers) {
    return new Response('Bad Request — missing X-Goog headers', { status: 400 });
  }

  const db = getDb();
  const [conn] = await db
    .select({
      id: orgDriveConnections.id,
      organizationId: orgDriveConnections.organizationId,
      oauthRefreshToken: orgDriveConnections.oauthRefreshToken,
      driveChannelToken: orgDriveConnections.driveChannelToken,
    })
    .from(orgDriveConnections)
    .where(eq(orgDriveConnections.driveChannelId, headers.channelId))
    .limit(1);

  if (!conn) {
    // Unknown channel — drop. Return 200 to stop Google retrying.
    return new Response('OK', { status: 200 });
  }

  if (!verifyDriveChannelToken(conn.driveChannelToken ?? '', headers.channelToken)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // The initial subscribe handshake — Google sends a "sync" message.
  if (headers.resourceState === 'sync') {
    return new Response('OK', { status: 200 });
  }

  // X-Goog-Resource-Id maps to a Drive file ID via the `?supportsAllDrives=true`
  // endpoint, but for watch-on-file channels the resourceId IS the fileId.
  const fileId = headers.resourceId;

  const drive = getDriveClient({ refreshToken: conn.oauthRefreshToken });
  const meta = await fetchDriveFile(drive, fileId);

  if (meta.trashed || headers.resourceState === 'trash') {
    await db
      .insert(driveFiles)
      .values({
        organizationId: conn.organizationId,
        driveConnectionId: conn.id,
        driveFileId: fileId,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        syncStatus: 'trashed',
        trashedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [driveFiles.driveConnectionId, driveFiles.driveFileId],
        set: { syncStatus: 'trashed', trashedAt: new Date(), updatedAt: new Date() },
      });
    return new Response('OK', { status: 200 });
  }

  const bytes = await downloadDriveFileBytes(drive, fileId);
  const blobPathname = `drive/${conn.organizationId}/${fileId}/${meta.fileName}`;
  const blob = await blobPut(blobPathname, bytes, meta.mimeType);

  await db
    .insert(driveFiles)
    .values({
      organizationId: conn.organizationId,
      driveConnectionId: conn.id,
      driveFileId: fileId,
      driveFolderId: meta.driveFolderId,
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes,
      blobPathname: blob.pathname,
      blobUrl: blob.url,
      syncStatus: 'synced',
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [driveFiles.driveConnectionId, driveFiles.driveFileId],
      set: {
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        blobPathname: blob.pathname,
        blobUrl: blob.url,
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  await publish(
    'files.drive.ingest',
    {
      orgId: conn.organizationId,
      driveFileId: fileId,
      driveConnectionId: conn.id,
      receivedAt: new Date().toISOString(),
    },
    vercelQueueSend,
  );

  return new Response('OK', { status: 200 });
}
```

- [ ] **Step 5: Write the route tests**

```typescript
// apps/web/app/api/webhooks/drive/route.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/integrations-drive', () => ({
  parseDriveNotificationHeaders: vi.fn(),
  verifyDriveChannelToken: vi.fn(),
  getDriveClient: vi.fn().mockReturnValue({}),
  fetchDriveFile: vi.fn(),
  downloadDriveFileBytes: vi.fn().mockResolvedValue(Buffer.from('bytes')),
}));

vi.mock('@cema/blob', () => ({
  blobPut: vi
    .fn()
    .mockResolvedValue({ pathname: 'drive/x/y/z.pdf', url: 'https://blob.example/z' }),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  orgDriveConnections: { driveChannelId: 'ch_col' },
  driveFiles: { driveConnectionId: 'conn_id_col', driveFileId: 'file_id_col' },
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn().mockReturnValue({}) }));
vi.mock('@cema/queues', () => ({ publish: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/queue', () => ({ vercelQueueSend: vi.fn().mockResolvedValue(undefined) }));

import { getDb } from '@cema/db';
import { parseDriveNotificationHeaders, verifyDriveChannelToken } from '@cema/integrations-drive';

function makeReq(headers: Record<string, string>) {
  return new Request('https://example.com/api/webhooks/drive', {
    method: 'POST',
    headers,
    body: '',
  });
}

describe('POST /api/webhooks/drive', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns 400 when X-Goog headers are missing', async () => {
    vi.mocked(parseDriveNotificationHeaders).mockReturnValue(null);
    const { POST } = await import('./route');
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 200 when the channel is unknown', async () => {
    vi.mocked(parseDriveNotificationHeaders).mockReturnValue({
      channelId: 'unknown-ch',
      channelToken: 'tok',
      resourceState: 'update',
      resourceId: 'file-1',
      messageNumber: '1',
    });
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>);
    const { POST } = await import('./route');
    const res = await POST(makeReq({}));
    expect(res.status).toBe(200);
  });

  it('returns 401 when the channel token does not match', async () => {
    vi.mocked(parseDriveNotificationHeaders).mockReturnValue({
      channelId: 'ch-1',
      channelToken: 'wrong',
      resourceState: 'update',
      resourceId: 'file-1',
      messageNumber: '1',
    });
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 'conn-1',
                organizationId: 'org-1',
                oauthRefreshToken: 'rt',
                driveChannelToken: 'expected',
              },
            ]),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>);
    vi.mocked(verifyDriveChannelToken).mockReturnValue(false);
    const { POST } = await import('./route');
    const res = await POST(makeReq({}));
    expect(res.status).toBe(401);
  });

  it('returns 200 for an initial sync handshake', async () => {
    vi.mocked(parseDriveNotificationHeaders).mockReturnValue({
      channelId: 'ch-1',
      channelToken: 'tok',
      resourceState: 'sync',
      resourceId: 'file-1',
      messageNumber: '1',
    });
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 'conn-1',
                organizationId: 'org-1',
                oauthRefreshToken: 'rt',
                driveChannelToken: 'tok',
              },
            ]),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>);
    vi.mocked(verifyDriveChannelToken).mockReturnValue(true);
    const { POST } = await import('./route');
    const res = await POST(makeReq({}));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 6: Run tests + commit**

```bash
pnpm --filter web test app/api/webhooks/drive
pnpm typecheck
git add apps/web/app/api/webhooks/drive/ apps/web/package.json packages/queues/src/topics.ts packages/integrations/drive/src/webhook.ts pnpm-lock.yaml
git commit -m "feat(webhooks): Drive push-notification webhook (M4 task 13)"
```

---

### Task 14: Server action — `listDriveFiles`

**Files:**

- Create: `apps/web/lib/actions/list-drive-files.ts` + `list-drive-files.test.ts`

- [ ] **Step 1: Implement `list-drive-files.ts`**

```typescript
// apps/web/lib/actions/list-drive-files.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { driveFiles, getDb, organizations } from '@cema/db';
import { and, desc, eq, isNull, or } from 'drizzle-orm';

import { withRls } from '../with-rls';

type DriveFile = typeof driveFiles.$inferSelect;

/**
 * List Drive files associated with a Deal. Includes files whose
 * deal_id is the requested deal, AND files where deal_id is null
 * (un-classified) — processors see un-linked files in a separate
 * "Inbox" section. Pass `includeInbox=false` to exclude them.
 */
export async function listDriveFiles(
  dealId: string,
  options: { includeInbox?: boolean } = {},
): Promise<DriveFile[]> {
  const { includeInbox = true } = options;
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const filter = includeInbox
    ? or(eq(driveFiles.dealId, dealId), isNull(driveFiles.dealId))
    : eq(driveFiles.dealId, dealId);

  return withRls(org.id, async (tx) =>
    tx
      .select()
      .from(driveFiles)
      .where(and(filter, eq(driveFiles.syncStatus, 'synced')))
      .orderBy(desc(driveFiles.lastSyncedAt)),
  );
}
```

- [ ] **Step 2: Write tests** (mirror Task 7 shape; 4 tests: missing org, empty, deal-only, deal-plus-inbox)

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter web test lib/actions/list-drive-files
pnpm typecheck
git add apps/web/lib/actions/list-drive-files.ts apps/web/lib/actions/list-drive-files.test.ts
git commit -m "feat(actions): listDriveFiles server action (M4 task 14)"
```

---

### Task 15: UI — `DriveFileCard` + Files tab on deal page

**Files:**

- Create: `apps/web/components/drive-file-card.tsx`
- Create: `apps/web/app/(app)/deals/[id]/files/page.tsx`
- Modify: `apps/web/app/(app)/deals/[id]/page.tsx` (add a "Files" link)

- [ ] **Step 1: Create `DriveFileCard`**

```tsx
// apps/web/components/drive-file-card.tsx
import type { driveFiles } from '@cema/db';

type DriveFile = typeof driveFiles.$inferSelect;

interface DriveFileCardProps {
  file: DriveFile;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const SYNC_BADGE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  syncing: 'bg-yellow-100 text-yellow-700',
  synced: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  trashed: 'bg-gray-200 text-gray-500 line-through',
};

export function DriveFileCard({ file }: DriveFileCardProps) {
  const href = file.blobUrl ?? '#';
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:bg-muted/50 block rounded-lg border bg-white p-4 shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span aria-label="File">📄</span>
            <p className="truncate text-sm font-medium">{file.fileName ?? '(unnamed)'}</p>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {file.mimeType ?? 'unknown'} · {formatBytes(file.sizeBytes)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="text-muted-foreground text-xs">{formatDate(file.lastSyncedAt)}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${SYNC_BADGE[file.syncStatus] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {file.syncStatus}
          </span>
        </div>
      </div>
    </a>
  );
}
```

- [ ] **Step 2: Create the Files page**

```tsx
// apps/web/app/(app)/deals/[id]/files/page.tsx
import { notFound } from 'next/navigation';

import { DriveFileCard } from '@/components/drive-file-card';
import { listDriveFiles } from '@/lib/actions/list-drive-files';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params;
  const files = await listDriveFiles(dealId);

  if (files === null) notFound();

  const linked = files.filter((f) => f.dealId === dealId);
  const inbox = files.filter((f) => f.dealId === null);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Files</h1>

      {linked.length === 0 && inbox.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm font-medium">No files yet</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Files synced from Google Drive will appear here once a Drive folder is linked to this
            deal.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {linked.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-medium">Linked to deal</h2>
              <ul className="space-y-2" role="list">
                {linked.map((f) => (
                  <li key={f.id}>
                    <DriveFileCard file={f} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {inbox.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-medium">Inbox (un-linked)</h2>
              <ul className="space-y-2" role="list">
                {inbox.map((f) => (
                  <li key={f.id}>
                    <DriveFileCard file={f} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire the Files tab into the deal layout**

Locate the existing `apps/web/app/(app)/deals/[id]/page.tsx` (or the parent layout) and add a link to `/deals/[id]/files`. Pattern matches the existing Communications link. Use `Route` cast if the codebase uses typed routes.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck
pnpm --filter web test
git add apps/web/components/drive-file-card.tsx "apps/web/app/(app)/deals/[id]/files/" "apps/web/app/(app)/deals/[id]/page.tsx"
git commit -m "feat(ui): DriveFileCard + per-deal Files page (M4 task 15)"
```

---

### Subsystem 3 — DocuSign (Tasks 16–22)

---

### Task 16: DB — `org_docusign_connections` table (migration 0021)

**Files:**

- Create: `packages/db/src/schema/docusign-connections.ts`
- Create: `packages/db/migrations/0021_docusign_connections.sql`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// packages/db/src/schema/docusign-connections.ts
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { organizations, users } from './tenants';

// One row per DocuSign account a CEMA org has connected.
//   docusign_account_id = the production-vs-demo account GUID
//   docusign_base_url   = the account-specific REST base URL
//                         (returned by /oauth/userinfo at install time)
//   connect_secret      = HMAC secret rotated per connection;
//                         used to verify inbound Connect webhooks
export const orgDocusignConnections = pgTable(
  'org_docusign_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    docusignAccountId: varchar('docusign_account_id', { length: 64 }).notNull(),
    docusignBaseUrl: varchar('docusign_base_url', { length: 256 }).notNull(),
    docusignUserId: varchar('docusign_user_id', { length: 64 }),
    integrationKey: varchar('integration_key', { length: 128 }).notNull(),
    rsaPrivateKey: text('rsa_private_key').notNull(),
    connectSecret: text('connect_secret').notNull(),
    connectionStatus: varchar('connection_status', { length: 32 }).notNull().default('active'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('org_docusign_connections_account_uidx').on(t.docusignAccountId),
    uniqueIndex('org_docusign_connections_org_account_uidx').on(
      t.organizationId,
      t.docusignAccountId,
    ),
    index('org_docusign_connections_org_id_idx').on(t.organizationId),
    check(
      'org_docusign_connections_status_valid',
      sql`${t.connectionStatus} IN ('active', 'error', 'revoked')`,
    ),
    check(
      'org_docusign_connections_revoked_at_required',
      sql`(${t.connectionStatus} = 'revoked' AND ${t.revokedAt} IS NOT NULL) OR (${t.connectionStatus} <> 'revoked' AND ${t.revokedAt} IS NULL)`,
    ),
  ],
);
```

- [ ] **Step 2: Export, generate, rename to `0021_docusign_connections.sql`, apply, commit**

```bash
# Add `export * from './docusign-connections';` to schema index.
pnpm --filter @cema/db db:generate
# Rename produced file + update journal tag.
pnpm --filter @cema/db db:migrate
pnpm typecheck
git add packages/db/src/schema/docusign-connections.ts packages/db/src/schema/index.ts packages/db/migrations/0021_docusign_connections.sql packages/db/migrations/meta/
git commit -m "feat(db): add org_docusign_connections table (M4 task 16)"
```

---

### Task 17: DB — `docusign_envelopes` table + status enum (migration 0022)

**Files:**

- Create: `packages/db/src/schema/docusign-envelopes.ts`
- Create: `packages/db/migrations/0022_docusign_envelopes.sql`
- Modify: `packages/db/src/schema/enums.ts` (add `envelopeStatusEnum`)
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Add the envelope status enum**

In `packages/db/src/schema/enums.ts`:

```typescript
// DocuSign envelope lifecycle. The values are DocuSign's own and we
// don't translate — keeping their casing/spelling makes status mirror
// a one-to-one copy, no mapping required.
export const envelopeStatusEnum = pgEnum('envelope_status', [
  'created',
  'sent',
  'delivered',
  'signed',
  'completed',
  'declined',
  'voided',
]);
```

- [ ] **Step 2: Write the schema file**

```typescript
// packages/db/src/schema/docusign-envelopes.ts
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { documents } from './documents';
import { orgDocusignConnections } from './docusign-connections';
import { envelopeStatusEnum } from './enums';
import { organizations, users } from './tenants';

export interface DocusignRecipient {
  email: string;
  name: string;
  role: string;
  routingOrder: number;
  status: 'created' | 'sent' | 'delivered' | 'signed' | 'declined' | 'completed';
  signedAt: string | null;
}

export const docusignEnvelopes = pgTable(
  'docusign_envelopes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    docusignConnectionId: uuid('docusign_connection_id')
      .notNull()
      .references(() => orgDocusignConnections.id, { onDelete: 'restrict' }),
    // The CEMA-side document this envelope wraps. Required —
    // every envelope is tied to a Document.
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    // Vendor envelope ID — globally unique per DocuSign account.
    docusignEnvelopeId: varchar('docusign_envelope_id', { length: 128 }).notNull(),
    status: envelopeStatusEnum('status').notNull().default('created'),
    subject: text('subject'),
    recipients: jsonb('recipients').$type<DocusignRecipient[]>().default([]).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    voidedReason: text('voided_reason'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('docusign_envelopes_docusign_envelope_id_uidx').on(
      t.docusignConnectionId,
      t.docusignEnvelopeId,
    ),
    index('docusign_envelopes_organization_id_idx').on(t.organizationId),
    index('docusign_envelopes_document_id_idx').on(t.documentId),
    index('docusign_envelopes_org_status_idx').on(t.organizationId, t.status),
    check(
      'docusign_envelopes_completed_at_requires_status',
      sql`${t.completedAt} IS NULL OR ${t.status} IN ('completed', 'signed', 'voided', 'declined')`,
    ),
  ],
);
```

- [ ] **Step 3: Export, generate, rename to `0022_docusign_envelopes.sql`, apply**

```bash
# Append `export * from './docusign-envelopes';` to schema index.
pnpm --filter @cema/db db:generate
# Rename produced file + update journal tag.
pnpm --filter @cema/db db:migrate
pnpm typecheck
git add packages/db/src/schema/docusign-envelopes.ts packages/db/src/schema/enums.ts packages/db/src/schema/index.ts packages/db/migrations/0022_docusign_envelopes.sql packages/db/migrations/meta/
git commit -m "feat(db): add docusign_envelopes table + envelope_status enum (M4 task 17)"
```

---

### Task 18: `@cema/integrations-docusign` package scaffold + types

**Files:**

- Create: `packages/integrations/docusign/package.json`
- Create: `packages/integrations/docusign/tsconfig.json`
- Create: `packages/integrations/docusign/src/index.ts`
- Create: `packages/integrations/docusign/src/types.ts`
- Stubs: `packages/integrations/docusign/src/client.ts`, `packages/integrations/docusign/src/webhook.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@cema/integrations-docusign",
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
    "docusign-esign": "^8.0.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json` (copy from deepgram)**

- [ ] **Step 3: Install** — `pnpm install`

- [ ] **Step 4: Write `types.ts`**

```typescript
// packages/integrations/docusign/src/types.ts

export interface DocusignRecipientInput {
  email: string;
  name: string;
  role: string;
  routingOrder?: number;
}

export interface CreateEnvelopeInput {
  subject: string;
  emailBlurb?: string;
  documentName: string;
  documentBytes: Buffer;
  documentFileExtension: string;
  recipients: DocusignRecipientInput[];
  // Optional EnvelopeStatus override. Defaults to 'sent' which sends
  // the envelope immediately. Use 'created' to save as draft.
  status?: 'created' | 'sent';
}

export interface CreateEnvelopeResult {
  envelopeId: string;
  status: string;
  uri: string;
  statusDateTime: string;
}

export type DocusignEnvelopeEvent =
  | 'envelope-sent'
  | 'envelope-delivered'
  | 'recipient-completed'
  | 'envelope-completed'
  | 'envelope-declined'
  | 'envelope-voided'
  | string;

export interface NormalizedConnectPayload {
  event: DocusignEnvelopeEvent;
  envelopeId: string;
  status: string;
  statusChangedDateTime: string;
  subject: string;
  recipients: Array<{
    email: string;
    name: string;
    routingOrder: number;
    status: string;
    signedDateTime: string | null;
  }>;
  voidedReason: string | null;
  raw: Record<string, unknown>;
}
```

- [ ] **Step 5: `index.ts` + stubs + typecheck + commit**

```typescript
// packages/integrations/docusign/src/index.ts
export * from './types';
export * from './client';
export * from './webhook';
```

```typescript
// packages/integrations/docusign/src/client.ts
export {};

// packages/integrations/docusign/src/webhook.ts
export {};
```

```bash
pnpm --filter @cema/integrations-docusign typecheck
git add packages/integrations/docusign/ pnpm-lock.yaml
git commit -m "feat(integrations): scaffold @cema/integrations-docusign (M4 task 18)"
```

---

### Task 19: DocuSign Connect HMAC verification + envelope client

**Files:**

- Modify: `packages/integrations/docusign/src/webhook.ts`
- Create: `packages/integrations/docusign/src/webhook.test.ts`
- Modify: `packages/integrations/docusign/src/client.ts`
- Create: `packages/integrations/docusign/src/client.test.ts`

- [ ] **Step 1: Write `webhook.ts`**

```typescript
// packages/integrations/docusign/src/webhook.ts
import { createHmac } from 'node:crypto';

import type { NormalizedConnectPayload } from './types';

// DocuSign Connect: HMAC-SHA256 base64-encoded over the raw body.
// Header name (verify against the DocuSign admin config): X-DocuSign-Signature-1.
export function verifyDocusignSignature(
  connectSecret: string,
  signatureHeader: string,
  rawBody: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', connectSecret).update(rawBody).digest('base64');
  return expected === signatureHeader;
}

export function parseDocusignConnectPayload(rawBody: string): NormalizedConnectPayload {
  const payload = JSON.parse(rawBody) as {
    event: string;
    data?: {
      envelopeId?: string;
      envelopeSummary?: {
        status?: string;
        statusChangedDateTime?: string;
        emailSubject?: string;
        recipients?: {
          signers?: Array<{
            email?: string;
            name?: string;
            routingOrder?: string | number;
            status?: string;
            signedDateTime?: string;
          }>;
        };
        voidedReason?: string;
      };
    };
  };

  const env = payload.data?.envelopeSummary ?? {};
  const signers = env.recipients?.signers ?? [];

  return {
    event: payload.event,
    envelopeId: payload.data?.envelopeId ?? '',
    status: env.status ?? '',
    statusChangedDateTime: env.statusChangedDateTime ?? '',
    subject: env.emailSubject ?? '',
    recipients: signers.map((s) => ({
      email: s.email ?? '',
      name: s.name ?? '',
      routingOrder: Number(s.routingOrder ?? 0),
      status: s.status ?? '',
      signedDateTime: s.signedDateTime ?? null,
    })),
    voidedReason: env.voidedReason ?? null,
    raw: payload as unknown as Record<string, unknown>,
  };
}
```

- [ ] **Step 2: Write webhook tests**

```typescript
// packages/integrations/docusign/src/webhook.test.ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseDocusignConnectPayload, verifyDocusignSignature } from './webhook';

const SECRET = 'connect-secret-abc';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('base64');
}

const COMPLETED_PAYLOAD = JSON.stringify({
  event: 'envelope-completed',
  data: {
    envelopeId: 'env-001',
    envelopeSummary: {
      status: 'completed',
      statusChangedDateTime: '2026-05-22T15:00:00Z',
      emailSubject: 'Please sign your CEMA',
      recipients: {
        signers: [
          {
            email: 'borrower@example.com',
            name: 'Borrower Name',
            routingOrder: '1',
            status: 'completed',
            signedDateTime: '2026-05-22T15:00:00Z',
          },
        ],
      },
    },
  },
});

describe('verifyDocusignSignature', () => {
  it('returns true for a valid base64 HMAC', () => {
    expect(verifyDocusignSignature(SECRET, sign(COMPLETED_PAYLOAD), COMPLETED_PAYLOAD)).toBe(true);
  });

  it('returns false for tampered body', () => {
    expect(verifyDocusignSignature(SECRET, sign(COMPLETED_PAYLOAD), COMPLETED_PAYLOAD + 'x')).toBe(
      false,
    );
  });

  it('returns false when signature header is empty', () => {
    expect(verifyDocusignSignature(SECRET, '', COMPLETED_PAYLOAD)).toBe(false);
  });
});

describe('parseDocusignConnectPayload', () => {
  it('extracts envelope + recipient status', () => {
    const parsed = parseDocusignConnectPayload(COMPLETED_PAYLOAD);
    expect(parsed.envelopeId).toBe('env-001');
    expect(parsed.status).toBe('completed');
    expect(parsed.recipients).toHaveLength(1);
    expect(parsed.recipients[0]!.signedDateTime).toBe('2026-05-22T15:00:00Z');
  });
});
```

- [ ] **Step 3: Write `client.ts`**

```typescript
// packages/integrations/docusign/src/client.ts
import * as docusign from 'docusign-esign';

import type { CreateEnvelopeInput, CreateEnvelopeResult } from './types';

export interface GetDocusignClientInput {
  baseUrl: string;
  integrationKey: string;
  userId: string;
  rsaPrivateKey: string;
}

/**
 * Build an ApiClient and acquire a JWT-based access token for the
 * DocuSign account. JWT auth requires the integration key + RSA
 * keypair configured in the DocuSign admin app.
 */
export async function getDocusignClient(
  input: GetDocusignClientInput,
): Promise<docusign.ApiClient> {
  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(input.baseUrl);

  const oauthHost = input.baseUrl.includes('demo')
    ? 'account-d.docusign.com'
    : 'account.docusign.com';
  apiClient.setOAuthBasePath(oauthHost);

  const result = (await apiClient.requestJWTUserToken(
    input.integrationKey,
    input.userId,
    ['signature', 'impersonation'],
    Buffer.from(input.rsaPrivateKey),
    3600,
  )) as { body: { access_token: string } };

  apiClient.addDefaultHeader('Authorization', `Bearer ${result.body.access_token}`);
  return apiClient;
}

export async function createEnvelope(
  apiClient: docusign.ApiClient,
  accountId: string,
  input: CreateEnvelopeInput,
): Promise<CreateEnvelopeResult> {
  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  const envDef = new docusign.EnvelopeDefinition();
  envDef.emailSubject = input.subject;
  if (input.emailBlurb) envDef.emailBlurb = input.emailBlurb;

  const doc = new docusign.Document();
  doc.documentBase64 = input.documentBytes.toString('base64');
  doc.name = input.documentName;
  doc.fileExtension = input.documentFileExtension;
  doc.documentId = '1';
  envDef.documents = [doc];

  envDef.recipients = new docusign.Recipients();
  envDef.recipients.signers = input.recipients.map((r, idx) => {
    const s = new docusign.Signer();
    s.email = r.email;
    s.name = r.name;
    s.recipientId = String(idx + 1);
    s.routingOrder = String(r.routingOrder ?? idx + 1);
    s.roleName = r.role;
    return s;
  });

  envDef.status = input.status ?? 'sent';

  const res = (await envelopesApi.createEnvelope(accountId, {
    envelopeDefinition: envDef,
  })) as {
    envelopeId?: string;
    status?: string;
    uri?: string;
    statusDateTime?: string;
  };

  return {
    envelopeId: res.envelopeId ?? '',
    status: res.status ?? '',
    uri: res.uri ?? '',
    statusDateTime: res.statusDateTime ?? '',
  };
}
```

- [ ] **Step 4: Write client tests**

```typescript
// packages/integrations/docusign/src/client.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('docusign-esign', () => {
  class FakeApiClient {
    setBasePath = vi.fn();
    setOAuthBasePath = vi.fn();
    addDefaultHeader = vi.fn();
    requestJWTUserToken = vi.fn().mockResolvedValue({ body: { access_token: 'tok' } });
  }
  class FakeEnvelopesApi {
    constructor(public client: unknown) {}
    createEnvelope = vi.fn().mockResolvedValue({
      envelopeId: 'env-1',
      status: 'sent',
      uri: '/envelopes/env-1',
      statusDateTime: '2026-05-22T15:00:00Z',
    });
  }
  class FakeEnvelopeDefinition {
    documents?: unknown[];
    recipients?: { signers: unknown[] };
    status?: string;
    emailSubject?: string;
    emailBlurb?: string;
  }
  class FakeDocument {
    documentBase64?: string;
    name?: string;
    fileExtension?: string;
    documentId?: string;
  }
  class FakeRecipients {
    signers: unknown[] = [];
  }
  class FakeSigner {
    email?: string;
    name?: string;
    recipientId?: string;
    routingOrder?: string;
    roleName?: string;
  }
  return {
    ApiClient: FakeApiClient,
    EnvelopesApi: FakeEnvelopesApi,
    EnvelopeDefinition: FakeEnvelopeDefinition,
    Document: FakeDocument,
    Recipients: FakeRecipients,
    Signer: FakeSigner,
  };
});

import { createEnvelope, getDocusignClient } from './client';

describe('getDocusignClient', () => {
  it('acquires a JWT access token and sets Authorization header', async () => {
    const client = await getDocusignClient({
      baseUrl: 'https://demo.docusign.net/restapi',
      integrationKey: 'IK',
      userId: 'U',
      rsaPrivateKey: 'KEY',
    });
    expect(client).toBeDefined();
  });
});

describe('createEnvelope', () => {
  it('returns the created envelope id and status', async () => {
    const client = await getDocusignClient({
      baseUrl: 'https://demo.docusign.net/restapi',
      integrationKey: 'IK',
      userId: 'U',
      rsaPrivateKey: 'KEY',
    });
    const res = await createEnvelope(client, 'ACCT', {
      subject: 'Please sign',
      documentName: 'CEMA.pdf',
      documentBytes: Buffer.from('PDF'),
      documentFileExtension: 'pdf',
      recipients: [{ email: 'b@example.com', name: 'Borrower', role: 'signer' }],
    });
    expect(res.envelopeId).toBe('env-1');
    expect(res.status).toBe('sent');
  });
});
```

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter @cema/integrations-docusign test
pnpm --filter @cema/integrations-docusign typecheck
git add packages/integrations/docusign/src/webhook.ts packages/integrations/docusign/src/webhook.test.ts packages/integrations/docusign/src/client.ts packages/integrations/docusign/src/client.test.ts
git commit -m "feat(integrations): DocuSign Connect HMAC + envelope client (M4 task 19)"
```

---

### Task 20: DocuSign Connect webhook route

**Files:**

- Create: `apps/web/app/api/webhooks/docusign/route.ts`
- Create: `apps/web/app/api/webhooks/docusign/route.test.ts`
- Modify: `packages/queues/src/topics.ts` (add `esign.docusign.events`)
- Modify: `apps/web/package.json` (add `@cema/integrations-docusign`)

- [ ] **Step 1: Add the queue topic + workspace dep**

```typescript
// packages/queues/src/topics.ts
'esign.docusign.events': z.object({
  orgId: z.string(),
  envelopeId: z.string(),
  event: z.string(),
  receivedAt: z.string().datetime(),
}),
```

```json
// apps/web/package.json — add to dependencies
"@cema/integrations-docusign": "workspace:*",
```

Then `pnpm install`.

- [ ] **Step 2: Implement `route.ts`**

```typescript
// apps/web/app/api/webhooks/docusign/route.ts
import { emitAuditEvent } from '@cema/compliance';
import { docusignEnvelopes, getDb, orgDocusignConnections } from '@cema/db';
import { parseDocusignConnectPayload, verifyDocusignSignature } from '@cema/integrations-docusign';
import { publish } from '@cema/queues';
import { and, eq } from 'drizzle-orm';

import { vercelQueueSend } from '@/lib/queue';

const STATUS_MAP: Record<string, string> = {
  created: 'created',
  sent: 'sent',
  delivered: 'delivered',
  signed: 'signed',
  completed: 'completed',
  declined: 'declined',
  voided: 'voided',
};

export async function POST(req: Request): Promise<Response> {
  const sig = req.headers.get('x-docusign-signature-1') ?? '';
  const rawBody = await req.text();

  // We resolve which org this envelope belongs to BEFORE verifying the
  // signature because the connect_secret is per-connection. Parse the
  // body once (unsafely) to extract envelopeId, look up the connection,
  // then verify with that connection's secret.
  let envelopeIdHint: string | null = null;
  try {
    const peek = JSON.parse(rawBody) as { data?: { envelopeId?: string } };
    envelopeIdHint = peek.data?.envelopeId ?? null;
  } catch {
    return new Response('Bad Request — invalid JSON', { status: 400 });
  }

  if (!envelopeIdHint) {
    return new Response('Bad Request — missing envelopeId', { status: 400 });
  }

  const db = getDb();
  const [envRow] = await db
    .select({
      envelopeRowId: docusignEnvelopes.id,
      organizationId: docusignEnvelopes.organizationId,
      documentId: docusignEnvelopes.documentId,
      docusignConnectionId: docusignEnvelopes.docusignConnectionId,
    })
    .from(docusignEnvelopes)
    .where(eq(docusignEnvelopes.docusignEnvelopeId, envelopeIdHint))
    .limit(1);

  if (!envRow) {
    // Envelope not known — return 200 so DocuSign stops retrying.
    return new Response('OK', { status: 200 });
  }

  const [conn] = await db
    .select({ connectSecret: orgDocusignConnections.connectSecret })
    .from(orgDocusignConnections)
    .where(eq(orgDocusignConnections.id, envRow.docusignConnectionId))
    .limit(1);

  if (!conn || !verifyDocusignSignature(conn.connectSecret, sig, rawBody)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const parsed = parseDocusignConnectPayload(rawBody);
  const newStatus = (STATUS_MAP[parsed.status] ?? parsed.status) as
    | 'created'
    | 'sent'
    | 'delivered'
    | 'signed'
    | 'completed'
    | 'declined'
    | 'voided';

  const isTerminal = ['completed', 'declined', 'voided', 'signed'].includes(newStatus);

  await db
    .update(docusignEnvelopes)
    .set({
      status: newStatus,
      recipients: parsed.recipients.map((r) => ({
        email: r.email,
        name: r.name,
        role: 'signer',
        routingOrder: r.routingOrder,
        status: r.status as 'created' | 'sent' | 'delivered' | 'signed' | 'declined' | 'completed',
        signedAt: r.signedDateTime,
      })),
      completedAt: isTerminal ? new Date() : null,
      voidedReason: newStatus === 'voided' ? parsed.voidedReason : null,
      updatedAt: new Date(),
    })
    .where(eq(docusignEnvelopes.id, envRow.envelopeRowId));

  await emitAuditEvent(db, {
    organizationId: envRow.organizationId,
    action: `envelope.${parsed.event}`,
    entityType: 'docusign_envelope',
    entityId: envRow.envelopeRowId,
    metadata: {
      envelopeId: envelopeIdHint,
      status: parsed.status,
      statusChangedDateTime: parsed.statusChangedDateTime,
    },
  });

  await publish(
    'esign.docusign.events',
    {
      orgId: envRow.organizationId,
      envelopeId: envelopeIdHint,
      event: parsed.event,
      receivedAt: new Date().toISOString(),
    },
    vercelQueueSend,
  );

  return new Response('OK', { status: 200 });
}
```

- [ ] **Step 3: Write route tests**

Mirror the M3 Nylas route test shape. Mock `@cema/db`, `@cema/integrations-docusign`, `@cema/compliance` (for `emitAuditEvent`), `@cema/queues`, `@/lib/queue`. Cover 4 cases: missing envelopeId, unknown envelope, bad signature, happy path.

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter web test app/api/webhooks/docusign
pnpm typecheck
git add apps/web/app/api/webhooks/docusign/ apps/web/package.json packages/queues/src/topics.ts pnpm-lock.yaml
git commit -m "feat(webhooks): DocuSign Connect webhook (M4 task 20)"
```

---

### Task 21: Server actions — `sendEnvelope` (attorney-review gated) + `listEnvelopes` + `getEnvelope`

**Files:**

- Create: `apps/web/lib/actions/send-envelope.ts` + `send-envelope.test.ts`
- Create: `apps/web/lib/actions/list-envelopes.ts` + `list-envelopes.test.ts`
- Create: `apps/web/lib/actions/get-envelope.ts` + `get-envelope.test.ts`

- [ ] **Step 1: Implement `send-envelope.ts` — the attorney-review gate is in this file**

```typescript
// apps/web/lib/actions/send-envelope.ts
'use server';

import { getCurrentOrganizationId, getCurrentUserId } from '@cema/auth';
import { blobGet } from '@cema/blob';
import { emitAuditEvent } from '@cema/compliance';
import {
  attorneyApprovals,
  documents,
  docusignEnvelopes,
  getDb,
  orgDocusignConnections,
  organizations,
} from '@cema/db';
import { createEnvelope, getDocusignClient } from '@cema/integrations-docusign';
import { and, desc, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export class AttorneyReviewMissingError extends Error {
  constructor(documentId: string) {
    super(`Document ${documentId} requires attorney review but has no AttorneyApproval event`);
    this.name = 'AttorneyReviewMissingError';
  }
}

export class DocusignConnectionMissingError extends Error {
  constructor(orgId: string) {
    super(`Organization ${orgId} has no active DocuSign connection`);
    this.name = 'DocusignConnectionMissingError';
  }
}

export interface SendEnvelopeInput {
  documentId: string;
  subject: string;
  recipients: Array<{ email: string; name: string; role: string }>;
}

export interface SendEnvelopeResult {
  envelopeRowId: string;
  docusignEnvelopeId: string;
  status: string;
}

/**
 * Send a CEMA document for signature via DocuSign.
 *
 * HARD RULE #2 (CLAUDE.md §3): if `documents.attorney_review_required = true`,
 * an `AttorneyApproval` event must exist for (documentId, documentVersion).
 * This action throws AttorneyReviewMissingError otherwise. The gate runs
 * server-side; client-side checks are advisory only.
 */
export async function sendEnvelope(input: SendEnvelopeInput): Promise<SendEnvelopeResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const userId = await getCurrentUserId();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not found');

  // 1. Fetch the document inside withRls — proves the caller can see it.
  const docRows = await withRls(org.id, async (tx) =>
    tx.select().from(documents).where(eq(documents.id, input.documentId)).limit(1),
  );
  const doc = docRows[0];
  if (!doc) throw new Error(`Document ${input.documentId} not found`);

  // 2. Attorney-review gate.
  if (doc.attorneyReviewRequired) {
    const approvals = await withRls(org.id, async (tx) =>
      tx
        .select({ id: attorneyApprovals.id })
        .from(attorneyApprovals)
        .where(
          and(
            eq(attorneyApprovals.documentId, doc.id),
            eq(attorneyApprovals.documentVersion, doc.version),
          ),
        )
        .limit(1),
    );
    if (approvals.length === 0) {
      throw new AttorneyReviewMissingError(doc.id);
    }
  }

  // 3. Resolve the connection (most-recent active row).
  const [conn] = await db
    .select()
    .from(orgDocusignConnections)
    .where(
      and(
        eq(orgDocusignConnections.organizationId, org.id),
        eq(orgDocusignConnections.connectionStatus, 'active'),
      ),
    )
    .orderBy(desc(orgDocusignConnections.createdAt))
    .limit(1);

  if (!conn) throw new DocusignConnectionMissingError(org.id);

  // 4. Pull the document bytes from Blob.
  if (!doc.blobPathname) throw new Error(`Document ${doc.id} has no blob_pathname`);
  const bytes = await blobGet(doc.blobPathname);

  // 5. Create the envelope.
  const apiClient = await getDocusignClient({
    baseUrl: conn.docusignBaseUrl,
    integrationKey: conn.integrationKey,
    userId: conn.docusignUserId ?? '',
    rsaPrivateKey: conn.rsaPrivateKey,
  });
  const created = await createEnvelope(apiClient, conn.docusignAccountId, {
    subject: input.subject,
    documentName: doc.fileName ?? `document-${doc.id}.pdf`,
    documentBytes: bytes,
    documentFileExtension: 'pdf',
    recipients: input.recipients,
    status: 'sent',
  });

  // 6. Insert the envelope row.
  const [row] = await db
    .insert(docusignEnvelopes)
    .values({
      organizationId: org.id,
      docusignConnectionId: conn.id,
      documentId: doc.id,
      docusignEnvelopeId: created.envelopeId,
      status: 'sent',
      subject: input.subject,
      recipients: input.recipients.map((r, idx) => ({
        email: r.email,
        name: r.name,
        role: r.role,
        routingOrder: idx + 1,
        status: 'sent',
        signedAt: null,
      })),
      sentAt: new Date(),
      createdById: userId,
    })
    .returning();

  if (!row) throw new Error('Failed to insert docusign_envelopes row');

  // 7. Audit event — neondb_owner-scoped via emitAuditEvent.
  await emitAuditEvent(db, {
    organizationId: org.id,
    action: 'envelope.created',
    entityType: 'docusign_envelope',
    entityId: row.id,
    metadata: {
      envelopeId: created.envelopeId,
      documentId: doc.id,
      recipientCount: input.recipients.length,
    },
  });

  return { envelopeRowId: row.id, docusignEnvelopeId: created.envelopeId, status: created.status };
}
```

- [ ] **Step 2: Write the failing tests — focus on the attorney-review gate**

```typescript
// apps/web/lib/actions/send-envelope.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
  getCurrentUserId: vi.fn().mockResolvedValue('user-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  documents: { id: 'id_col' },
  attorneyApprovals: { documentId: 'doc_col', documentVersion: 'ver_col' },
  orgDocusignConnections: {
    organizationId: 'org_col',
    connectionStatus: 'status_col',
    createdAt: 'created_col',
  },
  docusignEnvelopes: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/blob', () => ({ blobGet: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')) }));
vi.mock('@cema/compliance', () => ({ emitAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@cema/integrations-docusign', () => ({
  getDocusignClient: vi.fn().mockResolvedValue({}),
  createEnvelope: vi.fn().mockResolvedValue({
    envelopeId: 'ds-env-1',
    status: 'sent',
    uri: '/e',
    statusDateTime: '2026-05-22T15:00:00Z',
  }),
}));
vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { AttorneyReviewMissingError, sendEnvelope } from './send-envelope';

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };
const DOC_REVIEW_REQUIRED = {
  id: 'doc-1',
  kind: 'cema_3172',
  attorneyReviewRequired: true,
  version: 1,
  blobPathname: 'docs/org-1/doc-1.pdf',
  fileName: 'cema.pdf',
};
const DOC_NO_REVIEW = { ...DOC_REVIEW_REQUIRED, attorneyReviewRequired: false };

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue({
    query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 'conn-1',
                docusignAccountId: 'ACCT',
                docusignBaseUrl: 'https://demo.docusign.net/restapi',
                integrationKey: 'IK',
                docusignUserId: 'U',
                rsaPrivateKey: 'KEY',
              },
            ]),
          }),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'row-1' }]),
      }),
    }),
  } as unknown as ReturnType<typeof getDb>);
});

afterEach(() => vi.clearAllMocks());

describe('sendEnvelope — attorney-review gate', () => {
  it('throws AttorneyReviewMissingError when doc requires review and no approval exists', async () => {
    vi.mocked(withRls)
      .mockImplementationOnce(async (_org, fn) =>
        fn({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([DOC_REVIEW_REQUIRED]),
              }),
            }),
          }),
        } as never),
      )
      .mockImplementationOnce(async (_org, fn) =>
        fn({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        } as never),
      );

    await expect(
      sendEnvelope({
        documentId: 'doc-1',
        subject: 'Please sign',
        recipients: [{ email: 'b@example.com', name: 'Borrower', role: 'signer' }],
      }),
    ).rejects.toBeInstanceOf(AttorneyReviewMissingError);
  });

  it('proceeds when doc requires review AND an approval exists', async () => {
    vi.mocked(withRls)
      .mockImplementationOnce(async (_org, fn) =>
        fn({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([DOC_REVIEW_REQUIRED]),
              }),
            }),
          }),
        } as never),
      )
      .mockImplementationOnce(async (_org, fn) =>
        fn({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'approval-1' }]),
              }),
            }),
          }),
        } as never),
      );

    const res = await sendEnvelope({
      documentId: 'doc-1',
      subject: 'Please sign',
      recipients: [{ email: 'b@example.com', name: 'Borrower', role: 'signer' }],
    });
    expect(res.docusignEnvelopeId).toBe('ds-env-1');
  });

  it('proceeds when doc does NOT require review (no approval check)', async () => {
    vi.mocked(withRls).mockImplementationOnce(async (_org, fn) =>
      fn({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([DOC_NO_REVIEW]),
            }),
          }),
        }),
      } as never),
    );

    const res = await sendEnvelope({
      documentId: 'doc-1',
      subject: 'Please sign',
      recipients: [{ email: 'b@example.com', name: 'Borrower', role: 'signer' }],
    });
    expect(res.docusignEnvelopeId).toBe('ds-env-1');
  });
});
```

- [ ] **Step 3: Implement `list-envelopes.ts` + `get-envelope.ts`**

Mirror the M3 `list-emails.ts` / `get-email.ts` pattern, joining `docusign_envelopes` to `documents` by `documentId`. Filter by deal via `documents.dealId`.

- [ ] **Step 4: Tests for list/get** — 4 tests each.

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter web test lib/actions/send-envelope lib/actions/list-envelopes lib/actions/get-envelope
pnpm typecheck
git add apps/web/lib/actions/send-envelope.ts apps/web/lib/actions/send-envelope.test.ts apps/web/lib/actions/list-envelopes.ts apps/web/lib/actions/list-envelopes.test.ts apps/web/lib/actions/get-envelope.ts apps/web/lib/actions/get-envelope.test.ts
git commit -m "feat(actions): sendEnvelope (attorney-review gated) + list/get envelopes (M4 task 21)"
```

---

### Task 22: UI — `EnvelopeStatusCard` + Send-for-Signature button

**Files:**

- Create: `apps/web/components/envelope-status-card.tsx`
- Create: `apps/web/components/send-for-signature-button.tsx`
- Modify: the document detail page (locate `apps/web/app/(app)/deals/[id]/documents/[docId]/page.tsx` or equivalent; wire the button)

- [ ] **Step 1: Create `EnvelopeStatusCard`**

```tsx
// apps/web/components/envelope-status-card.tsx
import type { docusignEnvelopes } from '@cema/db';

type Envelope = typeof docusignEnvelopes.$inferSelect;

const STATUS_PILL: Record<string, string> = {
  created: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  delivered: 'bg-yellow-100 text-yellow-700',
  signed: 'bg-green-100 text-green-700',
  completed: 'bg-green-200 text-green-800',
  declined: 'bg-red-100 text-red-700',
  voided: 'bg-gray-200 text-gray-500 line-through',
};

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function EnvelopeStatusCard({ envelope }: { envelope: Envelope }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{envelope.subject ?? '(no subject)'}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Sent {formatDate(envelope.sentAt)} · {envelope.recipients?.length ?? 0} recipient(s)
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_PILL[envelope.status] ?? 'bg-gray-100 text-gray-600'}`}
        >
          {envelope.status}
        </span>
      </div>

      <ul className="mt-3 space-y-1">
        {(envelope.recipients ?? []).map((r) => (
          <li key={r.email} className="text-muted-foreground flex justify-between text-xs">
            <span>
              {r.name} ({r.email})
            </span>
            <span className="capitalize">
              {r.status}
              {r.signedAt ? ` · ${formatDate(new Date(r.signedAt))}` : ''}
            </span>
          </li>
        ))}
      </ul>

      {envelope.status === 'voided' && envelope.voidedReason ? (
        <p className="mt-2 text-xs text-red-700">Voided: {envelope.voidedReason}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create `SendForSignatureButton`**

```tsx
// apps/web/components/send-for-signature-button.tsx
'use client';

import { useState, useTransition } from 'react';

import { sendEnvelope } from '@/lib/actions/send-envelope';

interface SendForSignatureButtonProps {
  documentId: string;
  defaultSubject: string;
  recipients: Array<{ email: string; name: string; role: string }>;
  disabled?: boolean;
  disabledReason?: string;
}

export function SendForSignatureButton({
  documentId,
  defaultSubject,
  recipients,
  disabled,
  disabledReason,
}: SendForSignatureButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentEnvelopeId, setSentEnvelopeId] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await sendEnvelope({
          documentId,
          subject: defaultSubject,
          recipients,
        });
        setSentEnvelopeId(res.docusignEnvelopeId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (sentEnvelopeId) {
    return (
      <p className="text-sm text-green-700">
        Sent for signature. DocuSign envelope {sentEnvelopeId}.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isPending}
        className="inline-flex items-center rounded-md border bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {isPending ? 'Sending…' : 'Send for signature'}
      </button>
      {disabled && disabledReason ? (
        <p className="text-muted-foreground text-xs">{disabledReason}</p>
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3: Wire the button into the document detail page**

In the document detail RSC, pass `disabled = doc.attorneyReviewRequired && !approvalExists` and a matching `disabledReason="Attorney review required before this document can be sent."`. The server still rejects un-approved sends via the gate in `sendEnvelope`; the UI disable is informational.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck
pnpm --filter web test
git add apps/web/components/envelope-status-card.tsx apps/web/components/send-for-signature-button.tsx "apps/web/app/(app)/deals/"
git commit -m "feat(ui): EnvelopeStatusCard + Send-for-Signature button (M4 task 22)"
```

---

### Subsystem 4 — Contact Entity Resolution (Tasks 23–28)

---

### Task 23: DB — `contacts` + `contact_identities` tables (migration 0023)

**Files:**

- Create: `packages/db/src/schema/contacts.ts`
- Create: `packages/db/migrations/0023_contacts.sql`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// packages/db/src/schema/contacts.ts
import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { organizations } from './tenants';

// Canonical Contact entity. One row per distinct real person inside
// an organization (Bob Smith at Wells Fargo). Many identity rows
// (email, phone, slack_user) can point to one contact.
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    primaryName: text('primary_name'),
    primaryEmail: varchar('primary_email', { length: 256 }),
    primaryPhone: varchar('primary_phone', { length: 20 }),
    employer: varchar('employer', { length: 256 }),
    role: varchar('role', { length: 64 }),
    // Metadata e.g. notes, source-of-truth markers. Mem0 confidences
    // for ambiguous merges land here in Phase 1.
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    index('contacts_organization_id_idx').on(t.organizationId),
    index('contacts_primary_email_idx').on(t.organizationId, t.primaryEmail),
    index('contacts_primary_phone_idx').on(t.organizationId, t.primaryPhone),
  ],
);

// One row per source identifier (email, phone, slack_user, crm_id).
// The (organization_id, kind, normalized_value) tuple is UNIQUE — that
// is the deterministic-match index the dedup engine uses.
export const contactIdentities = pgTable(
  'contact_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // 'email' | 'phone' | 'slack_user' | 'crm_id'
    kind: varchar('kind', { length: 32 }).notNull(),
    // Lower-cased / E.164-normalized / team-prefixed. The exact rules
    // live in @cema/contacts/normalize.ts so the UNIQUE index hits.
    normalizedValue: varchar('normalized_value', { length: 256 }).notNull(),
    rawValue: varchar('raw_value', { length: 256 }),
    // Where this identity was discovered.
    // 'party' | 'comm_from' | 'comm_to' | 'slack_message' | 'manual'
    source: varchar('source', { length: 32 }).notNull(),
    // UUID of the row that produced this identity (parties.id,
    // communications.id, slack_messages.id, etc.). Nullable for
    // 'manual' source.
    sourceId: uuid('source_id'),
    // Match confidence. 1.0 for deterministic; lower for ML matches
    // in Phase 1. Stored as double precision.
    confidence: doublePrecision('confidence').notNull().default(1.0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    // The dedup-engine lookup index.
    uniqueIndex('contact_identities_org_kind_value_uidx').on(
      t.organizationId,
      t.kind,
      t.normalizedValue,
    ),
    index('contact_identities_contact_id_idx').on(t.contactId),
    index('contact_identities_organization_id_idx').on(t.organizationId),
    check(
      'contact_identities_kind_valid',
      sql`${t.kind} IN ('email', 'phone', 'slack_user', 'crm_id')`,
    ),
    check(
      'contact_identities_source_valid',
      sql`${t.source} IN ('party', 'comm_from', 'comm_to', 'slack_message', 'manual')`,
    ),
    check(
      'contact_identities_confidence_range',
      sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`,
    ),
  ],
);
```

- [ ] **Step 2: Export, generate, rename to `0023_contacts.sql`, apply**

```bash
# Append `export * from './contacts';` to schema index.
pnpm --filter @cema/db db:generate
# Rename produced file + update journal tag.
pnpm --filter @cema/db db:migrate
pnpm typecheck
git add packages/db/src/schema/contacts.ts packages/db/src/schema/index.ts packages/db/migrations/0023_contacts.sql packages/db/migrations/meta/
git commit -m "feat(db): add contacts + contact_identities tables (M4 task 23)"
```

---

### Task 24: `@cema/contacts` — normalize + dedup engine

**Files:**

- Create: `packages/contacts/package.json`
- Create: `packages/contacts/tsconfig.json`
- Create: `packages/contacts/src/index.ts`
- Create: `packages/contacts/src/normalize.ts` + `normalize.test.ts`
- Create: `packages/contacts/src/dedup.ts` + `dedup.test.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@cema/contacts",
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
    "libphonenumber-js": "^1.11.0"
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

- [ ] **Step 3: Write `normalize.ts` tests**

```typescript
// packages/contacts/src/normalize.test.ts
import { describe, expect, it } from 'vitest';

import { normalizeEmail, normalizePhone, normalizeSlackUser } from './normalize';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  BOB@Example.COM  ')).toBe('bob@example.com');
  });

  it('strips +suffix aliases', () => {
    expect(normalizeEmail('bob+notes@example.com')).toBe('bob@example.com');
  });

  it('returns null for malformed input', () => {
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('')).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('parses a US 10-digit number to E.164', () => {
    expect(normalizePhone('212-555-1234')).toBe('+12125551234');
  });

  it('preserves valid +country E.164 input', () => {
    expect(normalizePhone('+447911123456')).toBe('+447911123456');
  });

  it('handles parentheses and spaces', () => {
    expect(normalizePhone('(212) 555-1234')).toBe('+12125551234');
  });

  it('returns null for invalid input', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('normalizeSlackUser', () => {
  it('lowercases the user id with team prefix', () => {
    expect(normalizeSlackUser('T0123', 'U01ABC')).toBe('t0123:u01abc');
  });
});
```

- [ ] **Step 4: Implement `normalize.ts`**

```typescript
// packages/contacts/src/normalize.ts
import { parsePhoneNumberFromString } from 'libphonenumber-js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(lower)) return null;
  // Strip +suffix alias.
  const [local, domain] = lower.split('@');
  if (!local || !domain) return null;
  const baseLocal = local.split('+')[0] ?? local;
  return `${baseLocal}@${domain}`;
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Try with US default first; libphonenumber rejects garbage cleanly.
  const parsed = parsePhoneNumberFromString(trimmed, 'US');
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // E.164
}

export function normalizeSlackUser(teamId: string, userId: string): string {
  return `${teamId.toLowerCase()}:${userId.toLowerCase()}`;
}
```

- [ ] **Step 5: Write `dedup.ts` tests**

```typescript
// packages/contacts/src/dedup.test.ts
import { describe, expect, it, vi } from 'vitest';

import { ensureContact } from './dedup';

describe('ensureContact', () => {
  it('returns the existing contact_id when an identity already exists', async () => {
    const mockTx = makeTxWithExistingIdentity('contact-existing-1');
    const result = await ensureContact(mockTx as never, {
      orgId: 'org-1',
      kind: 'email',
      value: 'bob@example.com',
      source: 'party',
      sourceId: 'party-1',
    });
    expect(result.contactId).toBe('contact-existing-1');
    expect(result.created).toBe(false);
  });

  it('creates a new contact + identity when no existing identity', async () => {
    const mockTx = makeTxWithoutExistingIdentity('contact-new-1');
    const result = await ensureContact(mockTx as never, {
      orgId: 'org-1',
      kind: 'email',
      value: 'newperson@example.com',
      source: 'party',
      sourceId: 'party-2',
    });
    expect(result.contactId).toBe('contact-new-1');
    expect(result.created).toBe(true);
  });

  it('returns null when normalization rejects the input', async () => {
    const mockTx = makeTxWithoutExistingIdentity('unused');
    const result = await ensureContact(mockTx as never, {
      orgId: 'org-1',
      kind: 'email',
      value: 'not-an-email',
      source: 'party',
      sourceId: 'party-3',
    });
    expect(result).toBeNull();
  });
});

function makeTxWithExistingIdentity(contactId: string) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ contactId }]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };
}

function makeTxWithoutExistingIdentity(newContactId: string) {
  const insertContact = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: newContactId }]),
    }),
  });
  const insertIdentity = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    }),
  });
  let insertCalls = 0;
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockImplementation(() => {
      insertCalls += 1;
      return insertCalls === 1 ? insertContact() : insertIdentity();
    }),
  };
}
```

- [ ] **Step 6: Implement `dedup.ts`**

```typescript
// packages/contacts/src/dedup.ts
import { contactIdentities, contacts } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { normalizeEmail, normalizePhone } from './normalize';

export type DedupKind = 'email' | 'phone' | 'slack_user' | 'crm_id';
export type DedupSource = 'party' | 'comm_from' | 'comm_to' | 'slack_message' | 'manual';

export interface EnsureContactInput {
  orgId: string;
  kind: DedupKind;
  value: string;
  source: DedupSource;
  sourceId: string | null;
  // Optional metadata to apply on contact creation (name, employer).
  name?: string | null;
  employer?: string | null;
  // For slack_user kind: required team id prefix.
  slackTeamId?: string;
  // Confidence override; defaults 1.0 for deterministic matches.
  confidence?: number;
}

export interface EnsureContactResult {
  contactId: string;
  identityId?: string;
  created: boolean;
}

/**
 * Idempotent contact-identity ensurer.
 *
 * Steps:
 *   1. Normalize the input value per kind. If normalization fails,
 *      return null (input rejected).
 *   2. Look up an existing identity matching (orgId, kind, normalizedValue).
 *   3. If found: insert this (source, sourceId) row idempotently and
 *      return the existing contactId.
 *   4. If not found: INSERT a new contacts row, then INSERT the identity
 *      pointing to it. Return the new contactId.
 *
 * The caller is responsible for wrapping in withRls(orgId, ...) — this
 * function operates on whatever tx it is given.
 */
export async function ensureContact(
  tx: import('drizzle-orm/pg-core').AnyPgTable extends never
    ? never
    : Parameters<typeof tx_marker>[0],
  input: EnsureContactInput,
): Promise<EnsureContactResult | null> {
  const normalized = normalizeForKind(input.kind, input.value, input.slackTeamId);
  if (!normalized) return null;

  const txAny = tx as unknown as {
    select: (...args: unknown[]) => {
      from: (...args: unknown[]) => {
        where: (...args: unknown[]) => { limit: (n: number) => Promise<{ contactId: string }[]> };
      };
    };
    insert: (table: unknown) => {
      values: (data: unknown) => {
        returning?: () => Promise<{ id: string }[]>;
        onConflictDoNothing?: () => Promise<void>;
      };
    };
  };

  const existing = await txAny
    .select({ contactId: contactIdentities.contactId } as never)
    .from(contactIdentities as never)
    .where(
      and(
        eq(contactIdentities.organizationId, input.orgId),
        eq(contactIdentities.kind, input.kind),
        eq(contactIdentities.normalizedValue, normalized),
      ) as never,
    )
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    await txAny.insert(contactIdentities as never).values({
      contactId: existing[0].contactId,
      organizationId: input.orgId,
      kind: input.kind,
      normalizedValue: normalized,
      rawValue: input.value,
      source: input.source,
      sourceId: input.sourceId,
      confidence: input.confidence ?? 1.0,
    } as never).onConflictDoNothing!();
    return { contactId: existing[0].contactId, created: false };
  }

  const inserted = await txAny.insert(contacts as never).values({
    organizationId: input.orgId,
    primaryName: input.name ?? null,
    primaryEmail: input.kind === 'email' ? normalized : null,
    primaryPhone: input.kind === 'phone' ? normalized : null,
    employer: input.employer ?? null,
  } as never).returning!();

  const newContact = inserted[0];
  if (!newContact) throw new Error('Failed to insert contacts row');

  await txAny.insert(contactIdentities as never).values({
    contactId: newContact.id,
    organizationId: input.orgId,
    kind: input.kind,
    normalizedValue: normalized,
    rawValue: input.value,
    source: input.source,
    sourceId: input.sourceId,
    confidence: input.confidence ?? 1.0,
  } as never).onConflictDoNothing!();

  return { contactId: newContact.id, created: true };
}

function normalizeForKind(kind: DedupKind, value: string, slackTeamId?: string): string | null {
  switch (kind) {
    case 'email':
      return normalizeEmail(value);
    case 'phone':
      return normalizePhone(value);
    case 'slack_user':
      return slackTeamId ? `${slackTeamId.toLowerCase()}:${value.toLowerCase()}` : null;
    case 'crm_id':
      return value.trim();
  }
}

// Helper type — drizzle-orm transaction type signature is intricate; we
// type the tx loosely here to keep the dedup engine package self-contained.
function tx_marker(_: unknown) {
  return _;
}
```

- [ ] **Step 7: `index.ts`**

```typescript
// packages/contacts/src/index.ts
export * from './normalize';
export * from './dedup';
```

- [ ] **Step 8: Install + test + commit**

```bash
pnpm install
pnpm --filter @cema/contacts test
pnpm --filter @cema/contacts typecheck
git add packages/contacts/ pnpm-lock.yaml
git commit -m "feat(contacts): @cema/contacts — normalize + dedup engine (M4 task 24)"
```

---

### Task 25: Backfill — populate `contacts` from existing parties + communications

**Files:**

- Create: `apps/web/lib/contacts/backfill.ts` + `backfill.test.ts`

- [ ] **Step 1: Implement `backfill.ts`**

```typescript
// apps/web/lib/contacts/backfill.ts
import { communications, emailThreads, getDb, parties } from '@cema/db';
import { ensureContact } from '@cema/contacts';
import { eq, isNotNull } from 'drizzle-orm';

import { withRls } from '../with-rls';

export interface BackfillResult {
  partiesProcessed: number;
  commsProcessed: number;
  emailThreadsProcessed: number;
  contactsCreated: number;
  identitiesLinked: number;
}

/**
 * One-shot backfill — call this manually (or via a cron in Phase 1)
 * after the contacts tables migrate. Walks parties + communications +
 * email_threads and ensures a contact identity for every email + phone
 * + email participant we have on file.
 *
 * Safe to re-run: every ensureContact is idempotent.
 */
export async function backfillContacts(orgId: string): Promise<BackfillResult> {
  const db = getDb();
  const stats: BackfillResult = {
    partiesProcessed: 0,
    commsProcessed: 0,
    emailThreadsProcessed: 0,
    contactsCreated: 0,
    identitiesLinked: 0,
  };

  await withRls(orgId, async (tx) => {
    // 1. Parties — emails + phones.
    const partyRows = await tx
      .select({
        id: parties.id,
        email: parties.email,
        phone: parties.phone,
        fullName: parties.fullName,
      })
      .from(parties);

    for (const p of partyRows) {
      stats.partiesProcessed += 1;
      if (p.email) {
        const res = await ensureContact(tx, {
          orgId,
          kind: 'email',
          value: p.email,
          source: 'party',
          sourceId: p.id,
          name: p.fullName,
        });
        if (res) {
          stats.identitiesLinked += 1;
          if (res.created) stats.contactsCreated += 1;
        }
      }
      if (p.phone) {
        const res = await ensureContact(tx, {
          orgId,
          kind: 'phone',
          value: p.phone,
          source: 'party',
          sourceId: p.id,
          name: p.fullName,
        });
        if (res) {
          stats.identitiesLinked += 1;
          if (res.created) stats.contactsCreated += 1;
        }
      }
    }

    // 2. Communications — from_e164 + to_e164.
    const commRows = await tx
      .select({
        id: communications.id,
        fromE164: communications.fromE164,
        toE164: communications.toE164,
      })
      .from(communications)
      .where(isNotNull(communications.fromE164));

    for (const c of commRows) {
      stats.commsProcessed += 1;
      if (c.fromE164) {
        const res = await ensureContact(tx, {
          orgId,
          kind: 'phone',
          value: c.fromE164,
          source: 'comm_from',
          sourceId: c.id,
        });
        if (res) {
          stats.identitiesLinked += 1;
          if (res.created) stats.contactsCreated += 1;
        }
      }
      if (c.toE164) {
        const res = await ensureContact(tx, {
          orgId,
          kind: 'phone',
          value: c.toE164,
          source: 'comm_to',
          sourceId: c.id,
        });
        if (res) {
          stats.identitiesLinked += 1;
          if (res.created) stats.contactsCreated += 1;
        }
      }
    }

    // 3. Email threads — from_email + every entry in to_participants.
    const threadRows = await tx
      .select({
        id: emailThreads.id,
        communicationId: emailThreads.communicationId,
        fromEmail: emailThreads.fromEmail,
        toParticipants: emailThreads.toParticipants,
      })
      .from(emailThreads);

    for (const t of threadRows) {
      stats.emailThreadsProcessed += 1;
      if (t.fromEmail) {
        const res = await ensureContact(tx, {
          orgId,
          kind: 'email',
          value: t.fromEmail,
          source: 'comm_from',
          sourceId: t.communicationId,
        });
        if (res) {
          stats.identitiesLinked += 1;
          if (res.created) stats.contactsCreated += 1;
        }
      }
      for (const recipient of t.toParticipants ?? []) {
        const res = await ensureContact(tx, {
          orgId,
          kind: 'email',
          value: recipient.email,
          source: 'comm_to',
          sourceId: t.communicationId,
          name: recipient.name,
        });
        if (res) {
          stats.identitiesLinked += 1;
          if (res.created) stats.contactsCreated += 1;
        }
      }
    }
  });

  return stats;
}
```

- [ ] **Step 2: Write tests** — 3 tests: (1) empty org → all zeros, (2) one party → 1 contact + 1 identity, (3) duplicate party emails → 1 contact + 1 identity (proves idempotency).

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter web test lib/contacts/backfill
pnpm typecheck
git add apps/web/lib/contacts/
git commit -m "feat(contacts): backfill engine for parties + comms + threads (M4 task 25)"
```

---

### Task 26: Server actions — `listContacts`, `getContact`, `mergeContacts`

**Files:**

- Create: `apps/web/lib/actions/list-contacts.ts` + `list-contacts.test.ts`
- Create: `apps/web/lib/actions/get-contact.ts` + `get-contact.test.ts`
- Create: `apps/web/lib/actions/merge-contacts.ts` + `merge-contacts.test.ts`

- [ ] **Step 1: `list-contacts.ts`**

```typescript
// apps/web/lib/actions/list-contacts.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { contactIdentities, contacts, getDb, organizations } from '@cema/db';
import { desc, eq, sql } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Contact = typeof contacts.$inferSelect;

export interface ContactListRow {
  contact: Contact;
  identityCount: number;
}

export async function listContacts(): Promise<ContactListRow[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({
        contact: contacts,
        identityCount: sql<number>`count(${contactIdentities.id})::int`,
      })
      .from(contacts)
      .leftJoin(contactIdentities, eq(contactIdentities.contactId, contacts.id))
      .groupBy(contacts.id)
      .orderBy(desc(contacts.createdAt));
    return rows;
  });
}
```

- [ ] **Step 2: `get-contact.ts`**

```typescript
// apps/web/lib/actions/get-contact.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { contactIdentities, contacts, getDb, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Contact = typeof contacts.$inferSelect;
type ContactIdentity = typeof contactIdentities.$inferSelect;

export interface ContactDetailResult {
  contact: Contact;
  identities: ContactIdentity[];
}

export async function getContact(contactId: string): Promise<ContactDetailResult | null> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return null;

  return withRls(org.id, async (tx) => {
    const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!c) return null;
    const idents = await tx
      .select()
      .from(contactIdentities)
      .where(eq(contactIdentities.contactId, c.id));
    return { contact: c, identities: idents };
  });
}
```

- [ ] **Step 3: `merge-contacts.ts`**

```typescript
// apps/web/lib/actions/merge-contacts.ts
'use server';

import { getCurrentOrganizationId } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { contactIdentities, contacts, getDb, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export interface MergeContactsResult {
  movedIdentities: number;
  loserContactId: string;
  winnerContactId: string;
}

/**
 * Move all identities from `loserContactId` to `winnerContactId`, then
 * delete the loser row. Both contacts must belong to the caller's org
 * (enforced by withRls).
 *
 * Audit event written so attorney compliance review can reconstruct.
 */
export async function mergeContacts(
  winnerContactId: string,
  loserContactId: string,
): Promise<MergeContactsResult> {
  if (winnerContactId === loserContactId) {
    throw new Error('Cannot merge a contact into itself');
  }

  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not found');

  let movedIdentities = 0;

  await withRls(org.id, async (tx) => {
    const [winner] = await tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, winnerContactId))
      .limit(1);
    const [loser] = await tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, loserContactId))
      .limit(1);
    if (!winner || !loser) throw new Error('Contact not found');

    const result = await tx
      .update(contactIdentities)
      .set({ contactId: winnerContactId, updatedAt: new Date() })
      .where(eq(contactIdentities.contactId, loserContactId));
    movedIdentities = (result as unknown as { rowCount?: number }).rowCount ?? 0;

    await tx.delete(contacts).where(eq(contacts.id, loserContactId));
  });

  await emitAuditEvent(db, {
    organizationId: org.id,
    action: 'contact.merged',
    entityType: 'contact',
    entityId: winnerContactId,
    metadata: { loserContactId, movedIdentities },
  });

  return { movedIdentities, loserContactId, winnerContactId };
}
```

- [ ] **Step 4: Write tests for all three actions**

Standard pattern: missing-org returns null/[], happy path returns expected shape, merge-into-self throws. 4 tests per action.

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter web test lib/actions/list-contacts lib/actions/get-contact lib/actions/merge-contacts
pnpm typecheck
git add apps/web/lib/actions/list-contacts.ts apps/web/lib/actions/list-contacts.test.ts apps/web/lib/actions/get-contact.ts apps/web/lib/actions/get-contact.test.ts apps/web/lib/actions/merge-contacts.ts apps/web/lib/actions/merge-contacts.test.ts
git commit -m "feat(actions): listContacts + getContact + mergeContacts (M4 task 26)"
```

---

### Task 27: UI — `/contacts` index + `/contacts/[id]` detail

**Files:**

- Create: `apps/web/components/contact-card.tsx`
- Create: `apps/web/components/contact-detail.tsx`
- Create: `apps/web/app/(app)/contacts/page.tsx`
- Create: `apps/web/app/(app)/contacts/[id]/page.tsx`
- Modify: `apps/web/components/sidebar.tsx` (add Contacts nav)

- [ ] **Step 1: `ContactCard`**

```tsx
// apps/web/components/contact-card.tsx
import type { contacts } from '@cema/db';
import type { Route } from 'next';
import Link from 'next/link';

type Contact = typeof contacts.$inferSelect;

interface ContactCardProps {
  contact: Contact;
  identityCount: number;
}

export function ContactCard({ contact, identityCount }: ContactCardProps) {
  return (
    <Link
      href={`/contacts/${contact.id}` as Route}
      className="hover:bg-muted/50 block rounded-lg border bg-white p-4 shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{contact.primaryName ?? '(unnamed)'}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {[contact.primaryEmail, contact.primaryPhone].filter(Boolean).join(' · ') || '—'}
          </p>
          {contact.employer ? (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">{contact.employer}</p>
          ) : null}
        </div>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          {identityCount} {identityCount === 1 ? 'identity' : 'identities'}
        </span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: `ContactDetail`**

```tsx
// apps/web/components/contact-detail.tsx
import type { contactIdentities, contacts } from '@cema/db';

type Contact = typeof contacts.$inferSelect;
type ContactIdentity = typeof contactIdentities.$inferSelect;

interface ContactDetailProps {
  contact: Contact;
  identities: ContactIdentity[];
}

const KIND_LABEL: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  slack_user: 'Slack user',
  crm_id: 'CRM ID',
};

const SOURCE_LABEL: Record<string, string> = {
  party: 'Party record',
  comm_from: 'Inbound communication',
  comm_to: 'Outbound communication',
  slack_message: 'Slack message',
  manual: 'Manual entry',
};

export function ContactDetail({ contact, identities }: ContactDetailProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{contact.primaryName ?? '(unnamed)'}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {[contact.primaryEmail, contact.primaryPhone].filter(Boolean).join(' · ')}
        </p>
        {contact.employer ? (
          <p className="text-muted-foreground mt-1 text-sm">{contact.employer}</p>
        ) : null}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium">Identities ({identities.length})</h2>
        <ul className="space-y-2" role="list">
          {identities.map((ident) => (
            <li
              key={ident.id}
              className="flex items-center justify-between rounded-lg border bg-white p-3 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {KIND_LABEL[ident.kind] ?? ident.kind}: {ident.rawValue ?? ident.normalizedValue}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  From {SOURCE_LABEL[ident.source] ?? ident.source}
                  {ident.confidence < 1 ? ` · confidence ${ident.confidence.toFixed(2)}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: `/contacts/page.tsx`**

```tsx
// apps/web/app/(app)/contacts/page.tsx
import { ContactCard } from '@/components/contact-card';
import { listContacts } from '@/lib/actions/list-contacts';

export default async function Page() {
  const rows = await listContacts();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Contacts</h1>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm font-medium">No contacts yet</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Contacts are extracted from parties, calls, emails, and Slack messages.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" role="list" aria-label="Contacts list">
          {rows.map(({ contact, identityCount }) => (
            <li key={contact.id}>
              <ContactCard contact={contact} identityCount={identityCount} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `/contacts/[id]/page.tsx`**

```tsx
// apps/web/app/(app)/contacts/[id]/page.tsx
import { notFound } from 'next/navigation';

import { ContactDetail } from '@/components/contact-detail';
import { getContact } from '@/lib/actions/get-contact';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getContact(id);
  if (!data) notFound();
  return <ContactDetail contact={data.contact} identities={data.identities} />;
}
```

- [ ] **Step 5: Add Contacts nav link in `apps/web/components/sidebar.tsx`**

Add a `<NavItem href="/contacts" label="Contacts" />` (or matching pattern in the existing sidebar). If sidebar.tsx uses Clerk's `<OrganizationSwitcher>`, place the Contacts link near the other top-level entries (Deals, Communications).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add apps/web/components/contact-card.tsx apps/web/components/contact-detail.tsx "apps/web/app/(app)/contacts/" apps/web/components/sidebar.tsx
git commit -m "feat(ui): /contacts index + ContactDetail + sidebar link (M4 task 27)"
```

---

### Task 28: UI — Party-resolution sidebar on Communications detail

**Files:**

- Create: `apps/web/components/party-resolution-sidebar.tsx`
- Modify: `apps/web/app/(app)/deals/[id]/communications/[c]/page.tsx`
- Create: `apps/web/lib/actions/list-contact-suggestions.ts` + tests

- [ ] **Step 1: Implement the suggestion action**

```typescript
// apps/web/lib/actions/list-contact-suggestions.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { normalizeEmail, normalizePhone } from '@cema/contacts';
import { contactIdentities, contacts, getDb, organizations } from '@cema/db';
import { and, eq, inArray } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Contact = typeof contacts.$inferSelect;

export interface SuggestionInput {
  emails?: (string | null | undefined)[];
  phones?: (string | null | undefined)[];
}

/**
 * Given a set of raw email/phone values pulled from a communication,
 * return the existing contacts that match deterministically.
 *
 * Used by the party-resolution sidebar to show "this communication is
 * already linked to: Bob Smith, Jane Doe" and to offer a one-click
 * link if no match is found.
 */
export async function listContactSuggestions(input: SuggestionInput): Promise<Contact[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const normalizedEmails = (input.emails ?? [])
    .map((v) => normalizeEmail(v))
    .filter((v): v is string => v !== null);
  const normalizedPhones = (input.phones ?? [])
    .map((v) => normalizePhone(v))
    .filter((v): v is string => v !== null);

  if (normalizedEmails.length === 0 && normalizedPhones.length === 0) return [];

  return withRls(org.id, async (tx) => {
    const matches = await tx
      .select({
        contactId: contactIdentities.contactId,
        kind: contactIdentities.kind,
        value: contactIdentities.normalizedValue,
      })
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.organizationId, org.id),
          inArray(contactIdentities.normalizedValue, [...normalizedEmails, ...normalizedPhones]),
        ),
      );

    const ids = Array.from(new Set(matches.map((m) => m.contactId)));
    if (ids.length === 0) return [];

    return tx.select().from(contacts).where(inArray(contacts.id, ids));
  });
}
```

- [ ] **Step 2: `PartyResolutionSidebar`**

```tsx
// apps/web/components/party-resolution-sidebar.tsx
import type { contacts } from '@cema/db';
import type { Route } from 'next';
import Link from 'next/link';

type Contact = typeof contacts.$inferSelect;

interface PartyResolutionSidebarProps {
  matches: Contact[];
  // Raw values from the communication that we ran lookups for — shown
  // to the processor so they know what was matched.
  rawEmails: string[];
  rawPhones: string[];
}

export function PartyResolutionSidebar({
  matches,
  rawEmails,
  rawPhones,
}: PartyResolutionSidebarProps) {
  return (
    <aside className="rounded-lg border bg-white p-4 shadow-sm">
      <h3 className="text-sm font-medium">Linked contacts</h3>

      {matches.length > 0 ? (
        <ul className="mt-3 space-y-2" role="list">
          {matches.map((c) => (
            <li key={c.id}>
              <Link
                href={`/contacts/${c.id}` as Route}
                className="hover:bg-muted/50 block rounded-md border p-2 text-sm"
              >
                <p className="font-medium">{c.primaryName ?? '(unnamed)'}</p>
                <p className="text-muted-foreground text-xs">
                  {c.primaryEmail ?? c.primaryPhone ?? '—'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-2 text-xs">
          No matching contacts. Run the backfill (Task 25) to populate from parties.
        </p>
      )}

      <details className="mt-3">
        <summary className="text-muted-foreground cursor-pointer text-xs">Matched on…</summary>
        <ul className="mt-1 space-y-0.5 text-xs">
          {rawEmails.map((e) => (
            <li key={e} className="text-muted-foreground">
              ✉ {e}
            </li>
          ))}
          {rawPhones.map((p) => (
            <li key={p} className="text-muted-foreground">
              ☎ {p}
            </li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
```

- [ ] **Step 3: Wire into the comm detail page**

At the top of `apps/web/app/(app)/deals/[id]/communications/[c]/page.tsx`, after fetching `data` and BEFORE the kind-branching, pull suggestions:

```tsx
const suggestionInputs: { emails: string[]; phones: string[] } = { emails: [], phones: [] };
if (comm.fromE164) suggestionInputs.phones.push(comm.fromE164);
if (comm.toE164) suggestionInputs.phones.push(comm.toE164);
// Email-kind comms include the thread participants:
if (comm.kind === 'email') {
  const emailData = await getEmail(dealId, communicationId);
  if (emailData?.emailThread?.fromEmail)
    suggestionInputs.emails.push(emailData.emailThread.fromEmail);
  for (const p of emailData?.emailThread?.toParticipants ?? []) {
    suggestionInputs.emails.push(p.email);
  }
}
const matches = await listContactSuggestions(suggestionInputs);
```

Render `<PartyResolutionSidebar … />` in a right column on the detail page (grid `md:grid-cols-3` with the main content spanning 2 columns and the sidebar in the third).

- [ ] **Step 4: Tests** — 3 tests for `listContactSuggestions`: empty inputs → [], normalized inputs match identities, normalized inputs that don't match → [].

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter web test lib/actions/list-contact-suggestions
pnpm typecheck
git add apps/web/components/party-resolution-sidebar.tsx apps/web/lib/actions/list-contact-suggestions.ts apps/web/lib/actions/list-contact-suggestions.test.ts "apps/web/app/(app)/deals/"
git commit -m "feat(ui): party-resolution sidebar on communication detail (M4 task 28)"
```

---

### Cross-cutting (Tasks 29–33)

---

### Task 29: DB — RLS policies on all 8 new M4 tables (migration 0024)

**Files:**

- Create: `packages/db/migrations/0024_rls_m4.sql`
- Modify: `packages/db/migrations/meta/_journal.json` (manual entry)

- [ ] **Step 1: Write the migration**

Hand-written for the same reason `0011_rls_telephony.sql` and `0016_rls_email_calendar.sql` were — `drizzle-kit generate` cannot emit RLS DDL.

```sql
-- packages/db/migrations/0024_rls_m4.sql
--
-- M4 Task 29: Row-Level Security policies for the eight new tables.
-- Two policy shapes:
--   - Direct organization_id equality   → tables that carry the column
--   - EXISTS via a parent row           → tables that don't
--
-- Default privileges from 0002_app_role.sql already grant cema_app_user
-- SELECT/INSERT/UPDATE/DELETE on every public.* table created by
-- neondb_owner, so no explicit GRANTs are needed here.

-- Direct org-scoped tables --------------------------------------------

ALTER TABLE org_slack_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_slack_connections_org_isolation ON org_slack_connections
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE org_drive_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_drive_connections_org_isolation ON org_drive_connections
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE drive_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY drive_files_org_isolation ON drive_files
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE org_docusign_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_docusign_connections_org_isolation ON org_docusign_connections
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE docusign_envelopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY docusign_envelopes_org_isolation ON docusign_envelopes
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_org_isolation ON contacts
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE contact_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_identities_org_isolation ON contact_identities
  USING (organization_id::text = current_setting('app.current_organization_id', true));

-- Indirectly scoped via communications --------------------------------

ALTER TABLE slack_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY slack_messages_org_isolation ON slack_messages
  USING (
    EXISTS (
      SELECT 1 FROM communications c
      WHERE c.id = slack_messages.communication_id
        AND c.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );
```

- [ ] **Step 2: Manually append the journal entry**

In `packages/db/migrations/meta/_journal.json`, after the last entry add:

```json
{
  "idx": 24,
  "version": "7",
  "when": <current-unix-ms>,
  "tag": "0024_rls_m4",
  "breakpoints": false
}
```

Use the existing index (likely 24 — verify after Tasks 17–23 lands; renumber if needed).

- [ ] **Step 3: Apply + commit**

```bash
pnpm --filter @cema/db db:migrate
git add packages/db/migrations/0024_rls_m4.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): RLS policies on all M4 tables (M4 task 29)"
```

---

### Task 30: Integration test — cross-org RLS isolation for M4 tables

**Files:**

- Create: `apps/web/tests/integration/m4-rls-isolation.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/web/tests/integration/m4-rls-isolation.test.ts
/**
 * RLS multi-tenant isolation for M4 tables.
 *
 * Eight tables × {Org A sees own, Org B does not see Org A} pairs;
 * we condense to 8 assertions, one per table, asserting the negative
 * (Org B cannot see Org A's row).
 *
 * Two policy shapes are exercised:
 *   - Direct organization_id equality (7 tables)
 *   - EXISTS via communications (slack_messages)
 */

import {
  calendarEvents,
  communications,
  contactIdentities,
  contacts,
  documents,
  driveFiles,
  docusignConnections,
  docusignEnvelopes,
  emailThreads,
  getDb,
  orgDocusignConnections,
  orgDriveConnections,
  orgSlackConnections,
  organizations,
  slackMessages,
  users,
} from '@cema/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

const ORG_A_ID = '00000000-0000-0000-0000-0000000000a4';
const ORG_B_ID = '00000000-0000-0000-0000-0000000000b4';
const USER_ID = '00000000-0000-0000-0000-000000000094';
const DOC_ID = '00000000-0000-0000-0000-0000000000d4';

const skip = !process.env.DATABASE_URL;

let slackConnId: string;
let driveConnId: string;
let driveFileId: string;
let docusignConnId: string;
let envelopeRowId: string;
let contactRowId: string;
let identityRowId: string;
let slackCommId: string;
let slackMsgId: string;

describe.skipIf(skip)('RLS — M4 tables cross-org isolation', () => {
  beforeAll(async () => {
    const db = getDb();

    await db
      .insert(organizations)
      .values([
        { id: ORG_A_ID, clerkOrgId: 'org_m4_rls_a', name: 'Org A (M4)', slug: 'm4-rls-org-a' },
        { id: ORG_B_ID, clerkOrgId: 'org_m4_rls_b', name: 'Org B (M4)', slug: 'm4-rls-org-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_ID, clerkUserId: 'user_m4_rls', email: 'm4-rls@example.invalid' })
      .onConflictDoNothing();

    // Document for the docusign envelope FK.
    await db
      .insert(documents)
      .values({
        id: DOC_ID,
        organizationId: ORG_A_ID,
        kind: 'cema_3172',
        status: 'draft',
        attorneyReviewRequired: true,
        version: 1,
      })
      .onConflictDoNothing();

    const [slackConn] = await db
      .insert(orgSlackConnections)
      .values({
        organizationId: ORG_A_ID,
        slackTeamId: 'T-rls-test',
        slackBotToken: 'xoxb-fake-bot',
        connectionStatus: 'active',
        createdById: USER_ID,
      })
      .returning();
    slackConnId = slackConn!.id;

    const [driveConn] = await db
      .insert(orgDriveConnections)
      .values({
        organizationId: ORG_A_ID,
        googleAccountEmail: 'drive@org-a.example.invalid',
        oauthRefreshToken: 'rt',
        driveChannelId: 'ch-rls',
        driveChannelToken: 'tok-rls',
        createdById: USER_ID,
      })
      .returning();
    driveConnId = driveConn!.id;

    const [driveFile] = await db
      .insert(driveFiles)
      .values({
        organizationId: ORG_A_ID,
        driveConnectionId: driveConnId,
        driveFileId: 'file-rls-001',
        fileName: 'rls.pdf',
        mimeType: 'application/pdf',
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
      })
      .returning();
    driveFileId = driveFile!.id;

    const [docusignConn] = await db
      .insert(orgDocusignConnections)
      .values({
        organizationId: ORG_A_ID,
        docusignAccountId: 'ACCT-RLS',
        docusignBaseUrl: 'https://demo.docusign.net/restapi',
        docusignUserId: 'U-RLS',
        integrationKey: 'IK',
        rsaPrivateKey: 'KEY',
        connectSecret: 'SECRET',
        createdById: USER_ID,
      })
      .returning();
    docusignConnId = docusignConn!.id;

    const [env] = await db
      .insert(docusignEnvelopes)
      .values({
        organizationId: ORG_A_ID,
        docusignConnectionId: docusignConnId,
        documentId: DOC_ID,
        docusignEnvelopeId: 'env-rls-001',
        status: 'sent',
        sentAt: new Date(),
        createdById: USER_ID,
      })
      .returning();
    envelopeRowId = env!.id;

    const [contact] = await db
      .insert(contacts)
      .values({
        organizationId: ORG_A_ID,
        primaryName: 'RLS Test Person',
        primaryEmail: 'rls@example.invalid',
      })
      .returning();
    contactRowId = contact!.id;

    const [identity] = await db
      .insert(contactIdentities)
      .values({
        contactId: contactRowId,
        organizationId: ORG_A_ID,
        kind: 'email',
        normalizedValue: 'rls@example.invalid',
        rawValue: 'rls@example.invalid',
        source: 'manual',
        confidence: 1.0,
      })
      .returning();
    identityRowId = identity!.id;

    const [comm] = await db
      .insert(communications)
      .values({
        organizationId: ORG_A_ID,
        kind: 'slack',
        direction: 'inbound',
        medium: 'slack',
        status: 'ready',
        vendorEventId: 'T-rls-test:C-rls:1.0',
      })
      .returning();
    slackCommId = comm!.id;

    const [msg] = await db
      .insert(slackMessages)
      .values({
        communicationId: slackCommId,
        slackTeamId: 'T-rls-test',
        slackChannelId: 'C-rls',
        slackMessageTs: '1.0',
        text: 'rls test',
      })
      .returning();
    slackMsgId = msg!.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(slackMessages).where(eq(slackMessages.id, slackMsgId));
    await db.delete(communications).where(eq(communications.id, slackCommId));
    await db.delete(contactIdentities).where(eq(contactIdentities.id, identityRowId));
    await db.delete(contacts).where(eq(contacts.id, contactRowId));
    await db.delete(docusignEnvelopes).where(eq(docusignEnvelopes.id, envelopeRowId));
    await db.delete(orgDocusignConnections).where(eq(orgDocusignConnections.id, docusignConnId));
    await db.delete(driveFiles).where(eq(driveFiles.id, driveFileId));
    await db.delete(orgDriveConnections).where(eq(orgDriveConnections.id, driveConnId));
    await db.delete(orgSlackConnections).where(eq(orgSlackConnections.id, slackConnId));
    await db.delete(documents).where(eq(documents.id, DOC_ID));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_A_ID, ORG_B_ID]));
    await db.delete(users).where(eq(users.id, USER_ID));
  });

  it('Org B cannot SELECT Org A slack connections', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: orgSlackConnections.id })
        .from(orgSlackConnections)
        .where(eq(orgSlackConnections.id, slackConnId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A slack messages (EXISTS-join policy)', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: slackMessages.id })
        .from(slackMessages)
        .where(eq(slackMessages.id, slackMsgId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A drive connections', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: orgDriveConnections.id })
        .from(orgDriveConnections)
        .where(eq(orgDriveConnections.id, driveConnId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A drive files', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx.select({ id: driveFiles.id }).from(driveFiles).where(eq(driveFiles.id, driveFileId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A docusign connections', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: orgDocusignConnections.id })
        .from(orgDocusignConnections)
        .where(eq(orgDocusignConnections.id, docusignConnId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A docusign envelopes', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: docusignEnvelopes.id })
        .from(docusignEnvelopes)
        .where(eq(docusignEnvelopes.id, envelopeRowId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A contacts', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactRowId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A contact identities', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: contactIdentities.id })
        .from(contactIdentities)
        .where(eq(contactIdentities.id, identityRowId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org A sees its own slack messages via withRls (positive control)', async () => {
    const rows = await withRls(ORG_A_ID, (tx) =>
      tx
        .select({ id: slackMessages.id })
        .from(slackMessages)
        .where(eq(slackMessages.id, slackMsgId)),
    );
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter web test tests/integration/m4-rls-isolation
git add apps/web/tests/integration/m4-rls-isolation.test.ts
git commit -m "test(integration): cross-org RLS isolation for M4 tables (M4 task 30)"
```

---

### Task 31: Integration test — contact dedup end-to-end

**Files:**

- Create: `apps/web/tests/integration/contact-dedup-e2e.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/web/tests/integration/contact-dedup-e2e.test.ts
/**
 * Contact dedup end-to-end (M4 Task 31).
 *
 * Asserts the @cema/contacts ensureContact engine correctly:
 *   1. Creates a new contact + identity for a first-time email.
 *   2. Links a second identity row to the same contact when the same
 *      normalized email arrives from a different source.
 *   3. Treats bob+notes@x and BOB@x as the same identity (alias-strip
 *      + lowercase).
 *   4. Treats (212) 555-1234 and +12125551234 as the same identity.
 *   5. Returns null for an un-normalizable input (junk).
 */

import { ensureContact } from '@cema/contacts';
import { contactIdentities, contacts, getDb, organizations, users } from '@cema/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

const ORG_ID = '00000000-0000-0000-0000-0000000000c4';
const USER_ID = '00000000-0000-0000-0000-0000000000c5';

const skip = !process.env.DATABASE_URL;

describe.skipIf(skip)('Contact dedup E2E', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({ id: ORG_ID, clerkOrgId: 'org_dedup_e2e', name: 'Dedup E2E', slug: 'dedup-e2e' })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_ID, clerkUserId: 'user_dedup_e2e', email: 'dedup@example.invalid' })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(contactIdentities).where(eq(contactIdentities.organizationId, ORG_ID));
    await db.delete(contacts).where(eq(contacts.organizationId, ORG_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_ID]));
  });

  it('creates a new contact + identity for a first-time email', async () => {
    const result = await withRls(ORG_ID, (tx) =>
      ensureContact(tx, {
        orgId: ORG_ID,
        kind: 'email',
        value: 'first@example.com',
        source: 'manual',
        sourceId: null,
      }),
    );
    expect(result?.created).toBe(true);
    expect(result?.contactId).toBeDefined();
  });

  it('links a second source to the same contact for the same normalized email', async () => {
    const a = await withRls(ORG_ID, (tx) =>
      ensureContact(tx, {
        orgId: ORG_ID,
        kind: 'email',
        value: 'second@example.com',
        source: 'manual',
        sourceId: null,
      }),
    );
    const b = await withRls(ORG_ID, (tx) =>
      ensureContact(tx, {
        orgId: ORG_ID,
        kind: 'email',
        value: 'second@example.com',
        source: 'comm_from',
        sourceId: null,
      }),
    );
    expect(a?.contactId).toBe(b?.contactId);
    expect(b?.created).toBe(false);
  });

  it('treats bob+notes@x and BOB@x as the same identity (alias-strip + lowercase)', async () => {
    const a = await withRls(ORG_ID, (tx) =>
      ensureContact(tx, {
        orgId: ORG_ID,
        kind: 'email',
        value: 'bob+notes@example.com',
        source: 'manual',
        sourceId: null,
      }),
    );
    const b = await withRls(ORG_ID, (tx) =>
      ensureContact(tx, {
        orgId: ORG_ID,
        kind: 'email',
        value: 'BOB@Example.COM',
        source: 'manual',
        sourceId: null,
      }),
    );
    expect(a?.contactId).toBe(b?.contactId);
  });

  it('treats (212) 555-1234 and +12125551234 as the same identity', async () => {
    const a = await withRls(ORG_ID, (tx) =>
      ensureContact(tx, {
        orgId: ORG_ID,
        kind: 'phone',
        value: '(212) 555-1234',
        source: 'manual',
        sourceId: null,
      }),
    );
    const b = await withRls(ORG_ID, (tx) =>
      ensureContact(tx, {
        orgId: ORG_ID,
        kind: 'phone',
        value: '+12125551234',
        source: 'manual',
        sourceId: null,
      }),
    );
    expect(a?.contactId).toBe(b?.contactId);
  });

  it('returns null for an un-normalizable input', async () => {
    const result = await withRls(ORG_ID, (tx) =>
      ensureContact(tx, {
        orgId: ORG_ID,
        kind: 'email',
        value: 'not-an-email',
        source: 'manual',
        sourceId: null,
      }),
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter web test tests/integration/contact-dedup-e2e
git add apps/web/tests/integration/contact-dedup-e2e.test.ts
git commit -m "test(integration): contact dedup end-to-end (M4 task 31)"
```

---

### Task 32: `.env.example` + workspace wiring + full gate

**Files:**

- Modify: `.env.example`
- Verify: `apps/web/package.json` already has all four new workspace deps (added in Tasks 6, 13, 20, 24)

- [ ] **Step 1: Update `.env.example`**

Append (or update existing Nylas section to add new vars):

```
# ─── Slack (internal messaging) ─────────────────────────────────
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=

# ─── Google Drive (files) ───────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_DRIVE_WEBHOOK_URL=

# ─── DocuSign (eSignature) ──────────────────────────────────────
DOCUSIGN_ACCOUNT_ID=
DOCUSIGN_INTEGRATION_KEY=
DOCUSIGN_USER_ID=
DOCUSIGN_PRIVATE_KEY=
DOCUSIGN_CONNECT_SECRET=
DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi

# ─── Vercel Queues (M4 topics) ──────────────────────────────────
VERCEL_QUEUE_SLACK_TOPIC=comms.slack.ingest
VERCEL_QUEUE_DRIVE_TOPIC=files.drive.ingest
VERCEL_QUEUE_DOCUSIGN_TOPIC=esign.docusign.events
```

- [ ] **Step 2: Run the full gate**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all four green. Note the new test counts:

- Unit tests: ~110 (up from 79 at M3 close — 31 new tests across the 4 subsystems).
- Integration tests: ~14 (12 from M2/M3 + 2 new M4 files contributing 9 + 5 = 14 new assertions).

- [ ] **Step 3: Commit any auto-fixes from pre-commit hooks**

```bash
git add -A
git status   # verify only formatted files; NO secrets
git commit -m "chore: env.example + lint/format fixes (M4 task 32)" --allow-empty
```

---

### Task 33: ADR 0004 + CLAUDE.md M4 close-out

**Files:**

- Create: `docs/adr/0004-phase-0-month-4-messaging-files-esign-contacts.md`
- Modify: `CLAUDE.md` §2

- [ ] **Step 1: Write ADR 0004**

Content outline (follow the M2/M3 ADR shape):

- **Status / Author / Supersedes / Superseded by** header.
- **Context** — 1-2 paragraphs on what M4 set out to do and the scope decisions (4 canonical integrations + lightweight contact dedup).
- **What shipped** — sections for: 4 new workspace packages, 8 new DB tables across 8 migrations, 1 new RLS migration, 3 new queue topics, the application surfaces (webhook routes, server actions, UI components, new pages).
- **Skipped tasks** table — 11 items: Teams, OneDrive, Box, Dropbox, Egnyte, Adobe Sign, PandaDoc, Snapdocs, Pavaso/Stavvy, Reducto, NetDocs/iManage, CRM Merge.dev pulls, ML contact similarity, WDK consumer, Vercel env provisioning.
- **Architectural decisions** with rationale:
  1. Slack URL verification + events + slash command share one route.
  2. Drive push notifications use channel-token equality (Google does not sign).
  3. Drive mirrors into Blob rather than streaming-on-read.
  4. DocuSign `sendEnvelope` is the only attorney-review-gated server action in the codebase to date; the gate lives server-side, the UI's disabled-button is informational.
  5. Contacts use deterministic match only; ML similarity is Phase 1.
  6. `contact_identities.organization_id` is a denormalized RLS-helper column.
  7. Queue topics published with no consumer — Phase 1 enrichment hook.
- **Carry-overs to M5+**.
- **What changed against the plan** (divergence log — fill in during execution).

- [ ] **Step 2: Update CLAUDE.md §2**

Move the existing M3 close-out section into the M2-style "Phase 0 Month 3 carry-overs (all carried to M5)" group, and write a fresh M4 close-out. Sample:

```markdown
- **Phase:** **Phase 0 Month 4 fully closed out (YYYY-MM-DD, 33 tasks on `feat/m4-messaging-files-esign-contacts`); Phase 0 Month 5 (Search + Memory: Typesense, pgvector + Turbopuffer, Apache AGE, Mem0, "Ask anything" search UI, attorney review workflow, SOC 2 scaffolding) is next.** M4 shipped four canonical integrations and a Postgres-only contact entity-resolution layer: `@cema/integrations-slack`, `@cema/integrations-drive`, `@cema/integrations-docusign`, `@cema/contacts`; 8 DB tables (0017–0023) + RLS migration (0024); Slack webhook + slash command; Drive push-notification mirror to Vercel Blob; DocuSign Connect with `sendEnvelope` enforcing the attorney-review hard rule server-side; `/contacts` index + ContactDetail with merged-source identities. 11 tasks skipped (Teams, OneDrive, Box, Dropbox, Egnyte, Adobe Sign, PandaDoc, Snapdocs, Pavaso/Stavvy, Reducto, NetDocs/iManage, CRM Merge.dev pulls, ML similarity, WDK consumer, env provisioning). See `docs/adr/0004-phase-0-month-4-messaging-files-esign-contacts.md`.
- **Next step:** Execute Phase 0 Month 5 plan (Search + Memory). Plan not yet written; write it before beginning implementation.
- **Phase 0 Month 4 carry-overs to M5+ (~14 items):**
  1. **Microsoft Teams** — Azure Entra OAuth app required.
  2. **OneDrive / SharePoint** — same Azure Entra dependency.
  3. **Box / Dropbox / Egnyte** — vendor OAuth app per vendor.
  4. **Adobe Sign / PandaDoc / Snapdocs / Pavaso / Stavvy** — vendor accounts.
  5. **Reducto IDP** — attachment + Drive-file classification; Phase 1.
  6. **NetDocuments / iManage Work** — law-firm DMS; Phase 2.
  7. **CRM unified contact pulls (Salesforce, HubSpot, Total Expert, Velocify, Surefire, BNTouch)** — depends on Merge.dev.
  8. **Clay / Apollo / ZoomInfo enrichment** — Phase 2.
  9. **ML similarity matching for ambiguous contact merges** — Phase 1 with Mem0.
  10. **Apache AGE knowledge graph** — Phase 0 Month 5 per spec §11.1.
  11. **WDK consumers for the 3 M4 queue topics** (`comms.slack.ingest`, `files.drive.ingest`, `esign.docusign.events`) — Phase 1.
  12. **ClamAV virus scanning for Drive mirror** — Phase 1, runs in Vercel Sandbox.
  13. **Slack outbound digests / scheduled posts** — Phase 1 with Knock.
  14. **Vercel env var provisioning + production smoke test** — all M4 keys.
```

Add a Changelog line:

```markdown
| YYYY-MM-DD | §2 updated: M4 closed (33 tasks on feat/m4-messaging-files-esign-contacts), M4 carry-overs listed, next step is M5 Search + Memory | Claude Opus 4.7 |
```

- [ ] **Step 3: Commit + push + PR**

```bash
git add docs/adr/0004-phase-0-month-4-messaging-files-esign-contacts.md CLAUDE.md
git commit -m "docs(m4): ADR 0004 + CLAUDE.md M4 close-out (M4 task 33)"
git push -u origin feat/m4-messaging-files-esign-contacts
gh pr create --title "feat(m4): messaging + files + esign + contacts (4 subsystems, 33 tasks)" --body-file <(cat <<'EOF'
## Summary

Phase 0 Month 4 close-out — 4 canonical integrations + lightweight contact entity resolution.

**Plan:** `docs/superpowers/plans/2026-05-22-phase-0-month-4-messaging-files-esign-contacts.md`
**ADR:** `docs/adr/0004-phase-0-month-4-messaging-files-esign-contacts.md`

### What shipped
- `@cema/integrations-slack`, `@cema/integrations-drive`, `@cema/integrations-docusign`, `@cema/contacts`
- 8 DB tables (migrations 0017–0023) + RLS migration 0024
- 3 webhook routes (slack, drive, docusign)
- 9 server actions
- 7 UI components + 3 new pages
- 9 RLS isolation assertions + 5 dedup E2E assertions

### Skipped (carries to M5+)
Microsoft Teams; OneDrive/SharePoint; Box/Dropbox/Egnyte; Adobe Sign / PandaDoc / Snapdocs / Pavaso / Stavvy; Reducto IDP; CRM Merge.dev pulls; ML similarity; WDK consumers; Vercel env provisioning. Full list in ADR 0004.

### Test plan
- [ ] CI green: Lint, Typecheck, Unit tests, Build
- [ ] CodeRabbit review
- [ ] Vercel preview deploy renders `/contacts` and `/deals/[id]/files`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
gh pr merge --auto --squash --delete-branch
```

---

## 7. Skipped tasks (per active session rule)

The following require external system registration, API credentials not yet provisioned, infrastructure not yet installed, or are explicitly later-phase per the spec:

| Task | Scope                                                                                      | Reason skipped                                          |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| A    | Slack App creation (api.slack.com — bot scopes, signing secret, slash command)             | Requires Slack account                                  |
| B    | Google Cloud OAuth app (Drive scopes drive.readonly + drive.file)                          | Requires GCP project                                    |
| C    | DocuSign Developer Sandbox + Integration Key + RSA keypair + JWT consent                   | Requires DocuSign account                               |
| D    | Nango provider configs for Slack / Drive / DocuSign                                        | Depends on Tasks A, B, C                                |
| E    | `/settings/integrations/{messaging                                                         | files                                                   | esign}` UI | Depends on Nango OAuth flows being live (same as M3 Task C) |
| F    | Microsoft Teams Bot (Bot Framework + Graph API)                                            | Azure Entra app registration — same blocker as M3 M365  |
| G    | OneDrive / SharePoint integration                                                          | Azure Entra dependency                                  |
| H    | Box integration                                                                            | Box developer account                                   |
| I    | Dropbox Business integration                                                               | Dropbox developer account                               |
| J    | Egnyte integration                                                                         | Egnyte developer account                                |
| K    | NetDocuments / iManage Work (law-firm DMS)                                                 | Phase 2                                                 |
| L    | Adobe Acrobat Sign integration                                                             | Account + scoping; Phase 1+                             |
| M    | PandaDoc integration                                                                       | Account + scoping; Phase 1+                             |
| N    | Snapdocs (full e-closing)                                                                  | Phase 2                                                 |
| O    | Pavaso / Stavvy (Remote Online Notarization)                                               | Phase 2                                                 |
| P    | Reducto IDP for Drive file + email attachment classification                               | Requires Reducto account; Phase 1                       |
| Q    | ClamAV virus scanning in Vercel Sandbox for Drive mirror                                   | Phase 1                                                 |
| R    | CRM unified contact pulls (Salesforce, HubSpot, Total Expert, Velocify, Surefire, BNTouch) | Depends on Merge.dev OAuth                              |
| S    | Clay / Apollo / ZoomInfo contact enrichment                                                | Phase 2                                                 |
| T    | ML similarity matching for ambiguous contact merges (with Mem0 confidence storage)         | Phase 1                                                 |
| U    | Apache AGE knowledge graph                                                                 | Phase 0 Month 5 per spec §11.1                          |
| V    | WDK workflow consumers for the 3 M4 queue topics                                           | `@vercel/workflow` not installed (carried from M2 + M3) |
| W    | Vercel env var provisioning + production smoke test                                        | Requires all M4 API keys                                |

---

## 8. Open Questions

Carried forward from the M3 plan §8 plus new questions surfaced in M4 design:

1. **Contact identity ambiguity at the Slack/email boundary.** A Slack user U01ABC in team T0123 may also have an `@firm.com` email on file. M4 treats `slack_user:t0123:u01abc` and `email:bob@firm.com` as two separate identities pointing to one contact only if the email and Slack profile are explicitly linked elsewhere (e.g., Slack profile email field). Should we auto-link via Slack `users.info` profile.email? Risk: Slack profile emails are sometimes pseudonyms.
2. **Drive sync direction.** Spec §8.6 calls Drive "read-only sync into Vercel Blob." Should a processor be able to upload from CEMA back to Drive (e.g., a draft CEMA generated in DocMagic)? If yes, conflict-resolution rules need spec.
3. **DocuSign template management.** M4 sends envelopes built from arbitrary documents. Should we add a DocuSign template-mapping layer so processors can pick a template instead of constructing a recipients list each time? Phase 1+ candidate.
4. **Attorney-review gate scope.** Hard rule #2 lists 12 document kinds. Is every kind in that list required to gate `sendEnvelope`, or only the lender-recordable subset (cema*3172, exhibit*\*, aff_255, aff_275, aom, allonge, consolidated_note, gap_note, gap_mortgage)? M4 ships the gate for every doc with `attorney_review_required=true` regardless of kind — verify against legal counsel before production.
5. **Contact GC.** `mergeContacts` leaves orphan contact rows. Should we run a periodic GC, or leave them as-is? Orphans are tiny (one row) but inflate the contacts count visible in the UI count if not filtered.
6. **Slack message TTL.** Slack retention policies vary by workspace. If a workspace retains 90 days of messages, should we mirror permanently anyway (CEMA stores indefinitely)? Need a legal-hold conversation per spec §10.5.
7. **DocuSign envelope-completed → document.status transition.** When an envelope completes, should the `documents.status` automatically flip to `recorded`? Hard rule #6 says "NEVER mark a deal recorded without a reel/page or CRFN from the recording authority." DocuSign completion is the e-signature event, not the recording event — they're distinct. M4 leaves the transition manual; document this explicitly in ADR 0004.
8. **Drive folder vs file watch.** Google Drive `files.watch` only fires on the specific file, not on folder-level adds. M4 ships file-level watch; folder-level requires a periodic `files.list` poll. Phase 1?
