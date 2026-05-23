# Phase 0 Month 7 — Production Pipeline + Entity Resolution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the M6 embedding pipeline end-to-end by (1) publishing embed topics from webhook handlers on every new communication insert, (2) syncing embeddings to Typesense after every embed consumer run, (3) writing `fromPartyId`/`toPartyIds` via `contact_identities` entity resolution, (4) adding a daily backfill cron so existing rows get embedded, and (5) producing an env-var provisioning runbook for Typesense Cloud + Mem0.

**Architecture:** Webhook handlers → `comms.embed` / `docs.embed` topics → embed consumer routes (embed + Typesense sync + entity resolution) → Postgres + Typesense. A nightly Vercel Cron backfills any rows that missed the real-time path. Entity resolution is best-effort (fire-and-forget inside the embed consumer) — it matches `emailThreads.fromEmail` / `toParticipants` against `contact_identities(kind='email')` and walks `kg_edges(predicate='contact_is_party')` to populate `communications.fromPartyId` / `toPartyIds`.

**Tech Stack:** Next.js 14 App Router queue routes, Vercel Cron, `@cema/typesense` (`indexCommunication`, `indexDocument`), `@cema/db` (`emailThreads`, `slackMessages`, `contactIdentities`, `kgEdges`), Drizzle ORM, Vitest.

---

## File Map

| Action | Path                                                        | Responsibility                                          |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------- |
| Modify | `apps/web/app/api/webhooks/nylas/route.ts`                  | Publish `comms.embed` after email + meeting comm insert |
| Modify | `apps/web/app/api/webhooks/nylas/route.test.ts`             | Assert `comms.embed` publish for email + meeting        |
| Modify | `apps/web/app/api/webhooks/slack/route.ts`                  | Publish `comms.embed` after slack comm insert           |
| Modify | `apps/web/app/api/webhooks/slack/route.test.ts`             | Assert `comms.embed` publish for slack message          |
| Modify | `apps/web/app/api/queues/embed-communication/route.ts`      | Typesense sync + entity resolution after embedding      |
| Modify | `apps/web/app/api/queues/embed-communication/route.test.ts` | Assert `indexCommunication` + party resolution calls    |
| Modify | `apps/web/app/api/queues/embed-document/route.ts`           | Typesense sync after embedding                          |
| Modify | `apps/web/app/api/queues/embed-document/route.test.ts`      | Assert `indexDocument` call                             |
| Create | `apps/web/app/api/cron/backfill-embeddings/route.ts`        | Nightly backfill — publish embed topics for null rows   |
| Create | `apps/web/app/api/cron/backfill-embeddings/route.test.ts`   | Unit tests for backfill handler                         |
| Modify | `apps/web/vercel.json`                                      | Add cron job config                                     |
| Create | `docs/runbooks/m7-env-var-provisioning.md`                  | Typesense Cloud + Mem0 provisioning steps               |

---

## Task 1: Publish `comms.embed` from the Nylas webhook handler

**Files:**

- Modify: `apps/web/app/api/webhooks/nylas/route.ts`
- Modify: `apps/web/app/api/webhooks/nylas/route.test.ts`

- [ ] **Step 1: Write the failing test — email path publishes `comms.embed`**

Read the existing test file first to understand the mock structure, then add this test at the bottom of the `describe` block:

```typescript
// In apps/web/app/api/webhooks/nylas/route.test.ts
// Add mock at the top (alongside existing mocks):
vi.mock('@cema/queues', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
  TopicSchema: {
    'comms.email.ingest': { parse: (v: unknown) => v },
    'comms.embed': { parse: (v: unknown) => v },
  },
}));

// Add test:
it('publishes comms.embed after email communication insert', async () => {
  const { publish } = await import('@cema/queues');
  vi.mocked(publish).mockResolvedValue(undefined);
  // ... set up DB mocks to return a comm row ...

  // call POST with message.created trigger
  // assert publish was called with 'comms.embed'
  expect(vi.mocked(publish)).toHaveBeenCalledWith(
    'comms.embed',
    expect.objectContaining({ orgId: expect.any(String), communicationId: expect.any(String) }),
    expect.any(Function),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test --filter=web -- --reporter=verbose embed-communication
```

