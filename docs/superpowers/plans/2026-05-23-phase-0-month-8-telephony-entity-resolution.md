# Phase 0 Month 8: Telephony Entity Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete communication→party entity resolution for telephony calls by (1) publishing `comms.embed` from the Twilio webhook, (2) seeding `contact_identities` when a contact is linked to a party, and (3) extending `resolveCommParties` to look up phone numbers in `contact_identities(kind='phone')`.

**Architecture:** M7 wired email and Slack entity resolution end-to-end. M8 adds the phone leg: the Twilio recording-complete callback now publishes `comms.embed` so the embed consumer runs; `linkContactToParty` upserts contact email+phone into `contact_identities` so resolution has data to work with; and `resolveCommParties` gains a `kind='phone'` lookup path that reads `fromE164`/`toE164` directly off the `communications` row. The `contactIdentities` unique index `(organizationId, kind, normalizedValue)` already exists so seeding is idempotent via `onConflictDoNothing`.

**Tech Stack:** Drizzle ORM, Vercel Queues (`comms.embed`), Vitest

---

## File map

| File                                                           | Change                                                                                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/api/webhooks/twilio/route.ts`                    | Add `comms.embed` publish after `telephony.call.ingest` publish                                                                                                                       |
| `apps/web/app/api/webhooks/twilio/route.test.ts`               | Update existing publish count test + add `comms.embed` assertion                                                                                                                      |
| `apps/web/lib/actions/link-contact-to-party.ts`                | Fetch contact after `addEdge`; upsert `contact_identities` for email + phone                                                                                                          |
| `apps/web/lib/actions/link-contact-to-party.test.ts`           | Update mock to handle two select calls; add 3 identity-seeding tests                                                                                                                  |
| `apps/web/app/api/queues/embed-communication/route.ts`         | Extend `resolveCommParties` type + add `lookupPhones` + rename `emailToContact` → `identityToContact`; use `fromKey = emailFrom ?? slackUser ?? phoneFrom`; add `phoneTo` to `toKeys` |
| `apps/web/app/api/queues/embed-communication/route.test.ts`    | Add 2 phone entity resolution tests                                                                                                                                                   |
| `docs/adr/0008-phase-0-month-8-telephony-entity-resolution.md` | ADR for M8                                                                                                                                                                            |

---

## Schema reference (read-only, already exists)

```typescript
// packages/db/src/schema/contacts.ts
contacts.primaryEmail; // varchar(256) | null
contacts.primaryPhone; // varchar(20) | null  — stored as E.164 e.g. '+12125551234'

contactIdentities.contactId; // uuid
contactIdentities.organizationId; // uuid
contactIdentities.kind; // 'email' | 'phone' | 'slack_user' | 'crm_id'
contactIdentities.normalizedValue; // varchar(256)  — lowercase email or E.164 phone
contactIdentities.source; // 'party' | 'comm_from' | 'comm_to' | 'slack_message' | 'manual'
// uniqueIndex on (organizationId, kind, normalizedValue) — already exists

// packages/db/src/schema/communications.ts
communications.fromE164; // varchar(20) | null  — E.164 caller number
communications.toE164; // varchar(20) | null  — E.164 recipient number
```

---

## Task 1: Publish `comms.embed` from Twilio webhook

**Files:**

- Modify: `apps/web/app/api/webhooks/twilio/route.ts`
- Test: `apps/web/app/api/webhooks/twilio/route.test.ts`

The Twilio recording-complete callback is the point where a telephony call comm is fully identified. M7 added `comms.embed` to Nylas and Slack webhooks; M8 adds the same publish here.

- [ ] **Step 1: Write failing tests**

Open `apps/web/app/api/webhooks/twilio/route.test.ts`. Find the existing test `'returns 200 and publishes to the queue for a valid completed recording'` and update it, then add one new test directly after it:

```typescript
it('returns 200 and publishes both telephony.call.ingest and comms.embed for a valid completed recording', async () => {
  setupDbMock([{ id: 'comm-uuid-1', organizationId: 'org-uuid-1' }]);
  const res = await POST(makeRequest(COMPLETED_PARAMS));
  expect(res.status).toBe(200);
  expect(publish).toHaveBeenCalledTimes(2);
  const [topic, payload] = vi.mocked(publish).mock.calls[0] as [
    string,
    Record<string, unknown>,
    unknown,
  ];
  expect(topic).toBe('telephony.call.ingest');
  expect(payload).toMatchObject({
    orgId: 'org-uuid-1',
    provider: 'twilio',
    vendorCallId: 'CA123',
    vendorEventId: 'RE456',
  });
});

