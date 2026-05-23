# Phase 0 Month 3 — Email + Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-05-22
**Phase:** 0 (Foundation), Month 3 of 5
**Prior plan:** [2026-05-13-phase-0-month-2-telephony.md](./2026-05-13-phase-0-month-2-telephony.md)
**Prior ADR:** [0002-phase-0-month-2-telephony.md](../../adr/0002-phase-0-month-2-telephony.md)

**Spec anchors:** §8.3 (Email), §8.5 (Calendar & Scheduling), §11.1 Month 3 row, §16.K (Email catalog), §16.M (Calendar catalog).

---

## 1. Goal & End State

By end-of-month the Vercel preview shows the following working against real Neon + real Vercel Blob + a sandboxed Nylas grant:

1. A processor who has connected their Gmail or Microsoft 365 account via Nylas sees incoming email threads for a Deal in the same Communications timeline as calls.
2. When Nylas fires a webhook for a new email message, the app verifies the signature, upserts a `communications` row (`kind='email'`) and an `email_threads` row (subject, body HTML, participants, attachment IDs), and returns 200 OK in < 2 s.
3. When Nylas fires a webhook for a new or updated calendar event, the app upserts a `communications` row (`kind='meeting'`) and a `calendar_events` row (title, attendees, times), and returns 200 OK in < 2 s.
4. Per Deal, processors see a unified Communications timeline that renders call cards, email thread cards, and calendar event cards in reverse-chronological order.
5. Drilling into a `kind='email'` communication shows the full thread: subject, participants, body HTML (sanitized), attachment list.
6. Drilling into a `kind='meeting'` communication shows event details: title, time, location, attendees.
7. RLS is enforced: `org_nylas_connections`, `email_threads`, and `calendar_events` are invisible across org boundaries.

**Deliverable validation:**

- `pnpm test` passes (unit tests on new packages + actions, TDD-verified failing-then-passing).
- `pnpm test:integration` adds 1 new integration test file (`email-calendar-rls.test.ts`, 6 assertions).
- `pnpm typecheck` and `pnpm lint` clean.
- `pnpm build` green.

---

## 2. Hard Non-Goals (out of scope this month)

- **No Nylas OAuth app registration** (requires Google Cloud Console + Azure Entra app registration in vendor portals) — skipped per session rule. The Nylas client, webhook handler, and UI are built; the live OAuth dance requires vendor credentials not yet provisioned.
- **No Nango provider config for Nylas** — depends on the OAuth app registration above.
- **No `/settings/integrations/email-calendar` UI** — depends on Nango OAuth flow (same as telephony settings page, M2 Task 22).
- **No Reducto IDP for attachment classification** — requires Reducto account; full IDP pipeline is Phase 1.
- **No Cal.com scheduling links** — requires Cal.com account setup.
- **No NeverBounce email verification** — requires account; outbound transactional email is Resend (Phase 1+).
- **No WDK workflow for email ingest** — `@vercel/workflow` still not installed. Unlike telephony recordings (binary blob requiring async download), email body content fits inline in the webhook handler without a durable workflow. The queue publish is included as a placeholder for the Phase 1 async enrichment step (AI summary, attachment IDP).
- **No Vercel env var provisioning + production smoke test** — requires real Nylas API key (`NYLAS_API_KEY`, `NYLAS_WEBHOOK_SECRET`) not yet provisioned.
- **No Microsoft Teams Phone** — M4 per spec §11.1 Month 4.
- **No outbound email sending** — Resend integration is Phase 1 (Servicer Outreach Agent).
- **No email cadences / chase follow-up automation** — Phase 1 (WDK-based stateful sequences).

---

## 3. Architecture Sketch

```
Gmail / Microsoft 365
     │  (via Nylas grant)
     ▼
Nylas platform
     │  POSTs /api/webhooks/nylas
     │  X-Nylas-Signature: HMAC-SHA256
     ▼
┌─────────────────────────────────────────────────────────┐
│  POST /api/webhooks/nylas/route.ts                      │
│   1. Verify HMAC-SHA256 (NYLAS_WEBHOOK_SECRET)          │
│   2. Resolve nylas_grant_id → org_id via                │
│      org_nylas_connections (neondb_owner, BYPASSRLS)    │
│   3. Parse trigger type:                                │
│      message.created  → upsert email_threads            │
│      event.created /  → upsert calendar_events          │
│      event.updated                                      │
│   4. Upsert communications row (kind=email|meeting)     │
│   5. publish to Vercel Queue: comms.email.ingest        │
│      (Phase 1: AI summary + Reducto IDP will consume)   │
│   6. 200 OK                                             │
└─────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Neon Postgres (RLS-enforced via withRls)               │
│   communications  (kind=email|meeting)                  │
│   email_threads   (1:1 via communication_id)            │
│   calendar_events (1:1 via communication_id)            │
│   org_nylas_connections (one row per org+provider)      │
└─────────────────────────────────────────────────────────┘
                      ▲
                      │ RSC server actions
                      │
┌─────────────────────────────────────────────────────────┐
│  Next.js 16 apps/web (RSC)                             │
│   /deals/[id]/communications         (unified timeline) │
│   /deals/[id]/communications/[c]     (detail — routes   │
│                                       on comm.kind)     │
└─────────────────────────────────────────────────────────┘
```

**Why inline upsert (no WDK workflow)?** Email body text is small enough for a serverless function to write synchronously. Recordings need a WDK workflow because audio files are megabytes requiring async download + blob upload. Email body is a few KB of JSON from Nylas already present in the webhook payload.

**Why a queue publish anyway?** The `comms.email.ingest` queue message is the hook for Phase 1 work (AI summary, Reducto IDP for attachments, entity resolution). The consumer is not implemented in M3 — messages go to dead-letter and are idempotently reprocessable when the Phase 1 WDK workflow ships.

---

## 4. Pre-flight / Dependencies

### 4.1 Packages to add to workspace

```
packages/integrations/nylas/    # Nylas SDK wrapper + types + webhook verification
```

Follows M2 pattern: `client.ts`, `types.ts`, `webhook.ts`, `index.ts`, colocated `*.test.ts`.

### 4.2 npm packages to install

```bash
pnpm --filter @cema/integrations-nylas add nylas          # Nylas Node SDK v7+
pnpm --filter @cema/integrations-nylas add -D @types/node
pnpm --filter apps/web add dompurify                      # sanitize email body HTML
pnpm --filter apps/web add -D @types/dompurify
```

### 4.3 Env vars (add to `.env.example`; do NOT commit values)

```
# Nylas
NYLAS_API_KEY=...              # Nylas app API key
NYLAS_WEBHOOK_SECRET=...       # Nylas webhook signing secret
NYLAS_API_URI=https://api.us.nylas.com   # or eu for EU data residency

# Vercel Queues (new topic)
VERCEL_QUEUE_EMAIL_TOPIC=comms.email.ingest
```

### 4.4 Skipped provisioning tasks

| Task                                              | Reason                                   |
| ------------------------------------------------- | ---------------------------------------- |
| Nylas app creation (dashboard.nylas.com)          | Requires account — skip per session rule |
| Google Cloud Console OAuth app (for Gmail grants) | External registration — skip             |
| Azure Entra app registration (for M365 grants)    | External registration — skip             |
| Nango provider config for Nylas                   | Depends on above OAuth apps — skip       |
| NYLAS_API_KEY + NYLAS_WEBHOOK_SECRET in Vercel    | Requires real API key — skip             |

---

## 5. File Map

### New files

```
packages/integrations/nylas/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── types.ts
    ├── client.ts          + client.test.ts
    ├── webhook.ts         + webhook.test.ts

packages/db/src/schema/
├── nylas-connections.ts   (new)
├── email-threads.ts       (new)
├── calendar-events.ts     (new)

packages/db/migrations/
├── 0013_nylas_connections.sql
├── 0014_email_threads.sql
├── 0015_calendar_events.sql
├── 0016_rls_email_calendar.sql

apps/web/
├── lib/actions/
│   ├── list-emails.ts               + list-emails.test.ts
│   ├── get-email.ts                 + get-email.test.ts
│   ├── list-calendar-events.ts      + list-calendar-events.test.ts
│   └── get-calendar-event.ts        + get-calendar-event.test.ts
├── components/
│   ├── email-thread-card.tsx
│   ├── email-thread-viewer.tsx
│   └── calendar-event-card.tsx
├── app/api/webhooks/nylas/route.ts  + route.test.ts
└── tests/integration/
    └── email-calendar-rls.test.ts
```

### Modified files

```
packages/db/src/schema/index.ts           (add 3 new exports)
apps/web/app/(app)/deals/[id]/communications/page.tsx     (render EmailThreadCard + CalendarEventCard)
apps/web/app/(app)/deals/[id]/communications/[c]/page.tsx (route on kind to EmailThreadViewer or CalendarEventCard)
.env.example                              (add NYLAS_* vars)
```