Expected: FAIL — `publish` not called with `'comms.embed'`

- [ ] **Step 3: Add `comms.embed` publish to the email path in `nylas/route.ts`**

In `apps/web/app/api/webhooks/nylas/route.ts`, inside the `if (comm)` block for the `message.created` branch, add the `comms.embed` publish **after** the existing `comms.email.ingest` publish (around line 119):

```typescript
// After the comms.email.ingest publish block:
await publish('comms.embed', { orgId, communicationId: comm.id }, vercelQueueSend);
```

- [ ] **Step 4: Add `comms.embed` publish to the calendar event path**

In the same file, inside the `if (comm)` block for the `event.created`/`event.updated` branch, add after the `calendarEvents` upsert (around line 188):

```typescript
await publish('comms.embed', { orgId, communicationId: comm.id }, vercelQueueSend);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test --filter=web -- --reporter=verbose webhooks/nylas
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/webhooks/nylas/route.ts apps/web/app/api/webhooks/nylas/route.test.ts
git commit -m "feat(webhooks): publish comms.embed from Nylas email + meeting inserts (M7 task 1)"
```

---

## Task 2: Publish `comms.embed` from the Slack webhook handler

**Files:**

- Modify: `apps/web/app/api/webhooks/slack/route.ts`
- Modify: `apps/web/app/api/webhooks/slack/route.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/web/app/api/webhooks/slack/route.test.ts`, add a test that verifies `publish` is called with `'comms.embed'` after a message event:

```typescript
it('publishes comms.embed after slack communication insert', async () => {
  // existing mock setup for DB returning a comm row...
  const { publish } = await import('@cema/queues');

  await POST(makeMessageRequest(/* ... */));

  expect(vi.mocked(publish)).toHaveBeenCalledWith(
    'comms.embed',
    expect.objectContaining({ orgId: 'org-1', communicationId: expect.any(String) }),
    expect.any(Function),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test --filter=web -- --reporter=verbose webhooks/slack
```

Expected: FAIL — `publish` not called with `'comms.embed'`

- [ ] **Step 3: Add `comms.embed` publish to `slack/route.ts`**

In `apps/web/app/api/webhooks/slack/route.ts`, after the existing `publish('comms.slack.ingest', ...)` call (around line 134), add:

```typescript
await publish('comms.embed', { orgId, communicationId: comm.id }, vercelQueueSend);
```

- [ ] **Step 4: Run tests**

```bash
pnpm test --filter=web -- --reporter=verbose webhooks/slack
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/webhooks/slack/route.ts apps/web/app/api/webhooks/slack/route.test.ts
git commit -m "feat(webhooks): publish comms.embed from Slack message insert (M7 task 2)"
```

---

## Task 3: Typesense sync in `embed-communication` consumer

**Files:**

- Modify: `apps/web/app/api/queues/embed-communication/route.ts`
- Modify: `apps/web/app/api/queues/embed-communication/route.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/web/app/api/queues/embed-communication/route.test.ts`, add at the top:

```typescript
vi.mock('@cema/typesense', () => ({
  indexCommunication: vi.fn().mockResolvedValue(undefined),
  isTypesenseConfigured: vi.fn().mockReturnValue(true),
}));
```

Add this test to the describe block:

```typescript
it('calls indexCommunication after writing embedding', async () => {
  const { indexCommunication } = await import('@cema/typesense');
  vi.mocked(getDb).mockReturnValue(
    buildDb({
      selectResult: [COMM],
      // select for emailThreads returns empty (no thread)
    }) as never,
  );
  vi.mocked(embedText).mockResolvedValueOnce({
    embedding: [0.1, 0.2],
    dimensions: 2,
    model: 'text-embedding-3-large',
    inputTokens: 5,
  });

  const res = await POST(makeRequest({ orgId: 'org-1', communicationId: 'comm-1' }));
  expect(res.status).toBe(200);
  expect(indexCommunication).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'comm-1', organization_id: 'org-1', kind: 'email' }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test --filter=web -- --reporter=verbose embed-communication
```

Expected: FAIL — `indexCommunication` not called

- [ ] **Step 3: Update `embed-communication/route.ts` to import Typesense and fetch thread data**

Replace the entire file with:

```typescript
import { communications, emailThreads, getDb, slackMessages } from '@cema/db';
import { embedText } from '@cema/embeddings';
import { TopicSchema } from '@cema/queues';
import { indexCommunication } from '@cema/typesense';
import { eq } from 'drizzle-orm';

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as unknown;
  const { orgId, communicationId } = TopicSchema['comms.embed'].parse(body);

  const db = getDb();
  const [comm] = await db
    .select()
    .from(communications)
    .where(eq(communications.id, communicationId))
    .limit(1);

  if (!comm || comm.organizationId !== orgId) {
    return new Response('Not found', { status: 404 });
  }

  const textParts = [comm.aiSummary, comm.sourceThreadId, comm.kind].filter(Boolean);
  if (textParts.length === 0) {
    return new Response('No text to embed', { status: 200 });
  }

  const { embedding } = await embedText({ text: textParts.join(' ') });

  await db
    .update(communications)
    .set({ embedding, embeddingGeneratedAt: new Date() })
    .where(eq(communications.id, communicationId));

  // Fetch supplemental fields for Typesense index
  const [[emailThread], [slackMsg]] = await Promise.all([
    db
      .select({ subject: emailThreads.subject, snippet: emailThreads.snippet })
      .from(emailThreads)
      .where(eq(emailThreads.communicationId, communicationId))
      .limit(1),
    db
      .select({ text: slackMessages.text })
      .from(slackMessages)
      .where(eq(slackMessages.communicationId, communicationId))
      .limit(1),
  ]);

  void indexCommunication({
    id: comm.id,
    organization_id: comm.organizationId,
    subject: emailThread?.subject ?? undefined,
    body_preview: emailThread?.snippet ?? slackMsg?.text?.slice(0, 200) ?? undefined,
    direction: comm.direction ?? undefined,
    kind: comm.kind,
    vendor: comm.medium ?? undefined,
    occurred_at: Math.floor((comm.startedAt ?? new Date()).getTime() / 1000),
  });

  return new Response('OK', { status: 200 });
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test --filter=web -- --reporter=verbose embed-communication
pnpm typecheck
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/queues/embed-communication/route.ts apps/web/app/api/queues/embed-communication/route.test.ts
git commit -m "feat(embed): Typesense sync in embed-communication consumer (M7 task 3)"
```

---

## Task 4: Typesense sync in `embed-document` consumer

**Files:**

- Modify: `apps/web/app/api/queues/embed-document/route.ts`
- Modify: `apps/web/app/api/queues/embed-document/route.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/web/app/api/queues/embed-document/route.test.ts`, add:

```typescript
vi.mock('@cema/typesense', () => ({
  indexDocument: vi.fn().mockResolvedValue(undefined),
  isTypesenseConfigured: vi.fn().mockReturnValue(true),
}));
```

And a new test:

```typescript
it('calls indexDocument after writing embedding', async () => {
  const { indexDocument } = await import('@cema/typesense');
  vi.mocked(getDb).mockReturnValue(
    buildDb({ selectResult: [{ doc: DOC, dealOrgId: 'org-1' }] }) as never,
  );
  vi.mocked(embedText).mockResolvedValueOnce({
    embedding: [0.1, 0.2],
    dimensions: 2,
    model: 'text-embedding-3-large',
    inputTokens: 5,
  });

  const res = await POST(makeRequest({ orgId: 'org-1', documentId: 'doc-1' }));
  expect(res.status).toBe(200);
  expect(indexDocument).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'doc-1', organization_id: 'org-1' }),
  );
});
```

Where `DOC` is a test fixture:

```typescript
const DOC = {
  id: 'doc-1',
  organizationId: 'org-1',
  kind: 'cema_3172',
  status: 'draft',
  fileName: 'cema-agreement.pdf',
  extractedData: { borrowerName: 'John Doe' },
  createdAt: new Date('2026-01-01'),
  embeddingGeneratedAt: null,
};
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test --filter=web -- --reporter=verbose embed-document
```

Expected: FAIL

- [ ] **Step 3: Update `embed-document/route.ts`**