it('publishes comms.embed with communicationId for completed recording', async () => {
  setupDbMock([{ id: 'comm-uuid-1', organizationId: 'org-uuid-1' }]);
  await POST(makeRequest(COMPLETED_PARAMS));
  const calls = vi.mocked(publish).mock.calls as [string, Record<string, unknown>, unknown][];
  const embedCall = calls.find(([topic]) => topic === 'comms.embed');
  expect(embedCall).toBeDefined();
  expect(embedCall![1]).toEqual({ orgId: 'org-uuid-1', communicationId: 'comm-uuid-1' });
});
```

Note: the existing `'publishes vendorPayload containing the raw Twilio params'` test already uses `mock.calls[0]` so it still works (telephony.call.ingest is always the first publish).

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test --filter web -- apps/web/app/api/webhooks/twilio/route.test.ts
```

Expected: 2 failures — publish call count mismatch and `comms.embed` call not found.

- [ ] **Step 3: Implement the change**

Replace the full content of `apps/web/app/api/webhooks/twilio/route.ts`:

```typescript
import { communications, getDb } from '@cema/db';
import { parseTwilioRecordingCallback, verifyTwilioSignature } from '@cema/integrations-twilio';
import { publish } from '@cema/queues';
import { eq } from 'drizzle-orm';

import { vercelQueueSend } from '@/lib/queue';

export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return new Response('TWILIO_AUTH_TOKEN not configured', { status: 500 });
  }

  const twilioSignature = req.headers.get('x-twilio-signature');
  if (!twilioSignature) {
    return new Response('Missing X-Twilio-Signature', { status: 400 });
  }

  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const paramsObj = Object.fromEntries(params.entries());

  if (!verifyTwilioSignature(authToken, twilioSignature, req.url, paramsObj)) {
    return new Response('Invalid Twilio signature', { status: 403 });
  }

  const callback = parseTwilioRecordingCallback(params);

  if (callback.recordingStatus !== 'completed') {
    return new Response('OK', { status: 200 });
  }

  const [comm] = await getDb()
    .select()
    .from(communications)
    .where(eq(communications.vendorCallId, callback.callSid))
    .limit(1);

  if (!comm) {
    return new Response('Communication not found for CallSid', { status: 404 });
  }

  await publish(
    'telephony.call.ingest',
    {
      orgId: comm.organizationId,
      provider: 'twilio',
      vendorCallId: callback.callSid,
      vendorEventId: callback.recordingSid,
      vendorPayload: paramsObj,
      receivedAt: new Date().toISOString(),
    },
    vercelQueueSend,
  );

  await publish(
    'comms.embed',
    { orgId: comm.organizationId, communicationId: comm.id },
    vercelQueueSend,
  );

  return new Response('OK', { status: 200 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test --filter web -- apps/web/app/api/webhooks/twilio/route.test.ts
```

Expected: all tests pass (the old `toHaveBeenCalledOnce()` test was replaced with `toHaveBeenCalledTimes(2)` in Step 1).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/webhooks/twilio/route.ts apps/web/app/api/webhooks/twilio/route.test.ts
git commit -m "feat(webhooks): publish comms.embed from Twilio recording callback (M8 task 1)"
```

---

## Task 2: Seed `contact_identities` in `linkContactToParty`

**Files:**

- Modify: `apps/web/lib/actions/link-contact-to-party.ts`
- Test: `apps/web/lib/actions/link-contact-to-party.test.ts`

When a user links a contact to a party, we now also register that contact's email and phone in `contact_identities`. This is what enables entity resolution to match future communications to this party.

- [ ] **Step 1: Write failing tests**

Replace the full content of `apps/web/lib/actions/link-contact-to-party.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'clerk-user-1' }),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  users: {},
  parties: { id: 'p_id_col', dealId: 'p_deal_id_col' },
  deals: { id: 'd_id_col', organizationId: 'd_org_id_col' },
  contacts: { id: 'c_id_col', primaryEmail: 'c_email_col', primaryPhone: 'c_phone_col' },
  contactIdentities: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/kg', () => ({
  addEdge: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { addEdge } from '@cema/kg';