---

## 6. Tasks

---

### Task 1: DB — org_nylas_connections table (migration 0013)

**Files:**

- Create: `packages/db/src/schema/nylas-connections.ts`
- Create: `packages/db/migrations/0013_nylas_connections.sql`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// packages/db/src/schema/nylas-connections.ts
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

export const orgNylasConnections = pgTable(
  'org_nylas_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // 'gmail' | 'm365' — mirrors communicationMediumEnum values for
    // the two providers Nylas supports that we use in M3.
    providerType: varchar('provider_type', { length: 32 }).notNull(),
    // Nylas grant_id — the stable identifier for a connected mailbox.
    // Used by webhook handler to resolve organization_id from the
    // grant_id in the Nylas event payload.
    nylasGrantId: varchar('nylas_grant_id', { length: 128 }).notNull(),
    // The email address of the connected mailbox (e.g. "processor@firm.com").
    emailAddress: varchar('email_address', { length: 256 }).notNull(),
    connectionStatus: varchar('connection_status', { length: 32 }).notNull().default('pending'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('org_nylas_connections_grant_id_uidx').on(t.nylasGrantId),
    uniqueIndex('org_nylas_connections_org_provider_email_uidx').on(
      t.organizationId,
      t.providerType,
      t.emailAddress,
    ),
    index('org_nylas_connections_org_status_idx').on(t.organizationId, t.connectionStatus),
    index('org_nylas_connections_organization_id_idx').on(t.organizationId),
    check(
      'org_nylas_connections_status_valid',
      sql`${t.connectionStatus} IN ('pending', 'active', 'error', 'revoked')`,
    ),
    check('org_nylas_connections_provider_valid', sql`${t.providerType} IN ('gmail', 'm365')`),
    check(
      'org_nylas_connections_revoked_at_required',
      sql`(${t.connectionStatus} = 'revoked' AND ${t.revokedAt} IS NOT NULL) OR (${t.connectionStatus} <> 'revoked' AND ${t.revokedAt} IS NULL)`,
    ),
  ],
);
```

- [ ] **Step 2: Export from schema index**

In `packages/db/src/schema/index.ts`, add:

```typescript
export * from './nylas-connections';
```

- [ ] **Step 3: Generate migration**

```bash
cd C:\Users\conno\Code\Project_CEMA_v1.0.0
pnpm --filter @cema/db db:generate
```

Rename the generated file to `0013_nylas_connections.sql`. Confirm it contains `CREATE TABLE "org_nylas_connections"`.

- [ ] **Step 4: Apply migration**

```bash
pnpm --filter @cema/db db:migrate
```

Expected: `Applied 1 migration.`

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/nylas-connections.ts packages/db/src/schema/index.ts packages/db/migrations/0013_nylas_connections.sql packages/db/migrations/meta/
git commit -m "feat(db): add org_nylas_connections table (M3 task 1)"
```

---

### Task 2: DB — email_threads table (migration 0014)

**Files:**

- Create: `packages/db/src/schema/email-threads.ts`
- Create: `packages/db/migrations/0014_email_threads.sql`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// packages/db/src/schema/email-threads.ts
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { communications } from './communications';

// EmailParticipant type used in to_participants / cc_participants JSONB columns.
export interface EmailParticipant {
  email: string;
  name: string | null;
}

export const emailThreads = pgTable(
  'email_threads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // 1:1 with communications (kind='email'). UNIQUE enforced below.
    communicationId: uuid('communication_id')
      .notNull()
      .references(() => communications.id, { onDelete: 'restrict' }),
    // Nylas thread ID — stable across replies.
    nylasThreadId: varchar('nylas_thread_id', { length: 256 }).notNull(),
    // Nylas grant ID — identifies which mailbox this thread belongs to.
    nylasGrantId: varchar('nylas_grant_id', { length: 128 }).notNull(),
    subject: text('subject'),
    snippet: text('snippet'),
    fromEmail: varchar('from_email', { length: 256 }),
    fromName: varchar('from_name', { length: 256 }),
    toParticipants: jsonb('to_participants').$type<EmailParticipant[]>().default([]).notNull(),
    ccParticipants: jsonb('cc_participants').$type<EmailParticipant[]>().default([]).notNull(),
    bodyHtml: text('body_html'),
    bodyPlain: text('body_plain'),
    messageCount: integer('message_count').notNull().default(1),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    // Nylas attachment IDs — used to generate download URLs on demand via
    // Nylas API. We do NOT store attachment binaries in Blob in M3;
    // that is Phase 1 IDP work (Reducto classification).
    nylasAttachmentIds: jsonb('nylas_attachment_ids').$type<string[]>().default([]).notNull(),
    firstMessageAt: timestamp('first_message_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('email_threads_communication_id_uidx').on(t.communicationId),
    uniqueIndex('email_threads_nylas_thread_id_grant_uidx').on(t.nylasThreadId, t.nylasGrantId),
    index('email_threads_nylas_grant_id_idx').on(t.nylasGrantId),
    check('email_threads_message_count_pos', sql`${t.messageCount} >= 1`),
  ],
);
```

- [ ] **Step 2: Export from schema index**

Add to `packages/db/src/schema/index.ts`:

```typescript
export * from './email-threads';
```

- [ ] **Step 3: Generate + rename migration to `0014_email_threads.sql`**

```bash
pnpm --filter @cema/db db:generate
```

- [ ] **Step 4: Apply migration**

```bash
pnpm --filter @cema/db db:migrate
```

Expected: `Applied 1 migration.`

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add packages/db/src/schema/email-threads.ts packages/db/src/schema/index.ts packages/db/migrations/0014_email_threads.sql packages/db/migrations/meta/
git commit -m "feat(db): add email_threads table (M3 task 2)"
```

---

### Task 3: DB — calendar_events table (migration 0015)

**Files:**

- Create: `packages/db/src/schema/calendar-events.ts`
- Create: `packages/db/migrations/0015_calendar_events.sql`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// packages/db/src/schema/calendar-events.ts
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

export interface CalendarAttendee {
  email: string;
  name: string | null;
  status: 'accepted' | 'declined' | 'tentative' | 'noreply';
}

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // 1:1 with communications (kind='meeting'). UNIQUE enforced below.
    communicationId: uuid('communication_id')
      .notNull()
      .references(() => communications.id, { onDelete: 'restrict' }),
    nylasEventId: varchar('nylas_event_id', { length: 256 }).notNull(),
    nylasCalendarId: varchar('nylas_calendar_id', { length: 256 }).notNull(),
    nylasGrantId: varchar('nylas_grant_id', { length: 128 }).notNull(),
    title: text('title'),
    description: text('description'),
    location: text('location'),
    // 'confirmed' | 'tentative' | 'cancelled'
    eventStatus: varchar('event_status', { length: 32 }).notNull().default('confirmed'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    isAllDay: boolean('is_all_day').notNull().default(false),
    organizerEmail: varchar('organizer_email', { length: 256 }),
    organizerName: varchar('organizer_name', { length: 256 }),
    attendees: jsonb('attendees').$type<CalendarAttendee[]>().default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('calendar_events_communication_id_uidx').on(t.communicationId),
    uniqueIndex('calendar_events_nylas_event_grant_uidx').on(t.nylasEventId, t.nylasGrantId),
    index('calendar_events_nylas_grant_id_idx').on(t.nylasGrantId),
    check(
      'calendar_events_status_valid',
      sql`${t.eventStatus} IN ('confirmed', 'tentative', 'cancelled')`,
    ),
  ],
);
```

- [ ] **Step 2: Export + generate migration (rename to `0015_calendar_events.sql`) + apply + commit**

```bash
# Add export to index.ts first, then:
pnpm --filter @cema/db db:generate
# rename migration file
pnpm --filter @cema/db db:migrate
pnpm typecheck
git add packages/db/src/schema/calendar-events.ts packages/db/src/schema/index.ts packages/db/migrations/0015_calendar_events.sql packages/db/migrations/meta/
git commit -m "feat(db): add calendar_events table (M3 task 3)"
```

---

### Task 4: DB — RLS policies for M3 tables (migration 0016)

**Files:**

- Create: `packages/db/migrations/0016_rls_email_calendar.sql`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/migrations/0016_rls_email_calendar.sql

-- org_nylas_connections: direct organization_id equality (same shape as communications)
ALTER TABLE "org_nylas_connections" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nylas_connections_org_isolation" ON "org_nylas_connections"
  AS PERMISSIVE FOR ALL
  TO cema_app_user
  USING ("organization_id" = (current_setting('app.current_organization_id'))::uuid);

-- email_threads: no own org column; policy via EXISTS on communications.
-- Same pattern as recordings (migration 0011).
ALTER TABLE "email_threads" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_threads_org_isolation" ON "email_threads"
  AS PERMISSIVE FOR ALL
  TO cema_app_user
  USING (
    EXISTS (
      SELECT 1 FROM "communications" c
      WHERE c.id = "email_threads"."communication_id"
        AND c.organization_id = (current_setting('app.current_organization_id'))::uuid
    )
  );

-- calendar_events: same EXISTS pattern.
ALTER TABLE "calendar_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar_events_org_isolation" ON "calendar_events"
  AS PERMISSIVE FOR ALL
  TO cema_app_user
  USING (
    EXISTS (
      SELECT 1 FROM "communications" c
      WHERE c.id = "calendar_events"."communication_id"
        AND c.organization_id = (current_setting('app.current_organization_id'))::uuid
    )
  );
```