```typescript
import { deals, documents, getDb } from '@cema/db';
import { embedText } from '@cema/embeddings';
import { TopicSchema } from '@cema/queues';
import { indexDocument } from '@cema/typesense';
import { eq } from 'drizzle-orm';

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as unknown;
  const { orgId, documentId } = TopicSchema['docs.embed'].parse(body);

  const db = getDb();
  const [row] = await db
    .select({ doc: documents, dealOrgId: deals.organizationId })
    .from(documents)
    .innerJoin(deals, eq(documents.dealId, deals.id))
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!row || row.dealOrgId !== orgId) {
    return new Response('Not found', { status: 404 });
  }

  const { doc } = row;
  const extractedText =
    doc.extractedData && Object.keys(doc.extractedData).length > 0
      ? JSON.stringify(doc.extractedData)
      : '';
  const textParts = [doc.kind, extractedText].filter(Boolean);

  const { embedding } = await embedText({ text: textParts.join(' ') });

  await db
    .update(documents)
    .set({ embedding, embeddingGeneratedAt: new Date() })
    .where(eq(documents.id, documentId));

  void indexDocument({
    id: doc.id,
    organization_id: row.dealOrgId,
    kind: doc.kind,
    status: doc.status,
    filename: doc.fileName ?? undefined,
    created_at: Math.floor(doc.createdAt.getTime() / 1000),
  });

  return new Response('OK', { status: 200 });
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test --filter=web -- --reporter=verbose embed-document
pnpm typecheck
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/queues/embed-document/route.ts apps/web/app/api/queues/embed-document/route.test.ts
git commit -m "feat(embed): Typesense sync in embed-document consumer (M7 task 4)"
```

---

## Task 5: Entity resolution in `embed-communication` consumer

**Files:**

- Modify: `apps/web/app/api/queues/embed-communication/route.ts`
- Modify: `apps/web/app/api/queues/embed-communication/route.test.ts`

Entity resolution is fire-and-forget after the embedding step. It matches participant emails from `emailThreads` → `contact_identities(kind='email')` → `kg_edges(predicate='contact_is_party')` → `communications.fromPartyId`/`toPartyIds`.

- [ ] **Step 1: Write the failing test for entity resolution**

Add to `embed-communication/route.test.ts`:

```typescript
vi.mock('@cema/kg', () => ({
  findNeighbors: vi.fn().mockResolvedValue([]),
}));

it('resolves fromPartyId when emailThread has fromEmail matching a contact identity', async () => {
  // DB: comm found, emailThread with fromEmail, contact_identity found, kg edge found
  const updateMock = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  });
  const selectResults = [
    [COMM], // communications select
    [{ subject: 'Test', snippet: 'hi' }], // emailThreads select
    [], // slackMessages select
    [{ contactId: 'contact-1', normalizedValue: 'from@example.com' }], // contact_identities
    [{ objectId: 'party-1', objectType: 'party' }], // kg_edges for from contact
    [], // kg_edges for to contacts
  ];
  // ... mock getDb to return these in sequence ...

  const res = await POST(makeRequest({ orgId: 'org-1', communicationId: 'comm-1' }));
  expect(res.status).toBe(200);
  // The update should eventually be called with fromPartyId
  // (fire-and-forget, so we await a tick)
  await new Promise((r) => setTimeout(r, 0));
  expect(updateMock).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test --filter=web -- --reporter=verbose embed-communication
```

Expected: FAIL

- [ ] **Step 3: Add `resolveCommParties` helper + call in `embed-communication/route.ts`**

Add the following imports at the top:

```typescript
import {
  communications,
  contactIdentities,
  emailThreads,
  getDb,
  kgEdges,
  slackMessages,
} from '@cema/db';
import { and, eq, inArray } from 'drizzle-orm';
```

Add the helper function and the fire-and-forget call in `POST`:

```typescript
// After the void indexCommunication(...) call, add:
void resolveCommParties(db, comm.id, comm.organizationId);
```