import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { linkContactToParty } from './link-contact-to-party';

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };
const PARTY = { id: 'party-1', dealId: 'deal-1' };
const CONTACT_WITH_BOTH = { primaryEmail: 'alice@example.com', primaryPhone: '+12125550001' };
const CONTACT_EMAIL_ONLY = { primaryEmail: 'bob@example.com', primaryPhone: null };
const CONTACT_PHONE_ONLY = { primaryEmail: null, primaryPhone: '+16465550002' };
const CONTACT_NO_IDENTITY = { primaryEmail: null, primaryPhone: null };

function makeDb() {
  return {
    query: {
      organizations: { findFirst: vi.fn().mockResolvedValue(ORG) },
      users: {
        findFirst: vi.fn().mockResolvedValue({ id: 'user-1', clerkUserId: 'clerk-user-1' }),
      },
    },
  } as unknown as ReturnType<typeof getDb>;
}

function makeTxWith(partyRow: unknown, contactRow: unknown) {
  const selectMock = vi.fn();
  // First call: .select().from(parties).innerJoin(deals).where() → party
  selectMock.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(partyRow ? [partyRow] : []),
      }),
    }),
  });
  // Second call: .select().from(contacts).where().limit() → contact
  selectMock.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(contactRow ? [contactRow] : []),
      }),
    }),
  });
  const insertMock = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    }),
  });
  return { select: selectMock, insert: insertMock } as never;
}

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue(makeDb());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('linkContactToParty', () => {
  it('throws when party is not found', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith(null, null)));
    await expect(linkContactToParty('contact-1', 'party-99')).rejects.toThrow('Party not found');
  });

  it('calls addEdge twice (contact→party and party→deal) on happy path', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWith(PARTY, CONTACT_NO_IDENTITY)),
    );
    await linkContactToParty('contact-1', 'party-1');
    expect(addEdge).toHaveBeenCalledTimes(2);
  });

  it('returns edge counts on success', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWith(PARTY, CONTACT_NO_IDENTITY)),
    );
    const result = await linkContactToParty('contact-1', 'party-1');
    expect(result).toEqual({
      edgesCreated: 2,
      contactId: 'contact-1',
      partyId: 'party-1',
      dealId: 'deal-1',
    });
  });

  it('upserts email and phone identity rows when contact has both', async () => {
    const tx = makeTxWith(PARTY, CONTACT_WITH_BOTH);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(tx));
    await linkContactToParty('contact-1', 'party-1');
    expect(tx.insert).toHaveBeenCalledOnce();
    const insertedValues = (tx.insert as ReturnType<typeof vi.fn>).mock.results[0].value.values.mock
      .calls[0][0] as unknown[];
    expect(insertedValues).toHaveLength(2);
    expect(insertedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'email', normalizedValue: 'alice@example.com' }),
        expect.objectContaining({ kind: 'phone', normalizedValue: '+12125550001' }),
      ]),
    );
  });

  it('upserts only email identity when contact has no phone', async () => {
    const tx = makeTxWith(PARTY, CONTACT_EMAIL_ONLY);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(tx));
    await linkContactToParty('contact-1', 'party-1');
    expect(tx.insert).toHaveBeenCalledOnce();
    const insertedValues = (tx.insert as ReturnType<typeof vi.fn>).mock.results[0].value.values.mock
      .calls[0][0] as unknown[];
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({ kind: 'email', normalizedValue: 'bob@example.com' });
  });

  it('skips insert entirely when contact has no email or phone', async () => {
    const tx = makeTxWith(PARTY, CONTACT_NO_IDENTITY);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(tx));
    await linkContactToParty('contact-1', 'party-1');
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test --filter web -- apps/web/lib/actions/link-contact-to-party.test.ts
```

Expected: 3 failures for the identity-seeding tests; the first 3 (throw/addEdge/returns) fail because the mock signature changed.

- [ ] **Step 3: Implement the change**

Replace the full content of `apps/web/lib/actions/link-contact-to-party.ts`:

```typescript
'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { contactIdentities, contacts, deals, getDb, parties } from '@cema/db';
import { addEdge } from '@cema/kg';
import { and, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

export interface LinkContactToPartyResult {
  edgesCreated: number;
  contactId: string;
  partyId: string;
  dealId: string;
}

export async function linkContactToParty(
  contactId: string,
  partyId: string,
): Promise<LinkContactToPartyResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new Error('User not authenticated');

  const db = getDb();
  const [org, user] = await Promise.all([
    db.query.organizations.findFirst({ where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId) }),
    db.query.users.findFirst({ where: (u, { eq }) => eq(u.clerkUserId, clerkUser.id) }),
  ]);
  if (!org) throw new Error('Organization not found');
  if (!user) throw new Error('User not found');

  return withRls(org.id, async (tx) => {
    const [partyRow] = await tx
      .select({ id: parties.id, dealId: parties.dealId })
      .from(parties)
      .innerJoin(deals, eq(deals.id, parties.dealId))
      .where(and(eq(parties.id, partyId), eq(deals.organizationId, org.id)));

    if (!partyRow) throw new Error('Party not found');

    const [contact] = await tx
      .select({ primaryEmail: contacts.primaryEmail, primaryPhone: contacts.primaryPhone })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    await Promise.all([
      addEdge(tx as never, {
        organizationId: org.id,
        subjectId: contactId,
        subjectType: 'contact',
        predicate: 'contact_is_party',
        objectId: partyRow.id,
        objectType: 'party',
      }),
      addEdge(tx as never, {
        organizationId: org.id,
        subjectId: partyRow.id,
        subjectType: 'party',
        predicate: 'party_is_on_deal',
        objectId: partyRow.dealId,
        objectType: 'deal',
      }),
    ]);

    if (contact) {
      const identityValues = [
        contact.primaryEmail
          ? {
              contactId,
              organizationId: org.id,
              kind: 'email' as const,
              normalizedValue: contact.primaryEmail.toLowerCase(),
              source: 'party' as const,
            }
          : null,
        contact.primaryPhone
          ? {
              contactId,
              organizationId: org.id,
              kind: 'phone' as const,
              normalizedValue: contact.primaryPhone,
              source: 'party' as const,
            }
          : null,
      ].filter(<T>(v: T | null): v is T => v !== null);

      if (identityValues.length > 0) {
        await tx.insert(contactIdentities).values(identityValues).onConflictDoNothing();
      }
    }

    return { edgesCreated: 2, contactId, partyId: partyRow.id, dealId: partyRow.dealId };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test --filter web -- apps/web/lib/actions/link-contact-to-party.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/link-contact-to-party.ts apps/web/lib/actions/link-contact-to-party.test.ts
git commit -m "feat(contacts): seed contact_identities on linkContactToParty (M8 task 2)"
```

---

## Task 3: Phone entity resolution in `resolveCommParties`

**Files:**

- Modify: `apps/web/app/api/queues/embed-communication/route.ts`
- Test: `apps/web/app/api/queues/embed-communication/route.test.ts`

Extend `resolveCommParties` to read `fromE164`/`toE164` from the `communications` row and look them up in `contact_identities(kind='phone')`. The Map-based approach is unchanged — just one more lookup added to the IIFE.

Key renaming: `emailToContact` → `identityToContact` (the map now covers all three identity kinds).
Key change to `fromKey`: `emailFrom ?? slackUser ?? phoneFrom` — picks the first non-null sender identifier.
Key change to `toKeys`: `[...emailsTo, ...phoneTo]` — includes phone recipients.

- [ ] **Step 1: Write failing tests**

Open `apps/web/app/api/queues/embed-communication/route.test.ts`. At the end of the `describe` block (after the existing entity-resolution tests), add:

```typescript
it('resolves fromPartyId from comm.fromE164 when no email or slack', async () => {
  // Arrange — 5 sequential select results:
  // 1. communications (main comm fetch)
  // 2. emailThreads (no result)
  // 3. slackMessages (no result)
  // 4. contactIdentities phone lookup
  // 5. kgEdges lookup
  const selectMock = vi
    .fn()
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              id: 'comm-1',
              organizationId: 'org-1',
              fromE164: '+12125550001',
              toE164: null,
              aiSummary: 'call summary',
              sourceThreadId: null,
              kind: 'call',
              direction: 'outbound',
              medium: 'phone_softphone',
              startedAt: new Date(),
            },
          ]),
        }),
      }),
    })
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }) // emailThreads
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }) // slackMessages
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi
          .fn()
          .mockResolvedValue([
            { contactId: 'contact-1', normalizedValue: '+12125550001', kind: 'phone' },
          ]),
      }),
    }) // contactIdentities phone
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ subjectId: 'contact-1', objectId: 'party-1' }]),
      }),
    }); // kgEdges

  const updateMock = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  });

  vi.mocked(getDb).mockReturnValueOnce({
    select: selectMock,
    update: updateMock,
  } as unknown as ReturnType<typeof getDb>);

  const req = new Request('http://localhost/api/queues/embed-communication', {
    method: 'POST',
    body: JSON.stringify({ orgId: 'org-1', communicationId: 'comm-1' }),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);

  // Allow fire-and-forget to complete
  await new Promise((r) => setTimeout(r, 10));

  const updateSet = (updateMock().set as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | Record<string, unknown>
    | undefined;
  expect(updateSet).toBeDefined();
  expect(updateSet?.fromPartyId).toBe('party-1');
});

