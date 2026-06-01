import { chainBreakReviewQueue, deals, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

let currentClerkOrgId = 'cbai2_org_a';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
}));

const { getOrgChainBreakReviews } = await import('../../lib/queries/org-chain-break-reviews');

// Own UUID block + identifier namespace under a distinctive `cba2`/`cbai2`
// (chain-break attorney inbox) prefix. EVERY unique-constrained field (id,
// clerkOrgId, clerkUserId, email, slug) is namespaced and STABLE — on the shared
// Neon dev branch an id collision with another suite (e.g. m5's ORG_B at `…00b8`)
// OR a name collision from a prior run silently skips the insert via
// onConflictDoNothing, leaving findFirst(clerkOrgId) null. Never re-point this block.
const ORG_A = 'cba20000-0000-0000-0000-0000000000a1';
const ORG_B = 'cba20000-0000-0000-0000-0000000000b1';
const USER_A = 'cba20000-0000-0000-0000-0000000000c1';
const DEAL_A1 = 'cba20000-0000-0000-0000-0000000000f1';
const DEAL_A2 = 'cba20000-0000-0000-0000-0000000000f2';
const DEAL_B = 'cba20000-0000-0000-0000-0000000000f3';

describe.skipIf(skip)('cross-deal chain-break review inbox (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'cbai2_org_a', name: 'CBAI2 A', slug: 'cbai2-a' },
        { id: ORG_B, clerkOrgId: 'cbai2_org_b', name: 'CBAI2 B', slug: 'cbai2-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_A, clerkUserId: 'cbai2_user_a', email: 'cbai2-a@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values([
        {
          id: DEAL_A1,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'title_work',
          createdById: USER_A,
        },
        {
          id: DEAL_A2,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'attorney_review',
          createdById: USER_A,
        },
        {
          id: DEAL_B,
          organizationId: ORG_B,
          cemaType: 'refi_cema',
          status: 'title_work',
          createdById: USER_A,
        },
      ])
      .onConflictDoNothing();
    // documentId null (the FK is nullable; some breaks have no single document).
    await db
      .insert(chainBreakReviewQueue)
      .values([
        {
          organizationId: ORG_A,
          dealId: DEAL_A1,
          breakHash: 'aaaa1111',
          breakKind: 'lost_note',
          reason: 'inbox-r1',
          submittedById: USER_A,
          state: 'pending',
          documentId: null,
        },
        {
          organizationId: ORG_A,
          dealId: DEAL_A2,
          breakHash: 'aaaa2222',
          breakKind: 'ambiguous_assignment',
          reason: 'inbox-r2',
          submittedById: USER_A,
          state: 'claimed',
          reviewerId: USER_A,
          documentId: null,
        },
        {
          organizationId: ORG_A,
          dealId: DEAL_A1,
          breakHash: 'aaaa3333',
          breakKind: 'unrecorded_instrument',
          reason: 'inbox-r3',
          submittedById: USER_A,
          state: 'resolved',
          documentId: null,
        },
        {
          organizationId: ORG_B,
          dealId: DEAL_B,
          breakHash: 'bbbb1111',
          breakKind: 'lost_note',
          reason: 'inbox-rb',
          submittedById: USER_A,
          state: 'pending',
          documentId: null,
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    for (const h of ['aaaa1111', 'aaaa2222', 'aaaa3333', 'bbbb1111']) {
      await db.delete(chainBreakReviewQueue).where(eq(chainBreakReviewQueue.breakHash, h));
    }
  });

  it('lists open chain breaks across deals for the org (excludes terminal)', async () => {
    currentClerkOrgId = 'cbai2_org_a';
    const items = await getOrgChainBreakReviews({ stateFilter: 'open' });
    const mine = items.filter((i) => i.reason.startsWith('inbox-r'));
    expect(mine.map((i) => i.reason).sort()).toEqual(['inbox-r1', 'inbox-r2']);
    expect(mine.every((i) => i.state === 'pending' || i.state === 'claimed')).toBe(true);
    // the join populates the deal status for context
    expect(mine.find((i) => i.reason === 'inbox-r2')?.dealStatus).toBe('attorney_review');
  });

  it('includes terminal rows with stateFilter "all"', async () => {
    currentClerkOrgId = 'cbai2_org_a';
    const all = await getOrgChainBreakReviews({ stateFilter: 'all' });
    const mine = all.filter((i) => i.reason.startsWith('inbox-r'));
    expect(mine.map((i) => i.reason).sort()).toEqual(['inbox-r1', 'inbox-r2', 'inbox-r3']);
  });

  it('is isolated by org (RLS) — org B never sees org A rows', async () => {
    currentClerkOrgId = 'cbai2_org_b';
    const items = await getOrgChainBreakReviews({ stateFilter: 'all' });
    expect(items.some((i) => ['inbox-r1', 'inbox-r2', 'inbox-r3'].includes(i.reason))).toBe(false);
    expect(items.some((i) => i.reason === 'inbox-rb')).toBe(true);
  });
});