```typescript
async function resolveCommParties(
  db: ReturnType<typeof getDb>,
  communicationId: string,
  organizationId: string,
): Promise<void> {
  const [[emailThread], [slackMsg]] = await Promise.all([
    db
      .select({ fromEmail: emailThreads.fromEmail, toParticipants: emailThreads.toParticipants })
      .from(emailThreads)
      .where(eq(emailThreads.communicationId, communicationId))
      .limit(1),
    db
      .select({ authorSlackUserId: slackMessages.authorSlackUserId })
      .from(slackMessages)
      .where(eq(slackMessages.communicationId, communicationId))
      .limit(1),
  ]);

  const emailFrom = emailThread?.fromEmail?.toLowerCase() ?? null;
  const emailsTo = (emailThread?.toParticipants ?? []).map((e) => e.toLowerCase());
  const slackUser = slackMsg?.authorSlackUserId ?? null;

  const lookupEmails = [...new Set([emailFrom, ...emailsTo].filter(Boolean))] as string[];
  const lookupSlack = slackUser ? [slackUser] : [];

  if (lookupEmails.length === 0 && lookupSlack.length === 0) return;

  const identityRows = await db
    .select({
      contactId: contactIdentities.contactId,
      normalizedValue: contactIdentities.normalizedValue,
      kind: contactIdentities.kind,
    })
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.organizationId, organizationId),
        lookupEmails.length > 0 && lookupSlack.length > 0
          ? undefined // handled separately
          : lookupEmails.length > 0
            ? and(
                eq(contactIdentities.kind, 'email'),
                inArray(contactIdentities.normalizedValue, lookupEmails),
              )
            : and(
                eq(contactIdentities.kind, 'slack_user'),
                inArray(contactIdentities.normalizedValue, lookupSlack),
              ),
      ),
    );

  if (identityRows.length === 0) return;

  const contactIds = identityRows.map((r) => r.contactId);
  const edges = await db
    .select({ subjectId: kgEdges.subjectId, objectId: kgEdges.objectId })
    .from(kgEdges)
    .where(
      and(
        eq(kgEdges.organizationId, organizationId),
        eq(kgEdges.predicate, 'contact_is_party'),
        eq(kgEdges.subjectType, 'contact'),
        inArray(kgEdges.subjectId, contactIds),
      ),
    );

  if (edges.length === 0) return;

  // Map email → contactId → partyId
  const emailToContact = new Map(identityRows.map((r) => [r.normalizedValue, r.contactId]));
  const contactToParty = new Map(edges.map((e) => [e.subjectId, e.objectId]));

  const fromContactId = emailFrom ? emailToContact.get(emailFrom) : null;
  const fromPartyId = fromContactId ? (contactToParty.get(fromContactId) ?? null) : null;

  const toPartyIds = emailsTo
    .map((e) => {
      const cId = emailToContact.get(e);
      return cId ? (contactToParty.get(cId) ?? null) : null;
    })
    .filter((p): p is string => p !== null);

  if (!fromPartyId && toPartyIds.length === 0) return;

  await db
    .update(communications)
    .set({
      ...(fromPartyId ? { fromPartyId } : {}),
      ...(toPartyIds.length > 0 ? { toPartyIds } : {}),
    })
    .where(eq(communications.id, communicationId));
}
```

- [ ] **Step 4: Run typecheck + tests**

```bash
pnpm typecheck
pnpm test --filter=web -- --reporter=verbose embed-communication
```

