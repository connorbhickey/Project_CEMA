import { kgEdges, getDb, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

let currentClerkOrgId = 'dgr_org_a';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
}));

const { getDealGraph } = await import('../../lib/actions/get-deal-graph');

// Own namespace: ids `d6a1…`, names `dgr_…`.
const ORG_A = 'd6a10000-0000-0000-0000-0000000000a1';
const ORG_B = 'd6a10000-0000-0000-0000-0000000000b1';
const DEAL_A = 'd6a10000-0000-0000-0000-0000000000f1';
const DOC_1 = 'd6a10000-0000-0000-0000-0000000000d1';
const DOC_2 = 'd6a10000-0000-0000-0000-0000000000d2';

const edge = (subjectId: string, subjectType: string, predicate: string, objectId: string) => ({
  organizationId: ORG_A,
  subjectId,
  subjectType,
  predicate,
  objectId,
  objectType: 'document',
});

describe.skipIf(skip)('getDealGraph (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'dgr_org_a', name: 'DGR A', slug: 'dgr-a' },
        { id: ORG_B, clerkOrgId: 'dgr_org_b', name: 'DGR B', slug: 'dgr-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(kgEdges)
      .values([
        edge(DEAL_A, 'deal', 'deal_has_instrument', DOC_1),
        edge(DEAL_A, 'deal', 'deal_has_instrument', DOC_2),
        edge(DOC_1, 'document', 'chain_precedes', DOC_2),
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(kgEdges).where(eq(kgEdges.organizationId, ORG_A));
  });

  it('returns the deal membership + the chain_precedes edge', async () => {
    currentClerkOrgId = 'dgr_org_a';
    const { edges } = await getDealGraph(DEAL_A);

    const membership = edges.filter((e) => e.predicate === 'deal_has_instrument');
    expect(membership.map((e) => e.objectId).sort()).toEqual([DOC_1, DOC_2].sort());

    const chain = edges.filter((e) => e.predicate === 'chain_precedes');
    expect(chain).toHaveLength(1);
    expect(chain[0]!.subjectId).toBe(DOC_1);
    expect(chain[0]!.objectId).toBe(DOC_2);
  });

  it('is RLS-isolated — another org sees no edges', async () => {
    currentClerkOrgId = 'dgr_org_b';
    const { edges } = await getDealGraph(DEAL_A);
    expect(edges).toEqual([]);
  });
});