it('resolves toPartyIds from comm.toE164 when no email or slack', async () => {
  const selectMock = vi
    .fn()
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              id: 'comm-1',
              organizationId: 'org-1',
              fromE164: null,
              toE164: '+16465550002',
              aiSummary: 'call',
              sourceThreadId: null,
              kind: 'call',
              direction: 'inbound',
              medium: 'phone_softphone',
              startedAt: new Date(),
            },
          ]),
        }),
      }),
    })
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }) // emailThreads
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }) // slackMessages
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi
          .fn()
          .mockResolvedValue([
            { contactId: 'contact-2', normalizedValue: '+16465550002', kind: 'phone' },
          ]),
      }),
    }) // contactIdentities phone
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ subjectId: 'contact-2', objectId: 'party-2' }]),
      }),
    }); // kgEdges

  const updateMock = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  });

  vi.mocked(getDb).mockReturnValueOnce({
    select: selectMock,
    update: updateMock,
  } as unknown as ReturnType<typeof getDb>);

  const req = new Request('http://localhost/api/queues/embed-communication', {
    method: 'POST',
    body: JSON.stringify({ orgId: 'org-1', communicationId: 'comm-1' }),
  });
  await POST(req);
  await new Promise((r) => setTimeout(r, 10));

  const updateSet = (updateMock().set as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | Record<string, unknown>
    | undefined;
  expect(updateSet).toBeDefined();
  expect(updateSet?.toPartyIds).toEqual(['party-2']);
});
```

**Important:** the existing embed-communication tests mock `getDb` using `buildDb()` at module level. The new tests use `vi.mocked(getDb).mockReturnValueOnce(...)` which works because `mockReturnValueOnce` takes priority over the module-level `mockReturnValue`. The `getDb` mock must already exist in the file — check that `vi.mock('@cema/db', ...)` is present and includes `contactIdentities: {}` and `kgEdges: {}` (added in M7). If not, add them.

Also verify `vi.mock('@cema/typesense', ...)` is present with `indexCommunication: vi.fn()` (added in M7). If not, add it.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test --filter web -- apps/web/app/api/queues/embed-communication/route.test.ts
```