If `kgEdges` is not exported from `@cema/db`, check `packages/db/src/index.ts` and add the export. If `communications.toPartyIds` requires `uuid[]` type, confirm the Drizzle schema accepts a `string[]` on update.

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/queues/embed-communication/route.ts apps/web/app/api/queues/embed-communication/route.test.ts
git commit -m "feat(embed): entity resolution — resolve fromPartyId/toPartyIds via contact_identities (M7 task 5)"
```

---

## Task 6: Backfill embeddings cron job

**Files:**

- Create: `apps/web/app/api/cron/backfill-embeddings/route.ts`
- Create: `apps/web/app/api/cron/backfill-embeddings/route.test.ts`
- Modify: `apps/web/vercel.json`

The cron queries `communications` and `documents` with `embeddingGeneratedAt IS NULL`, batch-publishes to `comms.embed` / `docs.embed` (max 100 each per run), and returns counts. Idempotent — repeated runs just re-publish; consumers handle existing embeddings via the `embeddingGeneratedAt` check.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/api/cron/backfill-embeddings/route.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  communications: {},
  documents: {},
  deals: {},
}));
vi.mock('@cema/queues', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
  TopicSchema: {},
}));
vi.mock('drizzle-orm', () => ({ isNull: vi.fn(), eq: vi.fn() }));

import { getDb } from '@cema/db';
import { publish } from '@cema/queues';

import { GET } from './route';

function buildDb(overrides: { commsResult?: unknown[]; docsResult?: unknown[] } = {}) {
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(overrides.docsResult ?? []),
        }),
      }),
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(overrides.commsResult ?? []),
      }),
    }),
  });
  return { select };
}

describe('GET /api/cron/backfill-embeddings', () => {
  it('returns 200 with zero counts when no rows need embedding', async () => {
    vi.mocked(getDb).mockReturnValue(buildDb() as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ commsQueued: 0, docsQueued: 0 });
  });

  it('publishes comms.embed for each communication without embedding', async () => {
    vi.mocked(getDb).mockReturnValue(
      buildDb({
        commsResult: [
          { id: 'comm-1', organizationId: 'org-1' },
          { id: 'comm-2', organizationId: 'org-1' },
        ],
      }) as never,
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(vi.mocked(publish)).toHaveBeenCalledWith(
      'comms.embed',
      { orgId: 'org-1', communicationId: 'comm-1' },
      expect.any(Function),
    );
    const body = await res.json();
    expect(body.commsQueued).toBe(2);
  });

  it('publishes docs.embed for each document without embedding', async () => {
    vi.mocked(getDb).mockReturnValue(
      buildDb({
        docsResult: [{ id: 'doc-1', organizationId: 'org-1' }],
      }) as never,
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(vi.mocked(publish)).toHaveBeenCalledWith(
      'docs.embed',
      { orgId: 'org-1', documentId: 'doc-1' },
      expect.any(Function),
    );
    const body = await res.json();
    expect(body.docsQueued).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm test --filter=web -- --reporter=verbose backfill-embeddings
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `apps/web/app/api/cron/backfill-embeddings/route.ts`**

```typescript
import { communications, deals, documents, getDb } from '@cema/db';
import { publish } from '@cema/queues';
import { isNull } from 'drizzle-orm';

import { vercelQueueSend } from '@/lib/queue';

const BATCH_SIZE = 100;

export async function GET(): Promise<Response> {
  const db = getDb();

  const [commRows, docRows] = await Promise.all([
    db
      .select({ id: communications.id, organizationId: communications.organizationId })
      .from(communications)
      .where(isNull(communications.embeddingGeneratedAt))
      .limit(BATCH_SIZE),
    db
      .select({ id: documents.id, organizationId: deals.organizationId })
      .from(documents)
      .innerJoin(deals, deals.id)
      .where(isNull(documents.embeddingGeneratedAt))
      .limit(BATCH_SIZE),
  ]);

  await Promise.all([
    ...commRows.map((row) =>
      publish(
        'comms.embed',
        { orgId: row.organizationId, communicationId: row.id },
        vercelQueueSend,
      ),
    ),
    ...docRows.map((row) =>
      publish('docs.embed', { orgId: row.organizationId, documentId: row.id }, vercelQueueSend),
    ),
  ]);

  return Response.json({ commsQueued: commRows.length, docsQueued: docRows.length });
}
```

**Note:** The `innerJoin(deals, deals.id)` syntax needs a proper ON clause — check the Drizzle join API in the codebase (look at `embed-document/route.ts` line `innerJoin(deals, eq(documents.dealId, deals.id))`). Use the `eq` form:

```typescript
.innerJoin(deals, eq(documents.dealId, deals.id))
```

Import `eq` from `drizzle-orm` alongside `isNull`.

- [ ] **Step 4: Run tests**

```bash
pnpm test --filter=web -- --reporter=verbose backfill-embeddings
pnpm typecheck
```

Expected: PASS

- [ ] **Step 5: Add cron to `apps/web/vercel.json`**

Replace the file with:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "cd ../.. && turbo run build --filter=web",
  "installCommand": "cd ../.. && corepack enable && pnpm install --frozen-lockfile",
  "ignoreCommand": "cd ../.. && git diff HEAD^ HEAD --quiet .",
  "crons": [
    {
      "path": "/api/cron/backfill-embeddings",
      "schedule": "0 2 * * *"
    }
  ]
}
```

This runs at 2am UTC daily.

