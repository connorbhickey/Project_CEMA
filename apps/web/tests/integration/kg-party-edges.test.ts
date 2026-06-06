import { deals, getDb, kgEdges, organizations, parties, users } from '@cema/db';
import { findNeighbors } from '@cema/kg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

let currentClerkOrgId = 'kgpe_org_a';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
}));

const { indexDealPartyEdges } = await import('../../lib/kg/index-deal-party-edges');
const { withRls } = await import('../../lib/with-rls');

// Own namespace: ids `d9e2…`, names `kgpe_…` — every unique-constrained field is
// namespaced + stable so the suite survives the shared Neon dev branch (an id or
// name collision otherwise silently skips an insert via onConflictDoNothing).
const ORG_A = 'd9e20000-0000-0000-0000-0000000000a1';
const ORG_B = 'd9e20000-0000-0000-0000-0000000000b1';
const USER_A = 'd9e20000-0000-0000-0000-0000000000c1';
const DEAL_A = 'd9e20000-0000-0000-0000-0000000000f1';
const PARTY_1 = 'd9e20000-0000-0000-0000-0000000000e1';
const PARTY_2 = 'd9e20000-0000-0000-0000-0000000000e2';

describe.skipIf(skip)('indexDealPartyEdges (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'kgpe_org_a', name: 'KGPE A', slug: 'kgpe-a' },
        { id: ORG_B, clerkOrgId: 'kgpe_org_b', name: 'KGPE B', slug: 'kgpe-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_A, clerkUserId: 'kgpe_user_a', email: 'kgpe-a@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_A,
        organizationId: ORG_A,
        cemaType: 'refi_cema',
        status: 'title_work',
        createdById: USER_A,
      })
      .onConflictDoNothing();
    await db
      .insert(parties)
      .values([
        { id: PARTY_1, dealId: DEAL_A, role: 'borrower' },
        { id: PARTY_2, dealId: DEAL_A, role: 'co_borrower' },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    // Only the per-run edges — never the orgs/users (immutable audit_events FK).
    await db.delete(kgEdges).where(eq(kgEdges.objectId, DEAL_A));
  });

  // The edge is party -> deal; findNeighbors from the deal returns its parties
  // (it traverses edges in both directions, like the deal-graph page).
  const neighbors = (orgId: string) =>
    withRls(orgId, (tx) =>
      findNeighbors(tx, {
        organizationId: orgId,
        nodeId: DEAL_A,
        nodeType: 'deal',
        predicate: 'party_is_on_deal',
      }),
    );

  it('creates one party_is_on_deal edge per party on the deal', async () => {
    currentClerkOrgId = 'kgpe_org_a';
    const count = await indexDealPartyEdges(DEAL_A);
    expect(count).toBe(2);

    const out = await neighbors(ORG_A);
    expect(out.map((n) => n.nodeId).sort()).toEqual([PARTY_1, PARTY_2].sort());
  });

  it('is idempotent — a second run creates no duplicate edges', async () => {
    currentClerkOrgId = 'kgpe_org_a';
    await indexDealPartyEdges(DEAL_A);
    const again = await indexDealPartyEdges(DEAL_A);
    expect(again).toBe(2);

    const out = await neighbors(ORG_A);
    expect(out).toHaveLength(2);
  });

  it('is RLS-isolated — another org cannot traverse the edges', async () => {
    const out = await neighbors(ORG_B);
    expect(out).toHaveLength(0);
  });
});