- [ ] **Step 2: Add to Drizzle journal manually**

The RLS migration contains no DDL that Drizzle tracks (no new columns/tables after Task 3). Add it to `packages/db/migrations/meta/_journal.json` manually in the same pattern as `0011_rls_telephony.sql` was added.

Open `packages/db/migrations/meta/_journal.json`. Append:

```json
{
  "idx": 16,
  "version": "7",
  "when": <current-unix-ms>,
  "tag": "0016_rls_email_calendar",
  "breakpoints": true
}
```

- [ ] **Step 3: Apply migration**

```bash
pnpm --filter @cema/db db:migrate
```

Expected: `Applied 1 migration.`

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0016_rls_email_calendar.sql packages/db/migrations/meta/
git commit -m "feat(db): RLS policies on email/calendar M3 tables (M3 task 4)"
```

---

### Task 5: @cema/integrations-nylas package scaffold + types

**Files:**

- Create: `packages/integrations/nylas/package.json`
- Create: `packages/integrations/nylas/tsconfig.json`
- Create: `packages/integrations/nylas/src/index.ts`
- Create: `packages/integrations/nylas/src/types.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@cema/integrations-nylas",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "nylas": "^7.7.0"
  },
  "devDependencies": {
    "@cema/config": "workspace:*",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Copy from `packages/integrations/deepgram/tsconfig.json` (identical structure).

- [ ] **Step 3: Install the Nylas SDK**

```bash
cd C:\Users\conno\Code\Project_CEMA_v1.0.0
pnpm --filter @cema/integrations-nylas add nylas
```

- [ ] **Step 4: Write types.ts**

```typescript
// packages/integrations/nylas/src/types.ts

export interface NormalizedEmailParticipant {
  email: string;
  name: string | null;
}

export interface NormalizedEmailThread {
  nylasThreadId: string;
  nylasGrantId: string;
  subject: string | null;
  snippet: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toParticipants: NormalizedEmailParticipant[];
  ccParticipants: NormalizedEmailParticipant[];
  bodyHtml: string | null;
  bodyPlain: string | null;
  messageCount: number;
  hasAttachments: boolean;
  nylasAttachmentIds: string[];
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
}

export interface NormalizedCalendarAttendee {
  email: string;
  name: string | null;
  status: 'accepted' | 'declined' | 'tentative' | 'noreply';
}

export interface NormalizedCalendarEvent {
  nylasEventId: string;
  nylasCalendarId: string;
  nylasGrantId: string;
  title: string | null;
  description: string | null;
  location: string | null;
  eventStatus: 'confirmed' | 'tentative' | 'cancelled';
  startsAt: Date | null;
  endsAt: Date | null;
  isAllDay: boolean;
  organizerEmail: string | null;
  organizerName: string | null;
  attendees: NormalizedCalendarAttendee[];
}

// Discriminated union of all webhook event shapes the handler cares about.
export type NylasWebhookEvent =
  | { trigger: 'message.created'; grantId: string; objectData: { threadId: string; id: string } }
  | { trigger: 'event.created'; grantId: string; objectData: { calendarId: string; id: string } }
  | { trigger: 'event.updated'; grantId: string; objectData: { calendarId: string; id: string } }
  | { trigger: string; grantId: string; objectData: Record<string, unknown> };
```

- [ ] **Step 5: Write index.ts**

```typescript
// packages/integrations/nylas/src/index.ts
export * from './types';
export * from './client';
export * from './webhook';
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @cema/integrations-nylas typecheck
```

Expected: 0 errors. (client.ts and webhook.ts don't exist yet — create empty stubs.)

Create stubs:

```typescript
// packages/integrations/nylas/src/client.ts
export {};
// packages/integrations/nylas/src/webhook.ts
export {};
```

- [ ] **Step 7: Commit**

```bash
git add packages/integrations/nylas/
git commit -m "feat(integrations): scaffold @cema/integrations-nylas package (M3 task 5)"
```

---

### Task 6: @cema/integrations-nylas webhook verification + parsing

**Files:**

- Modify: `packages/integrations/nylas/src/webhook.ts`
- Create: `packages/integrations/nylas/src/webhook.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/integrations/nylas/src/webhook.test.ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseNylasWebhookPayload, verifyNylasWebhookSignature } from './webhook';

const SECRET = 'test-webhook-secret-abc123';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

const EMAIL_PAYLOAD = JSON.stringify({
  specversion: '1.0',
  type: 'message.created',
  source: '/nylas/us',
  data: {
    application_id: 'app123',
    object: {
      grant_id: 'grant-abc',
      object: 'message',
      id: 'msg-001',
      thread_id: 'thread-xyz',
    },
  },
});

const CALENDAR_PAYLOAD = JSON.stringify({
  specversion: '1.0',
  type: 'event.created',
  source: '/nylas/us',
  data: {
    application_id: 'app123',
    object: {
      grant_id: 'grant-abc',
      object: 'event',
      id: 'evt-001',
      calendar_id: 'cal-001',
    },
  },
});

describe('verifyNylasWebhookSignature', () => {
  it('returns true for a valid HMAC-SHA256 signature', () => {
    const sig = sign(EMAIL_PAYLOAD);
    expect(verifyNylasWebhookSignature(SECRET, sig, EMAIL_PAYLOAD)).toBe(true);
  });

  it('returns false for a tampered body', () => {
    const sig = sign(EMAIL_PAYLOAD);
    expect(verifyNylasWebhookSignature(SECRET, sig, EMAIL_PAYLOAD + 'x')).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const sig = createHmac('sha256', 'wrong').update(EMAIL_PAYLOAD).digest('hex');
    expect(verifyNylasWebhookSignature(SECRET, sig, EMAIL_PAYLOAD)).toBe(false);
  });
});

describe('parseNylasWebhookPayload', () => {
  it('parses a message.created event', () => {
    const event = parseNylasWebhookPayload(EMAIL_PAYLOAD);
    expect(event.trigger).toBe('message.created');
    expect(event.grantId).toBe('grant-abc');
    expect(event.objectData).toMatchObject({ id: 'msg-001', threadId: 'thread-xyz' });
  });

  it('parses an event.created event', () => {
    const event = parseNylasWebhookPayload(CALENDAR_PAYLOAD);
    expect(event.trigger).toBe('event.created');
    expect(event.grantId).toBe('grant-abc');
    expect(event.objectData).toMatchObject({ id: 'evt-001', calendarId: 'cal-001' });
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm --filter @cema/integrations-nylas test
```

Expected: FAIL — `verifyNylasWebhookSignature is not a function`.

- [ ] **Step 3: Implement webhook.ts**

```typescript
// packages/integrations/nylas/src/webhook.ts
import { createHmac } from 'node:crypto';

import type { NylasWebhookEvent } from './types';

export function verifyNylasWebhookSignature(
  secret: string,
  signature: string,
  rawBody: string,
): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected === signature;
}

export function parseNylasWebhookPayload(rawBody: string): NylasWebhookEvent {
  const payload = JSON.parse(rawBody) as {
    type: string;
    data: {
      object: {
        grant_id: string;
        id: string;
        thread_id?: string;
        calendar_id?: string;
        [key: string]: unknown;
      };
    };
  };

  const trigger = payload.type;
  const grantId = payload.data.object.grant_id;
  const raw = payload.data.object;

  if (trigger === 'message.created') {
    return {
      trigger,
      grantId,
      objectData: { id: raw.id, threadId: raw.thread_id ?? '' },
    };
  }

  if (trigger === 'event.created' || trigger === 'event.updated') {
    return {
      trigger,
      grantId,
      objectData: { id: raw.id, calendarId: raw.calendar_id ?? '' },
    };
  }

  return { trigger, grantId, objectData: raw as Record<string, unknown> };
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
pnpm --filter @cema/integrations-nylas test
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/nylas/src/webhook.ts packages/integrations/nylas/src/webhook.test.ts
git commit -m "feat(integrations): Nylas webhook verification + payload parser (M3 task 6)"
```

---

### Task 7: @cema/integrations-nylas client (thread + event fetchers)

**Files:**

- Modify: `packages/integrations/nylas/src/client.ts`
- Create: `packages/integrations/nylas/src/client.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/integrations/nylas/src/client.test.ts
import { describe, expect, it, vi } from 'vitest';

// Mock the nylas module before importing the client under test.
vi.mock('nylas', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      threads: {
        find: vi.fn().mockResolvedValue({
          id: 'thread-xyz',
          grantId: 'grant-abc',
          subject: 'RE: CEMA request',
          snippet: 'Please see the attached payoff',
          from: [{ email: 'servicer@example.com', name: 'Servicer CEMA' }],
          to: [{ email: 'processor@firm.com', name: 'Processor' }],
          cc: [],
          latestDraftOrMessage: {
            body: '<p>Please see the attached payoff</p>',
            attachments: [{ id: 'att-001' }],
          },
          messageIds: ['msg-001'],
          earliestMessageDate: 1716000000,
          latestMessageReceivedDate: 1716000000,
        }),
      },
      events: {
        find: vi.fn().mockResolvedValue({
          id: 'evt-001',
          calendarId: 'cal-001',
          grantId: 'grant-abc',
          title: 'CEMA Closing — Deal 123',
          description: 'Final closing meeting',
          location: '123 Main St',
          status: 'confirmed',
          when: { startTime: 1716003600, endTime: 1716007200, object: 'timespan' },
          organizer: { email: 'attorney@firm.com', name: 'Attorney' },
          participants: [{ email: 'processor@firm.com', name: 'Processor', status: 'accepted' }],
        }),
      },
    })),
  };
});

import { getNylasClient, fetchEmailThread, fetchCalendarEvent } from './client';

describe('fetchEmailThread', () => {
  it('returns a NormalizedEmailThread', async () => {
    const client = getNylasClient('fake-api-key');
    const thread = await fetchEmailThread(client, 'grant-abc', 'thread-xyz');
    expect(thread.nylasThreadId).toBe('thread-xyz');
    expect(thread.subject).toBe('RE: CEMA request');
    expect(thread.fromEmail).toBe('servicer@example.com');
    expect(thread.hasAttachments).toBe(true);
    expect(thread.nylasAttachmentIds).toEqual(['att-001']);
  });
});

describe('fetchCalendarEvent', () => {
  it('returns a NormalizedCalendarEvent', async () => {
    const client = getNylasClient('fake-api-key');
    const event = await fetchCalendarEvent(client, 'grant-abc', 'cal-001', 'evt-001');
    expect(event.nylasEventId).toBe('evt-001');
    expect(event.title).toBe('CEMA Closing — Deal 123');
    expect(event.eventStatus).toBe('confirmed');
    expect(event.attendees).toHaveLength(1);
    expect(event.attendees[0]!.email).toBe('processor@firm.com');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm --filter @cema/integrations-nylas test
```

Expected: FAIL — `fetchEmailThread is not a function`.

- [ ] **Step 3: Implement client.ts**

```typescript
// packages/integrations/nylas/src/client.ts
import Nylas from 'nylas';

import type { NormalizedCalendarEvent, NormalizedEmailThread } from './types';

export function getNylasClient(apiKey: string): Nylas {
  return new Nylas({ apiKey });
}

export async function fetchEmailThread(
  client: Nylas,
  grantId: string,
  threadId: string,
): Promise<NormalizedEmailThread> {
  const thread = await client.threads.find({ identifier: grantId, threadId });

  const lastMsg = (
    thread as { latestDraftOrMessage?: { body?: string; attachments?: { id: string }[] } }
  ).latestDraftOrMessage;
  const attachmentIds = (lastMsg?.attachments ?? []).map((a) => a.id);

  const fromArr = (thread as { from?: { email?: string; name?: string }[] }).from ?? [];
  const toArr = (thread as { to?: { email?: string; name?: string }[] }).to ?? [];
  const ccArr = (thread as { cc?: { email?: string; name?: string }[] }).cc ?? [];

  return {
    nylasThreadId: thread.id ?? threadId,
    nylasGrantId: grantId,
    subject: (thread as { subject?: string }).subject ?? null,
    snippet: (thread as { snippet?: string }).snippet ?? null,
    fromEmail: fromArr[0]?.email ?? null,
    fromName: fromArr[0]?.name ?? null,
    toParticipants: toArr.map((p) => ({ email: p.email ?? '', name: p.name ?? null })),
    ccParticipants: ccArr.map((p) => ({ email: p.email ?? '', name: p.name ?? null })),
    bodyHtml: lastMsg?.body ?? null,
    bodyPlain: null,
    messageCount: ((thread as { messageIds?: string[] }).messageIds ?? []).length || 1,
    hasAttachments: attachmentIds.length > 0,
    nylasAttachmentIds: attachmentIds,
    firstMessageAt: toUnixDate((thread as { earliestMessageDate?: number }).earliestMessageDate),
    lastMessageAt: toUnixDate(
      (thread as { latestMessageReceivedDate?: number }).latestMessageReceivedDate,
    ),
  };
}

export async function fetchCalendarEvent(
  client: Nylas,
  grantId: string,
  calendarId: string,
  eventId: string,
): Promise<NormalizedCalendarEvent> {
  const event = await client.events.find({ identifier: grantId, eventId });

  const e = event as {
    id?: string;
    calendarId?: string;
    title?: string;
    description?: string;
    location?: string;
    status?: string;
    when?: { startTime?: number; endTime?: number; object?: string };
    organizer?: { email?: string; name?: string };
    participants?: { email?: string; name?: string; status?: string }[];
  };

  const when = e.when ?? {};
  const isAllDay = when.object === 'date' || when.object === 'datespan';

  return {
    nylasEventId: e.id ?? eventId,
    nylasCalendarId: e.calendarId ?? calendarId,
    nylasGrantId: grantId,
    title: e.title ?? null,
    description: e.description ?? null,
    location: e.location ?? null,
    eventStatus: normalizeStatus(e.status),
    startsAt: toUnixDate(when.startTime),
    endsAt: toUnixDate(when.endTime),
    isAllDay,
    organizerEmail: e.organizer?.email ?? null,
    organizerName: e.organizer?.name ?? null,
    attendees: (e.participants ?? []).map((p) => ({
      email: p.email ?? '',
      name: p.name ?? null,
      status: normalizeAttendeeStatus(p.status),
    })),
  };
}

function toUnixDate(unix: number | undefined): Date | null {
  if (!unix) return null;
  return new Date(unix * 1000);
}

function normalizeStatus(s: string | undefined): 'confirmed' | 'tentative' | 'cancelled' {
  if (s === 'tentative') return 'tentative';
  if (s === 'cancelled') return 'cancelled';
  return 'confirmed';
}

function normalizeAttendeeStatus(
  s: string | undefined,
): 'accepted' | 'declined' | 'tentative' | 'noreply' {
  if (s === 'accepted' || s === 'yes') return 'accepted';
  if (s === 'declined' || s === 'no') return 'declined';
  if (s === 'tentative' || s === 'maybe') return 'tentative';
  return 'noreply';
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter @cema/integrations-nylas test
```

Expected: PASS — all 7 tests green (5 from Task 6 + 2 new).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add packages/integrations/nylas/src/client.ts packages/integrations/nylas/src/client.test.ts
git commit -m "feat(integrations): Nylas thread + event fetchers (M3 task 7)"
```

---

### Task 8: Nylas webhook route

**Files:**

- Create: `apps/web/app/api/webhooks/nylas/route.ts`
- Create: `apps/web/app/api/webhooks/nylas/route.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/app/api/webhooks/nylas/route.test.ts
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/integrations-nylas', () => ({
  verifyNylasWebhookSignature: vi.fn(),
  parseNylasWebhookPayload: vi.fn(),
  fetchEmailThread: vi.fn(),
  fetchCalendarEvent: vi.fn(),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  orgNylasConnections: {},
  communications: {},
  emailThreads: {},
  calendarEvents: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/queues', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
}));