Expected: 2 new test failures — `resolveCommParties` doesn't handle phone numbers yet.

- [ ] **Step 3: Implement the change**

Replace the full content of `apps/web/app/api/queues/embed-communication/route.ts`:

```typescript
import {
  communications,
  contactIdentities,
  emailThreads,
  getDb,
  kgEdges,
  slackMessages,
} from '@cema/db';
import { embedText } from '@cema/embeddings';
import { TopicSchema } from '@cema/queues';
import { indexCommunication } from '@cema/typesense';
import { and, eq, inArray } from 'drizzle-orm';

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

  const [[emailThread], [slackMsg]] = await Promise.all([
    db
      .select({
        subject: emailThreads.subject,
        snippet: emailThreads.snippet,
        fromEmail: emailThreads.fromEmail,
        toParticipants: emailThreads.toParticipants,
      })
      .from(emailThreads)
      .where(eq(emailThreads.communicationId, communicationId))
      .limit(1),
    db
      .select({
        text: slackMessages.text,
        authorSlackUserId: slackMessages.authorSlackUserId,
      })
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

  void resolveCommParties(db, comm, emailThread ?? null, slackMsg ?? null);

  return new Response('OK', { status: 200 });
}

async function resolveCommParties(
  db: ReturnType<typeof getDb>,
  comm: {
    id: string;
    organizationId: string;
    fromE164: string | null;
    toE164: string | null;
  },
  emailThread: {
    fromEmail: string | null;
    toParticipants: { email: string; name: string | null }[];
  } | null,
  slackMsg: { authorSlackUserId: string | null } | null,
): Promise<void> {
  const emailFrom = emailThread?.fromEmail?.toLowerCase() ?? null;
  const emailsTo = (emailThread?.toParticipants ?? []).map((p) => p.email.toLowerCase());
  const slackUser = slackMsg?.authorSlackUserId ?? null;
  const phoneFrom = comm.fromE164 ?? null;
  const phoneTo = comm.toE164 ? [comm.toE164] : [];

  const lookupEmails = [
    ...new Set([emailFrom, ...emailsTo].filter((e): e is string => e !== null)),
  ];
  const lookupSlack = slackUser ? [slackUser] : [];
  const lookupPhones = [...new Set([phoneFrom, ...phoneTo].filter((p): p is string => p !== null))];

  if (lookupEmails.length === 0 && lookupSlack.length === 0 && lookupPhones.length === 0) return;

  const identityRows = await (async () => {
    const results: { contactId: string; normalizedValue: string; kind: string }[] = [];
    if (lookupEmails.length > 0) {
      const rows = await db
        .select({
          contactId: contactIdentities.contactId,
          normalizedValue: contactIdentities.normalizedValue,
          kind: contactIdentities.kind,
        })
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.organizationId, comm.organizationId),
            eq(contactIdentities.kind, 'email'),
            inArray(contactIdentities.normalizedValue, lookupEmails),
          ),
        );
      results.push(...rows);
    }
    if (lookupSlack.length > 0) {
      const rows = await db
        .select({
          contactId: contactIdentities.contactId,
          normalizedValue: contactIdentities.normalizedValue,
          kind: contactIdentities.kind,
        })
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.organizationId, comm.organizationId),
            eq(contactIdentities.kind, 'slack_user'),
            inArray(contactIdentities.normalizedValue, lookupSlack),
          ),
        );
      results.push(...rows);
    }
    if (lookupPhones.length > 0) {
      const rows = await db
        .select({
          contactId: contactIdentities.contactId,
          normalizedValue: contactIdentities.normalizedValue,
          kind: contactIdentities.kind,
        })
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.organizationId, comm.organizationId),
            eq(contactIdentities.kind, 'phone'),
            inArray(contactIdentities.normalizedValue, lookupPhones),
          ),
        );
      results.push(...rows);
    }
    return results;
  })();

  if (identityRows.length === 0) return;

  const contactIds = [...new Set(identityRows.map((r) => r.contactId))];

  const edges = await db
    .select({ subjectId: kgEdges.subjectId, objectId: kgEdges.objectId })
    .from(kgEdges)
    .where(
      and(
        eq(kgEdges.organizationId, comm.organizationId),
        eq(kgEdges.predicate, 'contact_is_party'),
        eq(kgEdges.subjectType, 'contact'),
        inArray(kgEdges.subjectId, contactIds),
      ),
    );

  if (edges.length === 0) return;

  const identityToContact = new Map(identityRows.map((r) => [r.normalizedValue, r.contactId]));
  const contactToParty = new Map(edges.map((e) => [e.subjectId, e.objectId]));

  const fromKey = emailFrom ?? slackUser ?? phoneFrom;
  const fromContactId = fromKey ? (identityToContact.get(fromKey) ?? null) : null;
  const fromPartyId = fromContactId ? (contactToParty.get(fromContactId) ?? null) : null;

  const toKeys = [...emailsTo, ...phoneTo];
  const toPartyIds = toKeys
    .map((k) => {
      const cId = identityToContact.get(k);
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
    .where(eq(communications.id, comm.id));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test --filter web -- apps/web/app/api/queues/embed-communication/route.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass. Check the final count — should be ≥ 240.

- [ ] **Step 6: Run typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/queues/embed-communication/route.ts apps/web/app/api/queues/embed-communication/route.test.ts
git commit -m "feat(embed): phone entity resolution via contact_identities kind=phone (M8 task 3)"
```

