import type { InstrumentRecord } from '@cema/collateral';
import {
  chainBreakReviewQueue,
  deals,
  documentReviewQueue,
  documents,
  getDb,
  organizations,
  users,
} from '@cema/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const skip = !process.env.DATABASE_URL;

// Mutable current-org so a single suite can assert cross-org RLS isolation.
let currentClerkOrgId = 'org_review_a';
const currentClerkUser = { id: 'user_review_a' };

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve(currentClerkOrgId),
  getCurrentUser: () => Promise.resolve(currentClerkUser),
}));

// Import the loaders AFTER the mock is registered. Keep relative paths for the
// loaders themselves (matching intake-agent-rls.test.ts); the '@/' alias now
// resolves in vitest via resolve.alias in vitest.config.ts and must remain
// because the loaders transitively import '@/lib/with-rls'.
const { getDealChainFindings } = await import('../../lib/queries/deal-chain-findings');
const { getDealDocumentsReview } = await import('../../lib/queries/deal-documents-review');
const { getDealChainBreakReviews } = await import('../../lib/queries/deal-chain-break-reviews');

const ORG_A = '00000000-0000-0000-0000-0000000000a1';
const ORG_B = '00000000-0000-0000-0000-0000000000b1';
const USER_A = '00000000-0000-0000-0000-000000000a01';
const DEAL_A = '00000000-0000-0000-0000-0000000000e1';
const DOC_MORT = '00000000-0000-0000-0000-0000000000d1';
const DOC_AOM = '00000000-0000-0000-0000-0000000000d2';
const CBR_HASH = 'a1b2c3d4'; // a chain_break_review_queue row keyed on this break

function inst(
  documentId: string,
  instrumentKind: InstrumentRecord['instrumentKind'],
  extra: Partial<InstrumentRecord> = {},
): InstrumentRecord {
  return {
    documentId,
    instrumentKind,
    assignor: null,
    assignee: null,
    executedAt: null,
    recordedAt: null,
    amount: null,
    recordingRef: { reelPage: null, crfn: `crfn-${documentId}` },
    county: null,
    references: null,
    ...extra,
  };
}

describe.skipIf(skip)('deal review surface (Neon integration)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values([
        { id: ORG_A, clerkOrgId: 'org_review_a', name: 'Review A', slug: 'review-a' },
        { id: ORG_B, clerkOrgId: 'org_review_b', name: 'Review B', slug: 'review-b' },
      ])
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_A, clerkUserId: 'user_review_a', email: 'review-a@example.invalid' })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_A,
        organizationId: ORG_A,
        cemaType: 'refi_cema',
        status: 'doc_prep',
        createdById: USER_A,
      })
      .onConflictDoNothing();
    await db
      .insert(documents)
      .values([
        {
          id: DOC_MORT,
          dealId: DEAL_A,
          kind: 'mortgage',
          status: 'draft',
          attorneyReviewRequired: false,
          version: 1,
          extractedData: inst(DOC_MORT, 'mortgage') as unknown as Record<string, unknown>,
        },
        {
          id: DOC_AOM,
          dealId: DEAL_A,
          kind: 'aom',
          status: 'draft',
          attorneyReviewRequired: true,
          version: 1,
          extractedData: inst(DOC_AOM, 'aom', {
            assignor: 'Lender A',
            assignee: 'Lender B',
            recordedAt: '2026-01-01',
          }) as unknown as Record<string, unknown>,
        },
      ])
      .onConflictDoNothing();
    // A persisted attorney_review break for DEAL_A so getDealChainBreakReviews
    // has a row to return (the loader is read-only; the actuator's enqueue is
    // covered by chain-actuators.test.ts).
    await db
      .insert(chainBreakReviewQueue)
      .values({
        organizationId: ORG_A,
        dealId: DEAL_A,
        breakHash: CBR_HASH,
        breakKind: 'lost_note',
        documentId: DOC_MORT,
        reason: 'A promissory note has no anchoring mortgage; attorney review required.',
        submittedById: USER_A,
        state: 'pending',
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    // Only clean queue rows we might have created; leave seed rows in place
    // (onConflictDoNothing makes the suite idempotent across runs).
    await db.delete(documentReviewQueue).where(eq(documentReviewQueue.documentId, DOC_AOM));
    await db.delete(chainBreakReviewQueue).where(eq(chainBreakReviewQueue.breakHash, CBR_HASH));
  });

  it('returns deal-scoped documents, gate-required first, with the AOM instrument', async () => {
    currentClerkOrgId = 'org_review_a';
    const items = await getDealDocumentsReview(DEAL_A);
    expect(items).toHaveLength(2);
    expect(items[0]!.attorneyReviewRequired).toBe(true);
    expect(items[0]!.kind).toBe('aom');
    expect(items[0]!.instrument?.assignee).toBe('Lender B');
    expect(items[1]!.kind).toBe('mortgage');
  });

  it('recomputes a clean chain → advisory_pass', async () => {
    currentClerkOrgId = 'org_review_a';
    const findings = await getDealChainFindings(DEAL_A);
    expect(findings.analyzed).toBe(true);
    expect(findings.status).toBe('clean');
    expect(findings.routes).toHaveLength(1);
    expect(findings.routes[0]!.kind).toBe('advisory_pass');
  });

  it('returns deal-scoped chain-break review rows', async () => {
    currentClerkOrgId = 'org_review_a';
    const rows = await getDealChainBreakReviews(DEAL_A);
    const mine = rows.find((r) => r.breakHash === CBR_HASH);
    expect(mine).toBeDefined();
    expect(mine!.breakKind).toBe('lost_note');
    expect(mine!.state).toBe('pending');
    expect(mine!.reviewerId).toBeNull();
  });

  it('is invisible to another org (RLS isolation)', async () => {
    currentClerkOrgId = 'org_review_b';
    expect(await getDealDocumentsReview(DEAL_A)).toEqual([]);
    expect(await getDealChainFindings(DEAL_A)).toEqual({
      analyzed: false,
      status: null,
      routes: [],
    });
    expect(await getDealChainBreakReviews(DEAL_A)).toEqual([]);
  });
});
