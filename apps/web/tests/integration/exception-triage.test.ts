import { auditEvents, chainBreakReviewQueue, deals, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

let currentClerkOrgId = 'extr_org_a';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
}));

const { getOrgExceptions } = await import('../../lib/agents/exception-triage/get-org-exceptions');

// Own namespace: ids `e2c1…`, names `extr_…` — every unique-constrained field
// namespaced + stable (shared Neon dev branch hazard).
const ORG_A = 'e2c10000-0000-0000-0000-0000000000a1';
const ORG_B = 'e2c10000-0000-0000-0000-0000000000b1';
const USER_A = 'e2c10000-0000-0000-0000-0000000000c1';
const DEAL_CHAIN = 'e2c10000-0000-0000-0000-0000000000f1'; // open chain break
const DEAL_FLAG = 'e2c10000-0000-0000-0000-0000000000f2'; // status = exception
const DEAL_DISPATCH = 'e2c10000-0000-0000-0000-0000000000f3'; // dispatch-failure audit
const DEAL_CLEAN = 'e2c10000-0000-0000-0000-0000000000f4'; // no signals
const DEAL_RECORDING = 'e2c10000-0000-0000-0000-0000000000f5'; // recording.rejected audit
const DEAL_B = 'e2c10000-0000-0000-0000-0000000000fb'; // org B, flagged
const DISPATCH_AUDIT = 'e2c10000-0000-0000-0000-0000000000d1';
const REJECT_AUDIT = 'e2c10000-0000-0000-0000-0000000000d2';
const CHAIN_HASH = 'extr1111';

describe.skipIf(skip)('getOrgExceptions (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'extr_org_a', name: 'EXTR A', slug: 'extr-a' },
        { id: ORG_B, clerkOrgId: 'extr_org_b', name: 'EXTR B', slug: 'extr-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_A, clerkUserId: 'extr_user_a', email: 'extr-a@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values([
        {
          id: DEAL_CHAIN,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'title_work',
          createdById: USER_A,
        },
        {
          id: DEAL_FLAG,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'exception',
          createdById: USER_A,
        },
        {
          id: DEAL_DISPATCH,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'title_work',
          createdById: USER_A,
        },
        {
          id: DEAL_CLEAN,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'title_work',
          createdById: USER_A,
        },
        {
          id: DEAL_RECORDING,
          organizationId: ORG_A,
          cemaType: 'refi_cema',
          status: 'recording',
          createdById: USER_A,
        },
        {
          id: DEAL_B,
          organizationId: ORG_B,
          cemaType: 'refi_cema',
          status: 'exception',
          createdById: USER_A,
        },
      ])
      .onConflictDoNothing();
    await db
      .insert(chainBreakReviewQueue)
      .values({
        organizationId: ORG_A,
        dealId: DEAL_CHAIN,
        breakHash: CHAIN_HASH,
        breakKind: 'lost_note',
        reason: 'extr chain break',
        submittedById: USER_A,
        state: 'pending',
        documentId: null,
      })
      .onConflictDoNothing();
    // audit_events is append-only (no DELETE in afterAll) — fixed id + onConflictDoNothing
    // keeps re-runs from accumulating duplicate dispatch-failure rows.
    await db
      .insert(auditEvents)
      .values({
        id: DISPATCH_AUDIT,
        organizationId: ORG_A,
        actorUserId: USER_A,
        action: 'deal.agent_dispatch_failed',
        entityType: 'deal',
        entityId: DEAL_DISPATCH,
        metadata: { source: 'extr-test' },
      })
      .onConflictDoNothing();
    await db
      .insert(auditEvents)
      .values({
        id: REJECT_AUDIT,
        organizationId: ORG_A,
        actorUserId: USER_A,
        action: 'recording.rejected',
        entityType: 'deal',
        entityId: DEAL_RECORDING,
        metadata: { venue: 'county', reason: 'bad_legal_description' },
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    // Only the chain-break row is safely deletable (audit_events is immutable).
    await db.delete(chainBreakReviewQueue).where(eq(chainBreakReviewQueue.breakHash, CHAIN_HASH));
  });

  const kindFor = (rows: Awaited<ReturnType<typeof getOrgExceptions>>, dealId: string) =>
    rows.find((r) => r.dealId === dealId)?.exceptions.map((e) => e.kind);

  it('classifies each exception signal and excludes the clean deal', async () => {
    currentClerkOrgId = 'extr_org_a';
    const rows = await getOrgExceptions();
    expect(kindFor(rows, DEAL_CHAIN)).toEqual(['chain_break']);
    expect(kindFor(rows, DEAL_FLAG)).toEqual(['deal_flagged_exception']);
    expect(kindFor(rows, DEAL_DISPATCH)).toEqual(['agent_dispatch_failed']);
    expect(kindFor(rows, DEAL_RECORDING)).toEqual(['rejected_recording']);
    expect(rows.some((r) => r.dealId === DEAL_CLEAN)).toBe(false);
    // org B's flagged deal is not visible to org A
    expect(rows.some((r) => r.dealId === DEAL_B)).toBe(false);
  });

  it('is RLS-isolated — org B sees only its own exceptions', async () => {
    currentClerkOrgId = 'extr_org_b';
    const rows = await getOrgExceptions();
    expect(kindFor(rows, DEAL_B)).toEqual(['deal_flagged_exception']);
    expect(rows.some((r) => [DEAL_CHAIN, DEAL_FLAG, DEAL_DISPATCH].includes(r.dealId))).toBe(false);
  });
});
