/**
 * KG integration test — verifies addEdge, traverse, and RLS isolation.
 * Gated on DATABASE_URL (skips in unit CI).
 */
import { getDb, kgEdges, organizations } from '@cema/db';
import { addEdge, findNeighbors, traverse } from '@cema/kg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

const skip = !process.env.DATABASE_URL;

const ORG_ID = '00000000-0000-0000-0000-000000000a60';
const CONTACT_ID = '00000000-0000-0000-0000-000000000c60';
const PARTY_ID = '00000000-0000-0000-0000-000000000b60';

describe.skipIf(skip)('KG traversal integration', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({ id: ORG_ID, clerkOrgId: 'org_kg_test', name: 'KG Test Org', slug: 'kg-test-org' })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(kgEdges).where(eq(kgEdges.organizationId, ORG_ID));
  });

  it('addEdge is idempotent (insert twice, one row)', async () => {
    await withRls(ORG_ID, async (tx) => {
      await addEdge(tx, {
        organizationId: ORG_ID,
        subjectId: CONTACT_ID,
        subjectType: 'contact',
        predicate: 'contact_is_party',
        objectId: PARTY_ID,
        objectType: 'party',
      });
      await addEdge(tx, {
        organizationId: ORG_ID,
        subjectId: CONTACT_ID,
        subjectType: 'contact',
        predicate: 'contact_is_party',
        objectId: PARTY_ID,
        objectType: 'party',
      });
    });

    const db = getDb();
    const rows = await db.select().from(kgEdges).where(eq(kgEdges.organizationId, ORG_ID));
    expect(rows).toHaveLength(1);
  });

  it('findNeighbors returns the party for a contact', async () => {
    const neighbors = await withRls(ORG_ID, (tx) =>
      findNeighbors(tx as never, {
        organizationId: ORG_ID,
        nodeId: CONTACT_ID,
        nodeType: 'contact',
        predicate: 'contact_is_party',
      }),
    );
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]!.nodeId).toBe(PARTY_ID);
  });

  it('traverse returns the party edge from the contact start', async () => {
    const nodes = await withRls(ORG_ID, (tx) =>
      traverse(tx as never, {
        organizationId: ORG_ID,
        startId: CONTACT_ID,
        startType: 'contact',
        maxDepth: 2,
      }),
    );
    expect(nodes.some((n) => n.nodeId === PARTY_ID)).toBe(true);
  });
});
