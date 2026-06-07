/**
 * pgvector fuzzy contact dedup (migration 0033, spec §9.1).
 *
 * Proves ensureContact's similarity pass against REAL pgvector cosine distance:
 * a contact whose normalized email differs but whose name/employer embedding is
 * near an existing contact collapses onto it instead of creating a duplicate;
 * a far embedding creates a fresh contact. Uses synthetic unit vectors (no OpenAI
 * dependency) — the threshold logic + the <=> operator are what's under test.
 */

import { ensureContact } from '@cema/contacts';
import { contactIdentities, contacts, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

// Distinctive hex namespace ('c7ec' = contact-pgvector-embedding) so seeds never
// collide with accumulated rows on the shared Neon dev branch.
const ORG_ID = 'c7ec0a01-0000-0000-0000-000000000a01';
const USER_ID = 'c7ec05e7-0000-0000-0000-0000000005e7';

/** A 3072-dim unit vector hot at one index (matches contacts.embedding's vector(3072)). */
function unitVector(hotIndex: number): number[] {
  const v = new Array<number>(3072).fill(0);
  v[hotIndex] = 1;
  return v;
}

const BASE = unitVector(0);
// NEAR: BASE plus a tiny perpendicular nudge -> cosine distance ~0.00005 (< 0.15).
const NEAR = (() => {
  const v = unitVector(0);
  v[1] = 0.01;
  return v;
})();
// FAR: orthogonal to BASE -> cosine distance = 1 (>> 0.15).
const FAR = unitVector(1);

const skip = !process.env.DATABASE_URL;

describe.skipIf(skip)('pgvector fuzzy contact dedup', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({ id: ORG_ID, clerkOrgId: 'org_c7ec', name: 'C7ec', slug: 'c7ec' })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_ID, clerkUserId: 'user_c7ec', email: 'c7ec@example.invalid' })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    // Clean child rows; leave org/user seeded (Neon hazard: deleting an audited org throws).
    await db.delete(contactIdentities).where(eq(contactIdentities.organizationId, ORG_ID));
    await db.delete(contacts).where(eq(contacts.organizationId, ORG_ID));
  });

  it('collapses a near-duplicate (different email, near embedding) onto the existing contact', async () => {
    const first = await withRls(ORG_ID, (tx) =>
      ensureContact(tx, {
        orgId: ORG_ID,
        kind: 'email',
        value: 'robert.smith@firm-a.invalid',
        source: 'manual',
        sourceId: null,
        name: 'Robert Smith',
        employer: 'Acme Title',
        embedding: BASE,
      }),
    );
    expect(first?.created).toBe(true);
    expect(first?.matchedBy).toBe('created');

    // Same person, different email -> exact-miss, but the NEAR embedding matches.
    const second = await withRls(ORG_ID, (tx) =>
      ensureContact(tx, {
        orgId: ORG_ID,
        kind: 'email',
        value: 'bob.smith@personal.invalid',
        source: 'manual',
        sourceId: null,
        name: 'Bob Smith',
        employer: 'Acme Title',
        embedding: NEAR,
      }),
    );
    expect(second?.created).toBe(false);
    expect(second?.matchedBy).toBe('similarity');
    expect(second?.contactId).toBe(first?.contactId);
  });

  it('creates a fresh contact when the embedding is far from every existing one', async () => {
    const before = await withRls(ORG_ID, (tx) =>
      ensureContact(tx, {
        orgId: ORG_ID,
        kind: 'email',
        value: 'seed@firm-a.invalid',
        source: 'manual',
        sourceId: null,
        name: 'Seed Person',
        embedding: BASE,
      }),
    );

    const far = await withRls(ORG_ID, (tx) =>
      ensureContact(tx, {
        orgId: ORG_ID,
        kind: 'email',
        value: 'alice.jones@firm-b.invalid',
        source: 'manual',
        sourceId: null,
        name: 'Alice Jones',
        embedding: FAR,
      }),
    );
    expect(far?.created).toBe(true);
    expect(far?.matchedBy).toBe('created');
    expect(far?.contactId).not.toBe(before?.contactId);
  });
});