- [ ] **Step 6: Run full test suite**

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/cron/backfill-embeddings/ apps/web/vercel.json
git commit -m "feat(cron): backfill-embeddings cron — publish embed topics for unembedded rows (M7 task 6)"
```

---

## Task 7: Env var provisioning runbook

**Files:**

- Create: `docs/runbooks/m7-env-var-provisioning.md`

- [ ] **Step 1: Create the runbook**

Create `docs/runbooks/m7-env-var-provisioning.md`:

````markdown
# M7 Env Var Provisioning — Typesense Cloud + Mem0

Run this runbook once per environment (preview, production) after M7 merges.

## 1. Typesense Cloud

### 1a. Create a cluster

1. Sign up or log in at https://cloud.typesense.org
2. Create a new cluster — choose the region closest to your Neon branch (us-east-1 for Neon default).
3. Wait for cluster to reach `Running` state (~5 minutes).
4. Under **Cluster → Keys**, create an API key with `documents:get,documents:create,documents:upsert,documents:delete,collections:create,collections:get` permissions. Copy it.
5. Under **Cluster**, copy the **Hostname** (e.g. `xxx.a1.typesense.net`).

### 1b. Set env vars in Vercel

```bash
vercel env add TYPESENSE_API_KEY          # paste the key
vercel env add TYPESENSE_HOST             # paste the hostname (no https://)
vercel env add TYPESENSE_PORT             # 443
vercel env add TYPESENSE_PROTOCOL         # https
```
````

For production only, add `--environment=production`. For preview, add `--environment=preview`.

### 1c. Verify locally

```bash
TYPESENSE_API_KEY=<key> TYPESENSE_HOST=<host> TYPESENSE_PORT=443 TYPESENSE_PROTOCOL=https \
  node -e "const { isTypesenseConfigured } = require('./packages/typesense/dist'); console.log(isTypesenseConfigured())"
```

Expected: `true`

## 2. Mem0

### 2a. Get API key

1. Sign up at https://app.mem0.ai
2. Under **Settings → API Keys**, create a key. Copy it.

### 2b. Set env var in Vercel

```bash
vercel env add MEM0_API_KEY   # paste the key
```

### 2c. Verify

```bash
MEM0_API_KEY=<key> node -e "const { isMemoryConfigured } = require('./packages/memory/dist'); console.log(isMemoryConfigured())"
```

Expected: `true`

## 3. Trigger backfill

After deploying with the new env vars:

```bash
# Trigger the backfill manually (or wait for 2am UTC)
curl -X GET https://<your-vercel-url>/api/cron/backfill-embeddings
```

Check the response: `{ "commsQueued": N, "docsQueued": M }`.
Monitor the Vercel queue dashboard to confirm embed jobs are consumed.

## 4. Production smoke test

1. Go to `/search` in the deployed app.
2. Enter a query that matches a known email subject or document kind.
3. Verify results include both pgvector hits AND Typesense full-text hits (check the `preview` field: `(full-text match)` indicates a Typesense hit).
4. Repeat a search twice in the same deal context — verify Mem0 memory context is prepended on the second query (check server logs for `memoryContext` entries).

````

- [ ] **Step 2: Run full test + build**

```bash
pnpm test
pnpm build
````

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/m7-env-var-provisioning.md
git commit -m "docs(runbook): M7 env var provisioning — Typesense Cloud + Mem0 (M7 task 7)"
```

---

## Task 8: Final gate — tests, typecheck, lint, ADR, CLAUDE.md, PR

**Files:**

- Create: `docs/adr/0007-phase-0-month-7-production-pipeline-entity-resolution.md`
- Modify: `CLAUDE.md` §2

- [ ] **Step 1: Full test suite gate**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

All must pass. Fix any issues before continuing.

- [ ] **Step 2: Verify test count**

```bash
pnpm test -- --reporter=verbose 2>&1 | grep -E "Tests|passed"
```

Expected: ≥ 232 tests passing (223 baseline + ~9 new assertions across 4 test files).

- [ ] **Step 3: Write ADR 0007**

Create `docs/adr/0007-phase-0-month-7-production-pipeline-entity-resolution.md` following the same template as ADR 0006. Key decisions to document:

- Trigger-at-insert vs. trigger-at-completion for embed topics (chose at-insert; embedding runs on whatever text is available, sparse embeddings are acceptable for Phase 0)
- Entity resolution as fire-and-forget in embed consumer (latency > correctness; resolution is best-effort)
- Backfill via cron + queue rather than a single long-running script (Vercel Function timeouts; fan-out via queue is more resilient)
- `BATCH_SIZE = 100` for backfill (conservative; avoids flooding the queue; can increase in Phase 1)

- [ ] **Step 4: Update CLAUDE.md §2**

Update the phase line to: "Phase 0 Month 7 fully closed out; Phase 0 Month 8 is next."
Move M6 carry-overs (Typesense provisioning, Mem0 provisioning, backfill) from the carry-over list to RESOLVED.
Add new M7 carry-overs: (1) entity resolution for Twilio/Deepgram communications (phone call transcripts), (2) Typesense schema + index creation automation (currently manual), (3) Mem0 production smoke test.
Add changelog row.

- [ ] **Step 5: Commit ADR + CLAUDE.md**

```bash
git add docs/adr/0007-phase-0-month-7-production-pipeline-entity-resolution.md CLAUDE.md
git commit -m "docs(adr): ADR 0007 + CLAUDE.md close-out for M7 (task 8)"
```

- [ ] **Step 6: Push and open PR**

```bash
git push -u origin feat/m7-production-pipeline-entity-resolution
gh pr create \
  --title "feat(m7): production pipeline + entity resolution" \
  --body "$(cat <<'EOF'
