/**
 * RLS isolation for M6 tables (kg_edges).
 * Org B cannot see Org A kg_edges rows.
 */
import { getDb, kgEdges, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

const skip = !process.env.DATABASE_URL;

const ORG_A_ID = '00000000-0000-0000-0000-000000000a61';
const ORG_B_ID = '00000000-0000-0000-0000-000000000b61';
const CONTACT_ID = '00000000-0000-0000-0000-000000000c61';
const PARTY_ID = '00000000-0000-0000-0000-000000000d61';

describe.skipIf(skip)('RLS — M6 kg_edges cross-org isolation', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A_ID, clerkOrgId: 'org_m6_rls_a', name: 'Org A (M6)', slug: 'm6-rls-org-a' },
        { id: ORG_B_ID, clerkOrgId: 'org_m6_rls_b', name: 'Org B (M6)', slug: 'm6-rls-org-b' },
      ])
      .onConflictDoNothing();

    await db
      .insert(kgEdges)
      .values({
        organizationId: ORG_A_ID,
        subjectId: CONTACT_ID,
        subjectType: 'contact',
        predicate: 'contact_is_party',
        objectId: PARTY_ID,
        objectType: 'party',
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(kgEdges).where(eq(kgEdges.organizationId, ORG_A_ID));
  });

  it('Org B cannot SELECT Org A kg_edges rows', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx.select({ id: kgEdges.id }).from(kgEdges).where(eq(kgEdges.organizationId, ORG_A_ID)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org A sees its own kg_edges row (positive control)', async () => {
    const rows = await withRls(ORG_A_ID, (tx) =>
      tx.select({ id: kgEdges.id }).from(kgEdges).where(eq(kgEdges.subjectId, CONTACT_ID)),
    );
    expect(rows).toHaveLength(1);
  });
});