import { verifyNylasWebhookSignature, parseNylasWebhookPayload } from '@cema/integrations-nylas';

const SECRET = 'test-secret';

function makeRequest(body: string, sig: string) {
  return new Request('https://example.com/api/webhooks/nylas', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nylas-signature': sig,
    },
    body,
  });
}

describe('POST /api/webhooks/nylas', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns 401 when signature verification fails', async () => {
    vi.mocked(verifyNylasWebhookSignature).mockReturnValue(false);
    process.env.NYLAS_WEBHOOK_SECRET = SECRET;

    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'bad-sig'));
    expect(res.status).toBe(401);
  });

  it('returns 200 for an unrecognized trigger type', async () => {
    vi.mocked(verifyNylasWebhookSignature).mockReturnValue(true);
    vi.mocked(parseNylasWebhookPayload).mockReturnValue({
      trigger: 'grant.expired',
      grantId: 'g1',
      objectData: {},
    });

    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'valid-sig'));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter apps/web test lib/actions apps/web/app/api/webhooks/nylas
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement route.ts**

```typescript
// apps/web/app/api/webhooks/nylas/route.ts
import {
  verifyNylasWebhookSignature,
  parseNylasWebhookPayload,
  fetchEmailThread,
  fetchCalendarEvent,
  getNylasClient,
} from '@cema/integrations-nylas';
import { getDb, orgNylasConnections, communications, emailThreads, calendarEvents } from '@cema/db';
import { publish } from '@cema/queues';
import { eq } from 'drizzle-orm';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.NYLAS_WEBHOOK_SECRET ?? '';
  const sig = req.headers.get('x-nylas-signature') ?? '';
  const rawBody = await req.text();

  if (!verifyNylasWebhookSignature(secret, sig, rawBody)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const event = parseNylasWebhookPayload(rawBody);

  // Resolve org from grant_id using neondb_owner (BYPASSRLS=true).
  // Webhook routes have no user session; signature verification is the gate.
  const db = getDb();
  const [conn] = await db
    .select({ organizationId: orgNylasConnections.organizationId })
    .from(orgNylasConnections)
    .where(eq(orgNylasConnections.nylasGrantId, event.grantId))
    .limit(1);

  if (!conn) {
    // Unknown grant — not one of our connections. Return 200 to stop retries.
    return new Response('OK', { status: 200 });
  }

  const orgId = conn.organizationId;
  const apiKey = process.env.NYLAS_API_KEY ?? '';
  const nylasClient = getNylasClient(apiKey);

  if (event.trigger === 'message.created') {
    const { threadId } = event.objectData as { threadId: string };
    const thread = await fetchEmailThread(nylasClient, event.grantId, threadId);

    const [comm] = await db
      .insert(communications)
      .values({
        organizationId: orgId,
        kind: 'email',
        direction: 'inbound',
        medium: await resolveMedium(db, event.grantId),
        sourceThreadId: thread.nylasThreadId,
        fromE164: null,
        toE164: null,
        startedAt: thread.firstMessageAt,
        status: 'ready',
      })
      .onConflictDoUpdate({
        target: [communications.sourceThreadId],
        set: { status: 'ready', updatedAt: new Date() },
      })
      .returning();

    if (comm) {
      await db
        .insert(emailThreads)
        .values({
          communicationId: comm.id,
          nylasThreadId: thread.nylasThreadId,
          nylasGrantId: thread.nylasGrantId,
          subject: thread.subject,
          snippet: thread.snippet,
          fromEmail: thread.fromEmail,
          fromName: thread.fromName,
          toParticipants: thread.toParticipants,
          ccParticipants: thread.ccParticipants,
          bodyHtml: thread.bodyHtml,
          bodyPlain: thread.bodyPlain,
          messageCount: thread.messageCount,
          hasAttachments: thread.hasAttachments,
          nylasAttachmentIds: thread.nylasAttachmentIds,
          firstMessageAt: thread.firstMessageAt,
          lastMessageAt: thread.lastMessageAt,
        })
        .onConflictDoUpdate({
          target: [emailThreads.communicationId],
          set: {
            messageCount: thread.messageCount,
            snippet: thread.snippet,
            lastMessageAt: thread.lastMessageAt,
            hasAttachments: thread.hasAttachments,
            nylasAttachmentIds: thread.nylasAttachmentIds,
            updatedAt: new Date(),
          },
        });

      await publish(process.env.VERCEL_QUEUE_EMAIL_TOPIC ?? 'comms.email.ingest', {
        communicationId: comm.id,
        organizationId: orgId,
      });
    }
  } else if (event.trigger === 'event.created' || event.trigger === 'event.updated') {
    const { calendarId, id: eventId } = event.objectData as { calendarId: string; id: string };
    const calEvent = await fetchCalendarEvent(nylasClient, event.grantId, calendarId, eventId);

    const [comm] = await db
      .insert(communications)
      .values({
        organizationId: orgId,
        kind: 'meeting',
        direction: 'inbound',
        medium: await resolveMedium(db, event.grantId),
        sourceThreadId: calEvent.nylasEventId,
        fromE164: null,
        toE164: null,
        startedAt: calEvent.startsAt,
        endedAt: calEvent.endsAt,
        status: 'ready',
      })
      .onConflictDoUpdate({
        target: [communications.sourceThreadId],
        set: { status: 'ready', updatedAt: new Date() },
      })
      .returning();

    if (comm) {
      await db
        .insert(calendarEvents)
        .values({
          communicationId: comm.id,
          nylasEventId: calEvent.nylasEventId,
          nylasCalendarId: calEvent.nylasCalendarId,
          nylasGrantId: calEvent.nylasGrantId,
          title: calEvent.title,
          description: calEvent.description,
          location: calEvent.location,
          eventStatus: calEvent.eventStatus,
          startsAt: calEvent.startsAt,
          endsAt: calEvent.endsAt,
          isAllDay: calEvent.isAllDay,
          organizerEmail: calEvent.organizerEmail,
          organizerName: calEvent.organizerName,
          attendees: calEvent.attendees,
        })
        .onConflictDoUpdate({
          target: [calendarEvents.communicationId],
          set: {
            eventStatus: calEvent.eventStatus,
            title: calEvent.title,
            startsAt: calEvent.startsAt,
            endsAt: calEvent.endsAt,
            attendees: calEvent.attendees,
            updatedAt: new Date(),
          },
        });
    }
  }

  return new Response('OK', { status: 200 });
}

async function resolveMedium(
  db: ReturnType<typeof getDb>,
  grantId: string,
): Promise<'gmail' | 'm365'> {
  const [conn] = await db
    .select({ providerType: orgNylasConnections.providerType })
    .from(orgNylasConnections)
    .where(eq(orgNylasConnections.nylasGrantId, grantId))
    .limit(1);
  return (conn?.providerType as 'gmail' | 'm365') ?? 'gmail';
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter apps/web test
```

