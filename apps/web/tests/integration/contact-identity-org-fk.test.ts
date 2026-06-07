/**
 * contact_identities org-integrity (migration 0032).
 *
 * Proves the composite FK contact_identities(contact_id, organization_id) ->
 * contacts(id, organization_id) blocks an identity that references a contact in a
 * DIFFERENT org. This is a real gap RLS alone does NOT close: an INSERT policy
 * only validates the inserted row's own organization_id, so a buggy path running
 * as org B could attach an identity (org_id = B) to org A's contact. The FK check
 * runs below RLS and rejects it because (contactA.id, orgB) is not a real pair in
 * contacts.
 */

import { contactIdentities, contacts, getDb, organizations, users } from '@cema/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

// Distinctive hex namespace ('c0fc' = contact-org-fk) so seeds never collide with
// accumulated rows on the shared Neon dev branch (silent onConflict skips -> 42501).
const ORG_A = 'c0fc0a01-0000-0000-0000-000000000a01';
const ORG_B = 'c0fc0b02-0000-0000-0000-000000000b02';
const USER_ID = 'c0fc05e7-0000-0000-0000-0000000005e7';
const CONTACT_A = 'c0fc0c01-0000-0000-0000-000000000c01';

const skip = !process.env.DATABASE_URL;

describe.skipIf(skip)('contact_identities org-integrity FK', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'org_cofc_a', name: 'CoFc A', slug: 'cofc-a' },
        { id: ORG_B, clerkOrgId: 'org_cofc_b', name: 'CoFc B', slug: 'cofc-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_ID, clerkUserId: 'user_cofc', email: 'cofc@example.invalid' })
      .onConflictDoNothing();
    // A contact owned by ORG_A.
    await withRls(ORG_A, (tx) =>
      tx
        .insert(contacts)
        .values({ id: CONTACT_A, organizationId: ORG_A, primaryEmail: 'a@example.invalid' })
        .onConflictDoNothing(),
    );
  });

  afterAll(async () => {
    const db = getDb();
    // Clean only child rows; leave orgs/users seeded (deleting an org referenced by
    // append-only audit_events from a sibling suite throws FK 23503 — Neon hazard).
    await db.delete(contactIdentities).where(eq(contactIdentities.contactId, CONTACT_A));
    await db.delete(contacts).where(eq(contacts.id, CONTACT_A));
  });

  it('rejects an identity whose org does not match its contact (cross-tenant guard)', async () => {
    // Running as ORG_B, attach an identity to ORG_A's contact. RLS passes (the row's
    // own organization_id is ORG_B), but the composite FK must reject it.
    await expect(
      withRls(ORG_B, (tx) =>
        tx.insert(contactIdentities).values({
          contactId: CONTACT_A,
          organizationId: ORG_B,
          kind: 'email',
          normalizedValue: 'cross@example.invalid',
          source: 'manual',
        }),
      ),
    ).rejects.toThrow();
  });

  it('allows an identity whose org matches its contact', async () => {
    await withRls(ORG_A, (tx) =>
      tx.insert(contactIdentities).values({
        contactId: CONTACT_A,
        organizationId: ORG_A,
        kind: 'email',
        normalizedValue: 'match@example.invalid',
        source: 'manual',
      }),
    );

    const rows = await withRls(ORG_A, (tx) =>
      tx
        .select({ id: contactIdentities.id })
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.contactId, CONTACT_A),
            eq(contactIdentities.normalizedValue, 'match@example.invalid'),
          ),
        ),
    );
    expect(rows).toHaveLength(1);
  });
});
