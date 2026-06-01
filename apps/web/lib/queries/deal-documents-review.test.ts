import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirstOrg = vi.fn();
const findFirstUser = vi.fn();

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: () => Promise.resolve('clerk-org'),
  getCurrentUser: () => Promise.resolve({ id: 'clerk-user' }),
}));

vi.mock('@cema/db', () => ({
  getDb: () => ({
    query: {
      organizations: { findFirst: findFirstOrg },
      users: { findFirst: findFirstUser },
    },
  }),
  documents: {
    id: 'd.id',
    dealId: 'd.dealId',
    kind: 'd.kind',
    status: 'd.status',
    version: 'd.version',
    attorneyReviewRequired: 'd.arr',
    extractedData: 'd.ed',
  },
  documentReviewQueue: {
    id: 'q.id',
    documentId: 'q.docId',
    documentVersion: 'q.docVer',
    state: 'q.state',
    reviewerId: 'q.reviewerId',
  },
  organizations: { clerkOrgId: 'o.clerkOrgId' },
  users: { clerkUserId: 'u.clerkUserId' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (...a: unknown[]) => ({ eq: a }),
  and: (...a: unknown[]) => ({ and: a }),
}));

let joinedRows: unknown[] = [];
vi.mock('@/lib/with-rls', () => ({
  withRls: (_orgId: string, fn: (tx: unknown) => unknown) => {
    const chain = {
      select: () => chain,
      from: () => chain,
      leftJoin: () => chain,
      where: () => Promise.resolve(joinedRows),
    };
    return fn(chain);
  },
}));

import type { DocumentKind, InstrumentRecord } from '@cema/collateral';

import { getDealDocumentsReview } from './deal-documents-review';

function inst(documentId: string, instrumentKind: DocumentKind): InstrumentRecord {
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
  };
}

beforeEach(() => {
  findFirstOrg.mockResolvedValue({ id: 'org-uuid' });
  findFirstUser.mockResolvedValue({ id: 'user-uuid' });
  joinedRows = [];
});

describe('getDealDocumentsReview', () => {
  it('orders gate-required first, then by kind', async () => {
    joinedRows = [
      {
        documentId: 'd2',
        kind: 'note',
        status: 'draft',
        version: 1,
        attorneyReviewRequired: false,
        extractedData: {},
        queueId: null,
        reviewState: null,
        reviewerId: null,
      },
      {
        documentId: 'd1',
        kind: 'aom',
        status: 'attorney_review',
        version: 1,
        attorneyReviewRequired: true,
        extractedData: inst('d1', 'aom'),
        queueId: 'q1',
        reviewState: 'pending',
        reviewerId: null,
      },
    ];
    const items = await getDealDocumentsReview('deal-1');
    expect(items.map((i) => i.documentId)).toEqual(['d1', 'd2']);
    expect(items[0]!.attorneyReviewRequired).toBe(true);
    expect(items[0]!.instrument?.instrumentKind).toBe('aom');
    expect(items[0]!.queueId).toBe('q1');
    expect(items[0]!.reviewState).toBe('pending');
  });

  it('null instrument + null reviewState when unqueued with empty extractedData', async () => {
    joinedRows = [
      {
        documentId: 'd2',
        kind: 'note',
        status: 'draft',
        version: 1,
        attorneyReviewRequired: false,
        extractedData: {},
        queueId: null,
        reviewState: null,
        reviewerId: null,
      },
    ];
    const items = await getDealDocumentsReview('deal-1');
    expect(items[0]!.instrument).toBeNull();
    expect(items[0]!.reviewState).toBeNull();
    expect(items[0]!.queueId).toBeNull();
    expect(items[0]!.reviewerIsCurrentUser).toBe(false);
  });

  it('reviewerIsCurrentUser true only when the queue reviewer matches current user', async () => {
    joinedRows = [
      {
        documentId: 'd1',
        kind: 'aom',
        status: 'attorney_review',
        version: 1,
        attorneyReviewRequired: true,
        extractedData: inst('d1', 'aom'),
        queueId: 'q1',
        reviewState: 'claimed',
        reviewerId: 'user-uuid',
      },
    ];
    const items = await getDealDocumentsReview('deal-1');
    expect(items[0]!.reviewerIsCurrentUser).toBe(true);
  });

  it('reviewerIsCurrentUser false when a different reviewer holds the claim', async () => {
    joinedRows = [
      {
        documentId: 'd1',
        kind: 'aom',
        status: 'attorney_review',
        version: 1,
        attorneyReviewRequired: true,
        extractedData: inst('d1', 'aom'),
        queueId: 'q1',
        reviewState: 'claimed',
        reviewerId: 'someone-else',
      },
    ];
    const items = await getDealDocumentsReview('deal-1');
    expect(items[0]!.reviewerIsCurrentUser).toBe(false);
  });

  it('returns [] when the org cannot be resolved', async () => {
    findFirstOrg.mockResolvedValue(undefined);
    const items = await getDealDocumentsReview('deal-1');
    expect(items).toEqual([]);
  });
});