Expected: PASS — 2 new route tests green.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add apps/web/app/api/webhooks/nylas/
git commit -m "feat(webhooks): Nylas email + calendar webhook handler (M3 task 8)"
```

---

### Task 9: Server actions — list-emails + get-email

**Files:**

- Create: `apps/web/lib/actions/list-emails.ts` + `list-emails.test.ts`
- Create: `apps/web/lib/actions/get-email.ts` + `get-email.test.ts`

- [ ] **Step 1: Write list-emails.test.ts**

```typescript
// apps/web/lib/actions/list-emails.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));
vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  communications: {},
  emailThreads: {},
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
}));
vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';
import { withRls } from '../with-rls';
import { listEmails } from './list-emails';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };
const DEAL_ID = 'deal-uuid-1';

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue({
    query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
  } as unknown as ReturnType<typeof getDb>);
});
afterEach(() => vi.clearAllMocks());

describe('listEmails', () => {
  it('returns empty array when org not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as unknown as ReturnType<typeof getDb>);
    expect(await listEmails(DEAL_ID)).toEqual([]);
  });

  it('returns rows from withRls query', async () => {
    const rows = [{ id: 'comm-1', kind: 'email', emailThread: { subject: 'Test' } }];
    vi.mocked(withRls).mockImplementationOnce((_id, fn) =>
      fn({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(rows) }),
            }),
          }),
        }),
      } as never),
    );
    const result = await listEmails(DEAL_ID);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('email');
  });
});
```

- [ ] **Step 2: Run — verify fails; implement list-emails.ts**

```typescript
// apps/web/lib/actions/list-emails.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { communications, emailThreads, getDb, organizations } from '@cema/db';
import { and, desc, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export async function listEmails(dealId: string) {
  const db = getDb();
  const clerkOrgId = await getCurrentOrganizationId();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, (tx) =>
    tx
      .select()
      .from(communications)
      .leftJoin(emailThreads, eq(emailThreads.communicationId, communications.id))
      .where(and(eq(communications.dealId, dealId), eq(communications.kind, 'email')))
      .orderBy(desc(communications.startedAt)),
  );
}
```

- [ ] **Step 3: Write get-email.test.ts**

```typescript
// apps/web/lib/actions/get-email.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));
vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  communications: {},
  emailThreads: {},
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}));
vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';
import { withRls } from '../with-rls';
import { getEmail } from './get-email';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };
const DEAL_ID = 'deal-uuid-1';
const COMM_ID = 'comm-uuid-1';

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue({
    query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
  } as unknown as ReturnType<typeof getDb>);
});
afterEach(() => vi.clearAllMocks());