## Summary

- Publishes \`comms.embed\` from Nylas (email + meeting) and Slack webhook handlers on every new communication insert
- Adds Typesense \`indexCommunication\` / \`indexDocument\` calls in embed consumers after writing the embedding
- Fire-and-forget entity resolution in \`embed-communication\` consumer: matches \`emailThreads.fromEmail\` → \`contact_identities\` → \`kg_edges\` → writes \`communications.fromPartyId\` / \`toPartyIds\`
- Adds \`GET /api/cron/backfill-embeddings\` Vercel Cron (2am UTC daily) that publishes embed topics for all rows with \`embeddingGeneratedAt IS NULL\`
- Env var provisioning runbook for Typesense Cloud + Mem0

## Test plan
- [ ] All 232+ tests pass (`pnpm test`)
- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Build passes (`pnpm build`)
- [ ] Verify Nylas route test asserts `comms.embed` publish
- [ ] Verify Slack route test asserts `comms.embed` publish
- [ ] Verify embed-communication test asserts `indexCommunication` call
- [ ] Verify embed-document test asserts `indexDocument` call
- [ ] Verify backfill cron tests pass (3 assertions)
- [ ] After provisioning env vars: run smoke test per `docs/runbooks/m7-env-var-provisioning.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Enable auto-merge**

```bash
gh pr merge <PR_NUMBER> --auto --squash --delete-branch
```

---

## Self-Review Checklist

**Spec coverage:**

- §10 (Search + Memory): Typesense sync activated ✅; Mem0 provisioning runbook ✅
- §9.1 (Knowledge graph): entity resolution populating `from_party_id` / `to_party_ids` ✅
- M6 carry-overs #1–4: all addressed ✅

**Placeholder scan:** No TBDs, no "add appropriate handling" — all steps show exact code.

**Type consistency:**

- `indexCommunication` / `indexDocument` signatures match `sync.ts` exports
- `resolveCommParties` uses `kgEdges` (check that `@cema/db` exports this as `kgEdges` — see `packages/db/src/schema/kg.ts`)
- `communications.toPartyIds` is `uuid('to_party_ids').array()` (nullable string array in Drizzle) — confirm update accepts `string[]`

**Potential blockers:**

1. `kgEdges` export: verify it's in `packages/db/src/index.ts`. If exported as `kg_edges`, update the import.
2. `documents.fileName` vs `documents.filename`: check the documents schema column name before using it in `indexDocument`.
3. The `resolveCommParties` query uses `and(eq(kind, 'email'), inArray(...))` + similar for slack — if both are needed, use separate queries rather than trying to OR them (cleaner and easier to test).
4. Vercel Cron routes must be `GET` not `POST` per Vercel docs — this plan uses `GET`. Verify with `vercel:cron-jobs` skill if unsure.
