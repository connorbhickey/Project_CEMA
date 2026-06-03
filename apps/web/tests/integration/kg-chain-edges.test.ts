import { deals, documents, getDb, kgEdges, organizations, users } from '@cema/db';
import { findNeighbors } from '@cema/kg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

let currentClerkOrgId = 'kgce_org_a';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
}));

const { indexDealChainEdges } = await import('../../lib/kg/index-deal-chain-edges');
const { withRls } = await import('../../lib/with-rls');

// Own namespace: ids `c4a1…`, names `kgce_…` — every unique-constrained field is
// namespaced + stable so the suite survives the shared Neon dev branch.
const ORG_A = 'c4a10000-0000-0000-0000-0000000000a1';
const ORG_B = 'c4a10000-0000-0000-0000-0000000000b1';
const USER_A = 'c4a10000-0000-0000-0000-0000000000c1';
const DEAL_A = 'c4a10000-0000-0000-0000-0000000000f1';
const DOC_AOM_1 = 'c4a10000-0000-0000-0000-0000000000d1';
const DOC_AOM_2 = 'c4a10000-0000-0000-0000-0000000000d2';
const DOC_AOM_3 = 'c4a10000-0000-0000-0000-0000000000d3';
const DOC_MORT = 'c4a10000-0000-0000-0000-0000000000d4'; // anchor — not an assignment
const DOC_PLAIN = 'c4a10000-0000-0000-0000-0000000000d5'; // no InstrumentRecord

// extractedData WITHOUT documentId — the loader stamps documents.id authoritatively.
const instrument = (kind: string, recordedAt: string | null): Record<string, unknown> => ({
  instrumentKind: kind,
  assignor: null,
  assignee: null,
  executedAt: null,
  recordedAt,
  amount: null,
  recordingRef: { reelPage: null, crfn: null },
  county: null,
  references: null,
});

describe.skipIf(skip)('indexDealChainEdges (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'kgce_org_a', name: 'KGCE A', slug: 'kgce-a' },
        { id: ORG_B, clerkOrgId: 'kgce_org_b', name: 'KGCE B', slug: 'kgce-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_A, clerkUserId: 'kgce_user_a', email: 'kgce-a@example.invalid' })
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
      .insert(documents)
      .values([
        // Inserted OUT of recorded order — the sequence is derived from recordedAt.
        {
          id: DOC_AOM_3,
          dealId: DEAL_A,
          kind: 'aom',
          status: 'draft',
          attorneyReviewRequired: true,
          version: 1,
          extractedData: instrument('aom', '2020-03-01'),
        },
        {
          id: DOC_AOM_1,
          dealId: DEAL_A,
          kind: 'aom',
          status: 'draft',
          attorneyReviewRequired: true,
          version: 1,
          extractedData: instrument('aom', '2020-01-01'),
        },
        {
          id: DOC_AOM_2,
          dealId: DEAL_A,
          kind: 'allonge',
          status: 'draft',
          attorneyReviewRequired: true,
          version: 1,
          extractedData: instrument('allonge', '2020-02-01'),
        },
        {
          id: DOC_MORT,
          dealId: DEAL_A,
          kind: 'mortgage',
          status: 'draft',
          attorneyReviewRequired: false,
          version: 1,
          extractedData: instrument('mortgage', '2019-01-01'),
        },
        {
          id: DOC_PLAIN,
          dealId: DEAL_A,
          kind: 'mortgage',
          status: 'draft',
          attorneyReviewRequired: false,
          version: 1,
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // kg_edges is not append-only; clean this suite's exclusive org.
    const db = getDb();
    await db.delete(kgEdges).where(eq(kgEdges.organizationId, ORG_A));
  });

  const nextOf = (orgId: string, docId: string) =>
    withRls(orgId, (tx) =>
      findNeighbors(tx, {
        organizationId: orgId,
        nodeId: docId,
        nodeType: 'document',
        predicate: 'chain_precedes',
      }),
    );

  it('creates a chain_precedes edge per consecutive assignment, in recordedAt order', async () => {
    currentClerkOrgId = 'kgce_org_a';
    const count = await indexDealChainEdges(DEAL_A);
    expect(count).toBe(2);

    expect((await nextOf(ORG_A, DOC_AOM_1)).map((n) => n.nodeId)).toEqual([DOC_AOM_2]);
    expect((await nextOf(ORG_A, DOC_AOM_2)).map((n) => n.nodeId)).toEqual([DOC_AOM_3]);
    expect(await nextOf(ORG_A, DOC_AOM_3)).toHaveLength(0); // last hop
    expect(await nextOf(ORG_A, DOC_MORT)).toHaveLength(0); // anchor is not in the sequence
  });

  it('is idempotent — a second run creates no duplicate edges', async () => {
    currentClerkOrgId = 'kgce_org_a';
    await indexDealChainEdges(DEAL_A);
    const again = await indexDealChainEdges(DEAL_A);
    expect(again).toBe(2);
    expect((await nextOf(ORG_A, DOC_AOM_1)).map((n) => n.nodeId)).toEqual([DOC_AOM_2]);
  });

  it('is RLS-isolated — another org cannot traverse the edges', async () => {
    expect(await nextOf(ORG_B, DOC_AOM_1)).toHaveLength(0);
  });
});