describe('getEmail', () => {
  it('returns null when org not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as unknown as ReturnType<typeof getDb>);
    expect(await getEmail(DEAL_ID, COMM_ID)).toBeNull();
  });

  it('returns null when communication not found', async () => {
    vi.mocked(withRls).mockImplementationOnce((_id, fn) =>
      fn({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
            }),
          }),
        }),
      } as never),
    );
    expect(await getEmail(DEAL_ID, COMM_ID)).toBeNull();
  });

  it('returns communication + emailThread on happy path', async () => {
    const row = {
      communications: { id: COMM_ID, kind: 'email' },
      email_threads: { subject: 'Test' },
    };
    vi.mocked(withRls).mockImplementationOnce((_id, fn) =>
      fn({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([row]) }),
            }),
          }),
        }),
      } as never),
    );
    const result = await getEmail(DEAL_ID, COMM_ID);
    expect(result).not.toBeNull();
    expect(result?.communication.id).toBe(COMM_ID);
  });
});
```

- [ ] **Step 4: Run — verify fails; implement get-email.ts**

```typescript
// apps/web/lib/actions/get-email.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { communications, emailThreads, getDb, organizations } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export async function getEmail(dealId: string, communicationId: string) {
  const db = getDb();
  const clerkOrgId = await getCurrentOrganizationId();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return null;

  const rows = await withRls(org.id, (tx) =>
    tx
      .select()
      .from(communications)
      .leftJoin(emailThreads, eq(emailThreads.communicationId, communications.id))
      .where(and(eq(communications.id, communicationId), eq(communications.dealId, dealId)))
      .limit(1),
  );

  const row = rows[0];
  if (!row) return null;

  return {
    communication: row.communications,
    emailThread: row.email_threads ?? null,
  };
}
```

- [ ] **Step 5: Run all tests — verify pass**

```bash
pnpm --filter apps/web test
```

Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add apps/web/lib/actions/list-emails.ts apps/web/lib/actions/list-emails.test.ts apps/web/lib/actions/get-email.ts apps/web/lib/actions/get-email.test.ts
git commit -m "feat(actions): list-emails + get-email server actions (M3 task 9)"
```

---

### Task 10: Server actions — list-calendar-events + get-calendar-event

**Files:**

- Create: `apps/web/lib/actions/list-calendar-events.ts` + test
- Create: `apps/web/lib/actions/get-calendar-event.ts` + test

Follow the identical pattern from Task 9. Replace `emailThreads` with `calendarEvents`, `kind='email'` with `kind='meeting'`.

- [ ] **Step 1: Write list-calendar-events.test.ts** (mirror list-emails.test.ts; change kind to 'meeting')

- [ ] **Step 2: Run — fail; implement list-calendar-events.ts**

```typescript
// apps/web/lib/actions/list-calendar-events.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { calendarEvents, communications, getDb, organizations } from '@cema/db';
import { and, desc, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export async function listCalendarEvents(dealId: string) {
  const db = getDb();
  const clerkOrgId = await getCurrentOrganizationId();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  return withRls(org.id, (tx) =>
    tx
      .select()
      .from(communications)
      .leftJoin(calendarEvents, eq(calendarEvents.communicationId, communications.id))
      .where(and(eq(communications.dealId, dealId), eq(communications.kind, 'meeting')))
      .orderBy(desc(communications.startedAt)),
  );
}
```

- [ ] **Step 3: Write get-calendar-event.test.ts** (mirror get-email.test.ts; change to calendarEvents)

- [ ] **Step 4: Run — fail; implement get-calendar-event.ts**

```typescript
// apps/web/lib/actions/get-calendar-event.ts
import { getCurrentOrganizationId } from '@cema/auth';
import { calendarEvents, communications, getDb, organizations } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export async function getCalendarEvent(dealId: string, communicationId: string) {
  const db = getDb();
  const clerkOrgId = await getCurrentOrganizationId();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return null;

  const rows = await withRls(org.id, (tx) =>
    tx
      .select()
      .from(communications)
      .leftJoin(calendarEvents, eq(calendarEvents.communicationId, communications.id))
      .where(and(eq(communications.id, communicationId), eq(communications.dealId, dealId)))
      .limit(1),
  );

  const row = rows[0];
  if (!row) return null;

  return {
    communication: row.communications,
    calendarEvent: row.calendar_events ?? null,
  };
}
```

- [ ] **Step 5: Run all tests + typecheck + commit**

```bash
pnpm --filter apps/web test
pnpm typecheck
git add apps/web/lib/actions/list-calendar-events.ts apps/web/lib/actions/list-calendar-events.test.ts apps/web/lib/actions/get-calendar-event.ts apps/web/lib/actions/get-calendar-event.test.ts
git commit -m "feat(actions): list-calendar-events + get-calendar-event (M3 task 10)"
```

---

### Task 11: UI components — EmailThreadCard + EmailThreadViewer

**Files:**

- Create: `apps/web/components/email-thread-card.tsx`
- Create: `apps/web/components/email-thread-viewer.tsx`

- [ ] **Step 1: Create EmailThreadCard**

```tsx
// apps/web/components/email-thread-card.tsx
import type { Communication, EmailThread } from '@cema/db';
import { Badge } from '@cema/ui';
import Link from 'next/link';

interface EmailThreadCardProps {
  communication: Communication;
  emailThread: EmailThread | null;
  dealId: string;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function EmailThreadCard({ communication, emailThread, dealId }: EmailThreadCardProps) {
  return (
    <Link
      href={`/deals/${dealId}/communications/${communication.id}`}
      className="hover:bg-muted/50 block rounded-lg border p-4 transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">✉</span>
            <p className="truncate text-sm font-medium">{emailThread?.subject ?? '(no subject)'}</p>
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {emailThread?.fromEmail ?? '—'}
          </p>
          {emailThread?.snippet && (
            <p className="text-muted-foreground mt-1 truncate text-xs">{emailThread.snippet}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="text-muted-foreground text-xs">{formatDate(communication.startedAt)}</p>
          <Badge variant="outline" className="text-xs capitalize">
            {communication.medium}
          </Badge>
          {emailThread?.hasAttachments && (
            <span className="text-muted-foreground text-xs">
              📎 {emailThread.nylasAttachmentIds?.length}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Create EmailThreadViewer**

```tsx
// apps/web/components/email-thread-viewer.tsx
import type { Communication, EmailThread } from '@cema/db';

interface EmailThreadViewerProps {
  communication: Communication;
  emailThread: EmailThread | null;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' }).format(date);
}

