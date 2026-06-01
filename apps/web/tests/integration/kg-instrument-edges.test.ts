import { deals, documents, getDb, kgEdges, organizations, users } from '@cema/db';
import { findNeighbors } from '@cema/kg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

let currentClerkOrgId = 'kgie_org_a';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
}));

const { indexDealInstrumentEdges } = await import('../../lib/kg/index-deal-instrument-edges');
const { withRls } = await import('../../lib/with-rls');

// Own namespace: ids `d9e1…`, names `kgie_…` — every unique-constrained field is
// namespaced + stable so the suite survives the shared Neon dev branch (an id or
// name collision otherwise silently skips an insert via onConflictDoNothing).
const ORG_A = 'd9e10000-0000-0000-0000-0000000000a1';
const ORG_B = 'd9e10000-0000-0000-0000-0000000000b1';
const USER_A = 'd9e10000-0000-0000-0000-0000000000c1';
const DEAL_A = 'd9e10000-0000-0000-0000-0000000000f1';
const DOC_INST_1 = 'd9e10000-0000-0000-0000-0000000000d1';
const DOC_INST_2 = 'd9e10000-0000-0000-0000-0000000000d2';
const DOC_PLAIN = 'd9e10000-0000-0000-0000-0000000000d3';

const instrument = (kind: string): Record<string, unknown> => ({
  instrumentKind: kind,
  assignor: null,
  assignee: null,
  executedAt: null,
  recordedAt: null,
  amount: null,
  recordingRef: { reelPage: null, crfn: null },
  county: null,
  references: null,
});

describe.skipIf(skip)('indexDealInstrumentEdges (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'kgie_org_a', name: 'KGIE A', slug: 'kgie-a' },
        { id: ORG_B, clerkOrgId: 'kgie_org_b', name: 'KGIE B', slug: 'kgie-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_A, clerkUserId: 'kgie_user_a', email: 'kgie-a@example.invalid' })
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
        {
          id: DOC_INST_1,
          dealId: DEAL_A,
          kind: 'mortgage',
          status: 'draft',
          attorneyReviewRequired: false,
          version: 1,
          extractedData: instrument('mortgage'),
        },
        {
          id: DOC_INST_2,
          dealId: DEAL_A,
          kind: 'aom',
          status: 'draft',
          // aom is a gate-required kind (documents_attorney_gate_required CHECK).
          attorneyReviewRequired: true,
          version: 1,
          extractedData: instrument('aom'),
        },
        // Not an instrument (no extractedData InstrumentRecord) — must NOT get an
        // edge, even though its kind looks instrument-like. The edge keys off the
        // persisted InstrumentRecord, not the document kind.
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
    const db = getDb();
    await db.delete(kgEdges).where(eq(kgEdges.subjectId, DEAL_A));
  });

  const neighbors = (orgId: string) =>
    withRls(orgId, (tx) =>
      findNeighbors(tx, {
        organizationId: orgId,
        nodeId: DEAL_A,
        nodeType: 'deal',
        predicate: 'deal_has_instrument',
      }),
    );

  it('creates one deal_has_instrument edge per instrument doc (and none for a plain doc)', async () => {
    currentClerkOrgId = 'kgie_org_a';
    const count = await indexDealInstrumentEdges(DEAL_A);
    expect(count).toBe(2);

    const out = await neighbors(ORG_A);
    expect(out.map((n) => n.nodeId).sort()).toEqual([DOC_INST_1, DOC_INST_2].sort());
    expect(out.map((n) => n.nodeId)).not.toContain(DOC_PLAIN);
  });

  it('is idempotent — a second run creates no duplicate edges', async () => {
    currentClerkOrgId = 'kgie_org_a';
    await indexDealInstrumentEdges(DEAL_A);
    const again = await indexDealInstrumentEdges(DEAL_A);
    expect(again).toBe(2);

    const out = await neighbors(ORG_A);
    expect(out).toHaveLength(2);
  });

  it('is RLS-isolated — another org cannot traverse the edges', async () => {
    const out = await neighbors(ORG_B);
    expect(out).toHaveLength(0);
  });
});