---

## Task 4: Final gate — ADR 0008, CLAUDE.md, PR

**Files:**

- Create: `docs/adr/0008-phase-0-month-8-telephony-entity-resolution.md`
- Modify: `CLAUDE.md` (§2 and Changelog)

- [ ] **Step 1: Run full test gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

All must pass. Record the final test count.

- [ ] **Step 2: Write ADR 0008**

Create `docs/adr/0008-phase-0-month-8-telephony-entity-resolution.md` following the ADR 0006/0007 template:

- **Status:** Accepted (shipped 2026-05-23)
- **Context:** M8 closes telephony entity resolution — the final gap in comm→party resolution. M7 wired email + Slack. M8 adds the phone leg.
- **What shipped:** (a) `comms.embed` publish from Twilio webhook; (b) `contact_identities` seeding in `linkContactToParty`; (c) `kind='phone'` lookup in `resolveCommParties` + `identityToContact` Map rename + `fromKey` / `toKeys` generalization.
- **Skipped:** Typesense provisioning (manual ops, runbook exists), Mem0 provisioning (manual ops), recording retention cron (Phase 1), inbound call comm creation (Twilio creates the comm row before the webhook fires — `initiateOutboundCall` handles this; inbound calls from Twilio TwiML webhook are a separate carry-over).
- **Architectural decisions:** (1) Seeding in `linkContactToParty` not at contact creation — YAGNI: contacts only become resolvable when they're linked to a party; seeding at link time ensures the identity is present exactly when it's needed. (2) Unified `identityToContact` Map — by renaming `emailToContact` → `identityToContact`, all three identity kinds (email, Slack, phone) share one resolution path without branching. (3) `fromKey = emailFrom ?? slackUser ?? phoneFrom` — priority order matches communication richness: email has both sender+recipients, Slack has author, phone has E.164 numbers.
- **Carry-overs to M9:** (1) Typesense + Mem0 live provisioning (manual ops runbook). (2) Inbound telephony call comm creation (webhooks for inbound Twilio calls need the same `comms.embed` publish). (3) Recording retention cron. (4) All M2–M7 carry-overs.
- **Test count:** [ACTUAL COUNT] tests across [ACTUAL FILE COUNT] files. All green.
- **References:** Plan at `docs/superpowers/plans/2026-05-23-phase-0-month-8-telephony-entity-resolution.md`; ADRs 0001–0007; spec §6.7 (entity resolution), §8 (telephony).