export function EmailThreadViewer({ communication, emailThread }: EmailThreadViewerProps) {
  if (!emailThread) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">Email content not yet available.</p>
      </div>
    );
  }

  const hasAttachments =
    emailThread.hasAttachments &&
    Array.isArray(emailThread.nylasAttachmentIds) &&
    (emailThread.nylasAttachmentIds as string[]).length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{emailThread.subject ?? '(no subject)'}</h2>
        <div className="text-muted-foreground mt-1 space-y-0.5 text-sm">
          <p>
            <span className="font-medium">From:</span>{' '}
            {emailThread.fromName
              ? `${emailThread.fromName} <${emailThread.fromEmail}>`
              : (emailThread.fromEmail ?? '—')}
          </p>
          <p>
            <span className="font-medium">Date:</span> {formatDate(communication.startedAt)}
          </p>
          {emailThread.messageCount > 1 && (
            <p>
              <span className="font-medium">Thread length:</span> {emailThread.messageCount}{' '}
              messages
            </p>
          )}
        </div>
      </div>

      {emailThread.bodyHtml ? (
        <div className="rounded-lg border">
          {/* Body is rendered inside an iframe to prevent CSS bleed and
              XSS from external HTML. The srcdoc attribute sandboxes the content. */}
          <iframe
            srcDoc={emailThread.bodyHtml}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            className="h-96 w-full rounded-lg"
            title="Email body"
          />
        </div>
      ) : emailThread.bodyPlain ? (
        <div className="rounded-lg border p-4">
          <pre className="text-muted-foreground whitespace-pre-wrap text-sm">
            {emailThread.bodyPlain}
          </pre>
        </div>
      ) : null}

      {hasAttachments && (
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium">
            Attachments ({(emailThread.nylasAttachmentIds as string[]).length})
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Attachment download links available in Phase 1 (IDP integration).
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add apps/web/components/email-thread-card.tsx apps/web/components/email-thread-viewer.tsx
git commit -m "feat(ui): EmailThreadCard + EmailThreadViewer components (M3 task 11)"
```

---

### Task 12: UI component — CalendarEventCard

**Files:**

- Create: `apps/web/components/calendar-event-card.tsx`

- [ ] **Step 1: Create CalendarEventCard**

```tsx
// apps/web/components/calendar-event-card.tsx
import type { CalendarEvent, Communication } from '@cema/db';
import { Badge } from '@cema/ui';
import Link from 'next/link';

interface CalendarEventCardProps {
  communication: Communication;
  calendarEvent: CalendarEvent | null;
  dealId: string;
}

function formatDateRange(start: Date | null | undefined, end: Date | null | undefined): string {
  if (!start) return '—';
  const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  if (!end) return fmt.format(start);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    const timeFmt = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' });
    return `${fmt.format(start)} – ${timeFmt.format(end)}`;
  }
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export function CalendarEventCard({
  communication,
  calendarEvent,
  dealId,
}: CalendarEventCardProps) {
  const statusColor =
    calendarEvent?.eventStatus === 'cancelled'
      ? 'destructive'
      : calendarEvent?.eventStatus === 'tentative'
        ? 'secondary'
        : 'outline';

  const attendeeCount = Array.isArray(calendarEvent?.attendees)
    ? (calendarEvent.attendees as unknown[]).length
    : 0;

  return (
    <Link
      href={`/deals/${dealId}/communications/${communication.id}`}
      className="hover:bg-muted/50 block rounded-lg border p-4 transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">📅</span>
            <p className="truncate text-sm font-medium">
              {calendarEvent?.title ?? '(untitled event)'}
            </p>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {formatDateRange(communication.startedAt, communication.endedAt)}
          </p>
          {calendarEvent?.location && (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              📍 {calendarEvent.location}
            </p>
          )}
          {attendeeCount > 0 && (
            <p className="text-muted-foreground mt-0.5 text-xs">{attendeeCount} attendees</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={statusColor} className="text-xs capitalize">
            {calendarEvent?.eventStatus ?? 'confirmed'}
          </Badge>
          <Badge variant="outline" className="text-xs capitalize">
            {communication.medium}
          </Badge>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add apps/web/components/calendar-event-card.tsx
git commit -m "feat(ui): CalendarEventCard component (M3 task 12)"
```

---

### Task 13: UI — extend deal communications page + detail page

**Files:**

- Modify: `apps/web/app/(app)/deals/[id]/communications/page.tsx`
- Modify: `apps/web/app/(app)/deals/[id]/communications/[c]/page.tsx`

- [ ] **Step 1: Read current communications page**

```bash
# Read apps/web/app/(app)/deals/[id]/communications/page.tsx
```

- [ ] **Step 2: Extend communications page**

The page currently calls `listCommunications` (calls only). Add parallel fetches for emails and calendar events, then render all three lists merged and sorted by `startedAt DESC`.

Replace the page body with:

```tsx
// apps/web/app/(app)/deals/[id]/communications/page.tsx
import { notFound } from 'next/navigation';
import { CommunicationCard } from '@/components/communication-card';
import { EmailThreadCard } from '@/components/email-thread-card';
import { CalendarEventCard } from '@/components/calendar-event-card';
import { listCommunications } from '@/lib/actions/list-communications';
import { listEmails } from '@/lib/actions/list-emails';
import { listCalendarEvents } from '@/lib/actions/list-calendar-events';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params;

  const [calls, emails, meetings] = await Promise.all([
    listCommunications(dealId),
    listEmails(dealId),
    listCalendarEvents(dealId),
  ]);

  // Merge all kinds into a unified timeline, sorted newest-first.
  const callItems = calls.map((c) => ({ kind: 'call' as const, startedAt: c.startedAt, call: c }));
  const emailItems = emails.map((r) => ({
    kind: 'email' as const,
    startedAt: r.communications.startedAt,
    communication: r.communications,
    emailThread: r.email_threads ?? null,
  }));
  const meetingItems = meetings.map((r) => ({
    kind: 'meeting' as const,
    startedAt: r.communications.startedAt,
    communication: r.communications,
    calendarEvent: r.calendar_events ?? null,
  }));

  const allItems = [...callItems, ...emailItems, ...meetingItems].sort((a, b) => {
    const aTime = a.startedAt?.getTime() ?? 0;
    const bTime = b.startedAt?.getTime() ?? 0;
    return bTime - aTime;
  });

  if (allItems.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-muted-foreground text-sm font-medium">No communications yet</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Calls, emails, and meetings linked to this deal will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {allItems.map((item) => {
        if (item.kind === 'call') {
          return <CommunicationCard key={item.call.id} communication={item.call} dealId={dealId} />;
        }
        if (item.kind === 'email') {
          return (
            <EmailThreadCard
              key={item.communication.id}
              communication={item.communication}
              emailThread={item.emailThread}
              dealId={dealId}
            />
          );
        }
        return (
          <CalendarEventCard
            key={item.communication.id}
            communication={item.communication}
            calendarEvent={item.calendarEvent}
            dealId={dealId}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Extend communications detail page**

The `[c]/page.tsx` currently handles `kind='call'`. Add routing for `kind='email'` and `kind='meeting'`:

After fetching `data = await getCommunication(dealId, communicationId)`, add:

```tsx
// If kind is email, fetch the email thread and render EmailThreadViewer.
// If kind is meeting, fetch calendar event and render CalendarEventCard detail.
// Fall back to existing call rendering.

// Add these imports at top of [c]/page.tsx:
import { EmailThreadViewer } from '@/components/email-thread-viewer';
import { CalendarEventCard } from '@/components/calendar-event-card';
import { getEmail } from '@/lib/actions/get-email';
import { getCalendarEvent } from '@/lib/actions/get-calendar-event';
```

In the page function body, after fetching `data`:

```tsx
// After: if (!data) notFound();
const { communication: comm } = data;

if (comm.kind === 'email') {
  const emailData = await getEmail(dealId, communicationId);
  if (!emailData) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Email Thread</h1>
        <p className="text-muted-foreground mt-1 text-sm">{formatDate(comm.startedAt)}</p>
      </div>
      <EmailThreadViewer
        communication={emailData.communication}
        emailThread={emailData.emailThread}
      />
    </div>
  );
}

if (comm.kind === 'meeting') {
  const eventData = await getCalendarEvent(dealId, communicationId);
  if (!eventData) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {eventData.calendarEvent?.title ?? 'Calendar Event'}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{formatDate(comm.startedAt)}</p>
      </div>
      <CalendarEventCard
        communication={eventData.communication}
        calendarEvent={eventData.calendarEvent}
        dealId={dealId}
      />
    </div>
  );
}
// existing call rendering continues below...
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck
pnpm --filter apps/web test
git add apps/web/app/\(app\)/deals/
git commit -m "feat(ui): extend communications timeline + detail to email/calendar (M3 task 13)"
```

---

### Task 14: Integration test — RLS isolation for M3 tables

**Files:**

- Create: `apps/web/tests/integration/email-calendar-rls.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/tests/integration/email-calendar-rls.test.ts
/**
 * RLS multi-tenant isolation — org_nylas_connections, email_threads, calendar_events (M3 Task 14).
 *
 * Proves that migration 0016_rls_email_calendar.sql correctly isolates rows
 * across organizations. Two policy shapes:
 *   • org_nylas_connections — direct organization_id equality
 *   • email_threads / calendar_events — EXISTS via communications (same as recordings)
 */

import {
  calendarEvents,
  communications,
  emailThreads,
  getDb,
  orgNylasConnections,
  organizations,
  users,
} from '@cema/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

const ORG_A_ID = '00000000-0000-0000-0000-0000000000a3';
const ORG_B_ID = '00000000-0000-0000-0000-0000000000b3';
const USER_ID = '00000000-0000-0000-0000-000000000093';
const GRANT_ID_A = 'nylas-grant-test-org-a';

const skip = !process.env.DATABASE_URL;

let connAId: string;
let commEmailId: string;
let commMeetingId: string;
let threadAId: string;
let eventAId: string;

describe.skipIf(skip)('RLS — org_nylas_connections + email_threads + calendar_events', () => {
  beforeAll(async () => {
    const db = getDb();

    await db
      .insert(organizations)
      .values([
        {
          id: ORG_A_ID,
          clerkOrgId: 'org_email_rls_test_a',
          name: 'Org A (Email RLS)',
          slug: 'email-rls-org-a',
        },
        {
          id: ORG_B_ID,
          clerkOrgId: 'org_email_rls_test_b',
          name: 'Org B (Email RLS)',
          slug: 'email-rls-org-b',
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_email_rls_test',
        email: 'email-rls@example.invalid',
      })
      .onConflictDoNothing();

    const [connA] = await db
      .insert(orgNylasConnections)
      .values({
        organizationId: ORG_A_ID,
        providerType: 'gmail',
        nylasGrantId: GRANT_ID_A,
        emailAddress: 'test@org-a.example.invalid',
        connectionStatus: 'active',
        createdById: USER_ID,
      })
      .returning();
    connAId = connA!.id;

    const [commEmail] = await db
      .insert(communications)
      .values({
        organizationId: ORG_A_ID,
        kind: 'email',
        direction: 'inbound',
        medium: 'gmail',
        status: 'ready',
      })
      .returning();
    commEmailId = commEmail!.id;

    const [thread] = await db
      .insert(emailThreads)
      .values({
        communicationId: commEmailId,
        nylasThreadId: 'thread-rls-test-001',
        nylasGrantId: GRANT_ID_A,
        subject: 'RLS test email',
        toParticipants: [],
        ccParticipants: [],
        nylasAttachmentIds: [],
        messageCount: 1,
        hasAttachments: false,
      })
      .returning();
    threadAId = thread!.id;

    const [commMeeting] = await db
      .insert(communications)
      .values({
        organizationId: ORG_A_ID,
        kind: 'meeting',
        direction: 'inbound',
        medium: 'gmail',
        status: 'ready',
      })
      .returning();
    commMeetingId = commMeeting!.id;

    const [evt] = await db
      .insert(calendarEvents)
      .values({
        communicationId: commMeetingId,
        nylasEventId: 'event-rls-test-001',
        nylasCalendarId: 'cal-test-001',
        nylasGrantId: GRANT_ID_A,
        eventStatus: 'confirmed',
        isAllDay: false,
        attendees: [],
      })
      .returning();
    eventAId = evt!.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, eventAId));
    await db.delete(emailThreads).where(eq(emailThreads.id, threadAId));
    await db
      .delete(communications)
      .where(inArray(communications.organizationId, [ORG_A_ID, ORG_B_ID]));
    await db.delete(orgNylasConnections).where(eq(orgNylasConnections.id, connAId));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_A_ID, ORG_B_ID]));
    await db.delete(users).where(eq(users.id, USER_ID));
  });

  it('Org B cannot SELECT Org A nylas connections via withRls', async () => {
    const visible = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: orgNylasConnections.id })
        .from(orgNylasConnections)
        .where(eq(orgNylasConnections.id, connAId)),
    );
    expect(visible).toHaveLength(0);
  });

  it('Org A sees its own nylas connections via withRls', async () => {
    const visible = await withRls(ORG_A_ID, (tx) =>
      tx
        .select({ id: orgNylasConnections.id })
        .from(orgNylasConnections)
        .where(eq(orgNylasConnections.id, connAId)),
    );
    expect(visible).toHaveLength(1);
  });

  it('Org B cannot SELECT Org A email_threads via withRls (EXISTS-join policy)', async () => {
    const visible = await withRls(ORG_B_ID, (tx) =>
      tx.select({ id: emailThreads.id }).from(emailThreads).where(eq(emailThreads.id, threadAId)),
    );
    expect(visible).toHaveLength(0);
  });

  it('Org A sees its own email_threads via withRls', async () => {
    const visible = await withRls(ORG_A_ID, (tx) =>
      tx.select({ id: emailThreads.id }).from(emailThreads).where(eq(emailThreads.id, threadAId)),
    );
    expect(visible).toHaveLength(1);
  });

  it('Org B cannot SELECT Org A calendar_events via withRls (EXISTS-join policy)', async () => {
    const visible = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: calendarEvents.id })
        .from(calendarEvents)
        .where(eq(calendarEvents.id, eventAId)),
    );
    expect(visible).toHaveLength(0);
  });

  it('Org A sees its own calendar_events via withRls', async () => {
    const visible = await withRls(ORG_A_ID, (tx) =>
      tx
        .select({ id: calendarEvents.id })
        .from(calendarEvents)
        .where(eq(calendarEvents.id, eventAId)),
    );
    expect(visible).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run against live Neon dev branch — verify all 6 pass**

```bash
pnpm --filter apps/web test tests/integration/email-calendar-rls.test.ts
```

Expected: PASS — 6 assertions green (or SKIP if `DATABASE_URL` not set in this environment).

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/integration/email-calendar-rls.test.ts
git commit -m "test(integration): cross-org RLS isolation for M3 email/calendar tables (M3 task 14)"
```

---

### Task 15: .env.example + add @cema/integrations-nylas to apps/web

**Files:**

- Modify: `.env.example`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add Nylas env vars to .env.example**

Append to `.env.example`:

```
# Nylas (email + calendar — M3)
NYLAS_API_KEY=...
NYLAS_WEBHOOK_SECRET=...
NYLAS_API_URI=https://api.us.nylas.com

# Vercel Queues (M3 email ingest topic)
VERCEL_QUEUE_EMAIL_TOPIC=comms.email.ingest
```

- [ ] **Step 2: Add @cema/integrations-nylas as dependency to apps/web**

```bash
pnpm --filter apps/web add @cema/integrations-nylas@workspace:*
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add .env.example apps/web/package.json pnpm-lock.yaml
git commit -m "chore: add Nylas env vars to .env.example + wire workspace dep (M3 task 15)"
```

---

### Task 16: Full test + lint + typecheck gate

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: All tests pass. Note new count in output.

- [ ] **Step 2: Run typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Run build**

```bash
pnpm build
```

Expected: All packages build successfully.

- [ ] **Step 4: Commit if any lint/format fixes were applied by pre-commit hooks**

```bash
git add -A
git status  # verify only formatted files; no secrets
git commit -m "chore: lint + format fixes (M3 task 16)" --allow-empty
```

---

### Task 17: ADR 0003 + CLAUDE.md M3 close-out

**Files:**

- Create: `docs/adr/0003-phase-0-month-3-email-calendar.md`
- Modify: `CLAUDE.md` §2

- [ ] **Step 1: Write ADR 0003**

Document:

- What shipped: 3 DB tables (0013–0016), `@cema/integrations-nylas` package, webhook route, 4 server actions, 3 UI components, 1 integration test file, 6 assertions.
- Skipped tasks: 8 (Nylas app registration, Google/Microsoft OAuth apps, Nango config, Reducto IDP, Cal.com, NeverBounce, WDK workflow, production smoke test).
- Architectural decisions: (1) inline upsert vs. WDK workflow for email body; (2) iframe sandboxing for email body HTML; (3) Nylas attachment IDs stored vs. blob download deferred to Phase 1 IDP; (4) EXISTS-via-communications RLS for email_threads + calendar_events; (5) resolveMedium() helper to determine gmail vs m365 from grant.
- Carry-overs to M4.

- [ ] **Step 2: Update CLAUDE.md §2**

Change the Phase bullet to:

```
**Phase:** Phase 0 Month 3 fully closed out (YYYY-MM-DD); Phase 0 Month 4 (internal messaging + files: Slack, Teams, Drive, OneDrive, Box, DocuSign, contact graph) is next.
```

Add M3 carry-overs to M4:

1. Nylas app registration + Google/Microsoft OAuth app setup (required before real email/calendar data can flow)
2. Nango provider config for Nylas connections
3. `/settings/integrations/email-calendar` UI (depends on Nango OAuth)
4. Reducto IDP for email attachment classification (Phase 1)
5. Cal.com scheduling links (account setup required)
6. WDK workflow for async email enrichment (AI summary, Phase 1)
7. NeverBounce outbound email verification (Phase 1)
8. Communication ↔ Party resolution via Apache AGE (M5+)

Update Changelog entry.

- [ ] **Step 3: Commit + push + PR**

Use `commit-commands:commit-push-pr` skill.

---

## 7. Skipped tasks (per active session rule)

The following require external system registration or API credentials not yet provisioned:

| Task | Scope                                                         | Reason skipped                                  |
| ---- | ------------------------------------------------------------- | ----------------------------------------------- |
| A    | Nylas app creation + Google Cloud OAuth app + Azure Entra app | External vendor portals                         |
| B    | Nango provider config for Nylas                               | Depends on Task A                               |
| C    | `/settings/integrations/email-calendar` UI                    | Depends on Nango OAuth (same gap as M2 Task 22) |
| D    | Reducto IDP for email attachment classification               | Requires Reducto account                        |
| E    | Cal.com scheduling links                                      | Requires Cal.com account                        |
| F    | NeverBounce outbound email verification                       | Requires NeverBounce account                    |
| G    | WDK workflow for async email enrichment                       | `@vercel/workflow` not installed                |
| H    | Vercel env var provisioning + production smoke test           | Requires real `NYLAS_API_KEY`                   |

---

## 8. Open Questions

Carried forward from M2 plan §9:

1. **M3 open question 1:** When a processor connects their personal Gmail (not a workspace account), what Nylas auth flow applies? (Nylas has separate handling for consumer vs. workspace accounts.)
2. **M3 open question 2:** Should email threads linked to a Deal be surfaced to the attorney portal (for review of servicer correspondence)? If so, does attorney review gate apply?
3. **M3 open question 3:** Attachment IDP (Reducto) — should attachments auto-create `documents` rows (kind-classified by IDP) or remain as blob references on `email_threads`? Architecture decision required before Phase 1 IDP agent is designed.
4. **M3 open question 4:** Calendar events are currently inbound (Nylas pushes them). What is the flow for creating outbound calendar invites (e.g., scheduling a closing date review with the attorney)? Cal.com or direct Nylas API write?
