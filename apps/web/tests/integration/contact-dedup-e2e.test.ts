/**
 * Contact dedup end-to-end (M4 Task 31).
 *
 * Asserts the @cema/contacts ensureContact engine correctly handles
 * normalization and idempotency against the real Neon dev branch.
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

  it('treats bob+notes@x and BOB@x as the same identity', async () => {
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