- [ ] **Step 3: Update CLAUDE.md §2**

Find the `- **Phase:** **Phase 0 Month 7 fully closed out` block and replace it with:

```markdown
- **Phase:** **Phase 0 Month 8 fully closed out (2026-05-23, on `feat/m8-telephony-entity-resolution`); Phase 0 Month 9 is next.** M8 shipped three subsystems: Twilio webhook now publishes `comms.embed` after `telephony.call.ingest` (closes the last publish gap); `linkContactToParty` upserts `contact_identities(kind='email'|'phone')` on every contact→party link (enables entity resolution for that contact's future comms); `resolveCommParties` in embed-communication extended with `kind='phone'` lookup path, unified `identityToContact` Map, and `fromKey = emailFrom ?? slackUser ?? phoneFrom` sender resolution. No new migrations. [ACTUAL COUNT] tests across [ACTUAL FILE COUNT] files. See `docs/adr/0008-phase-0-month-8-telephony-entity-resolution.md`.
- **Next step:** Plan and execute Phase 0 Month 9. Top priority: provision Typesense Cloud + Mem0 API keys in Vercel (runbook: `docs/runbooks/m7-env-var-provisioning.md`).
- **Phase 0 Month 8 carry-overs to M9+ (4 items — see ADR 0008 for full list):**
  1. **Typesense Cloud provisioning:** `TYPESENSE_API_KEY`, `TYPESENSE_HOST` env vars needed in Vercel. `isTypesenseConfigured()` gates all calls.
  2. **Mem0 live provisioning:** `MEM0_API_KEY` env var needed in Vercel. `isMemoryConfigured()` gates all calls.
  3. **Inbound telephony comm creation + embed publish:** Twilio inbound-call webhook creates the comm row; that path also needs `comms.embed`. Carry-over to M9.
  4. **All M2–M7 carry-overs still pending** (see below).
```

Also update the `**Code:**` line to reflect the new test count:

```markdown
- **Code:** 17 workspace packages + 1 Next.js 16 app. Tests: [ACTUAL COUNT] passing across [ACTUAL FILE COUNT] test files (see ADR 0008 §Test count) + 1 Playwright e2e (label-gated). 31 migrations on Neon dev branch (0000–0030). Vercel production + preview deploys both live; CodeRabbit reviewing every PR.
```

Update the M4 carry-over #13:

```markdown
13. **Communication ↔ Party resolution:** Email/Slack/outbound-phone comms now resolved. Inbound phone + SMS still pending — M9+.
```

Update M3 carry-over #8 and M2 carry-over #6 similarly.

Add changelog row:

```
| 2026-05-23 | §2 updated: M8 closed (feat/m8-telephony-entity-resolution), M8 carry-overs listed, next step is M9 | Claude Sonnet 4.6 + Connor |
```

- [ ] **Step 4: Commit ADR + CLAUDE.md**

```bash
git add docs/adr/0008-phase-0-month-8-telephony-entity-resolution.md CLAUDE.md
git commit -m "docs(adr): ADR 0008 + CLAUDE.md close-out for M8 (task 4)"
```

- [ ] **Step 5: Create PR and auto-merge**

```bash
gh pr create \
  --title "feat(m8): telephony entity resolution" \
  --body "$(cat <<'EOF'
## Summary

- Twilio recording webhook publishes \`comms.embed\` alongside \`telephony.call.ingest\` (closes last embed-publish gap)
- \`linkContactToParty\` upserts \`contact_identities(kind='email'|'phone')\` so entity resolution has data to work with
- \`resolveCommParties\` extended with \`kind='phone'\` lookup; unified \`identityToContact\` Map; \`fromKey = emailFrom ?? slackUser ?? phoneFrom\` sender resolution; \`toKeys = [...emailsTo, ...phoneTo]\`
- ADR 0008 + CLAUDE.md updated

## Test plan

- [x] \`pnpm test\` — all tests pass
- [x] \`pnpm typecheck\` — no type errors
- [x] \`pnpm lint\` — no lint errors
- [x] \`pnpm build\` — builds successfully

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then auto-merge:

```bash
gh pr merge <PR_NUMBER> --auto --squash --delete-branch
```

---

## Self-review checklist

**Spec coverage (spec §6.7, §8, §9.1):**

| Requirement                                              | Task                                     |
| -------------------------------------------------------- | ---------------------------------------- |
| `from_party_id` resolved for telephony comms (§6.7)      | Task 1 (publish) + Task 3 (phone lookup) |
| `to_party_ids` resolved for telephony comms (§6.7)       | Task 3 (phone lookup)                    |
| `contact_identities` seeded on contact→party link        | Task 2                                   |
| No new migrations needed (phone E.164 already in schema) | ✓ confirmed                              |

**Placeholder scan:** No TBDs. All code blocks are complete.

**Type consistency:**

- `resolveCommParties` signature: `comm.fromE164` and `comm.toE164` are `string | null` — matches the `communications` schema column type. ✓
- `identityValues` uses `kind: 'email' as const` and `kind: 'phone' as const` — matches the `check` constraint in `contactIdentities`. ✓
- `source: 'party' as const` — matches the `source` check constraint. ✓
- `fromKey = emailFrom ?? slackUser ?? phoneFrom` — all three are `string | null`; `??` chain produces `string | null`. ✓
