import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// All vi.mock() calls are hoisted by Vitest before imports.
// ---------------------------------------------------------------------------

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  users: {},
  documents: { id: 'doc_id_col' },
  documentReviewQueue: {
    organizationId: 'drq_org_col',
    state: 'drq_state_col',
    submittedAt: 'drq_submitted_col',
    documentId: 'drq_doc_col',
    submittedById: 'drq_submitter_col',
    reviewerId: 'drq_reviewer_col',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  or: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { listReviewQueue } from './list-review-queue';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };

const PENDING_QUEUE_ROW = {
  id: 'queue-1',
  state: 'pending',
  submittedById: 'user-1',
  reviewerId: null,
  organizationId: 'org-1',
  documentId: 'doc-1',
};

const CLAIMED_QUEUE_ROW = {
  id: 'queue-2',
  state: 'claimed',
  submittedById: 'user-1',
  reviewerId: 'user-2',
  organizationId: 'org-1',
  documentId: 'doc-2',
};

const DOC = { id: 'doc-1', kind: 'cema_3172' };
const USER_1 = { id: 'user-1', clerkUserId: 'clerk-user-1' };
const USER_2 = { id: 'user-2', clerkUserId: 'clerk-user-2' };

// ---------------------------------------------------------------------------
// withRls tx factory helpers
// ---------------------------------------------------------------------------

function makeTxWithRows(
  rows: Array<{ queue: Record<string, unknown>; document: Record<string, unknown> | null }>,
  userRows: unknown[] = [],
) {
  let callCount = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First select: the main queue + document join query
        return {
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue(rows),
                }),
              }),
            }),
          }),
        };
      }
      // Second select: users lookup
      return {
        from: vi.fn().mockResolvedValue(userRows),
      };
    }),
  } as never;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue({
    query: {
      organizations: { findFirst: vi.fn().mockResolvedValue(ORG) },
    },
  } as unknown as ReturnType<typeof getDb>);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('listReviewQueue', () => {
  it('returns empty array when organization is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: {
        organizations: { findFirst: vi.fn().mockResolvedValue(null) },
      },
    } as unknown as ReturnType<typeof getDb>);

    const result = await listReviewQueue();
    expect(result).toEqual([]);
    expect(withRls).not.toHaveBeenCalled();
  });

  it('returns only pending rows when stateFilter is "pending"', async () => {
    const rows = [{ queue: PENDING_QUEUE_ROW, document: DOC }];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWithRows(rows, [USER_1])),
    );

    const result = await listReviewQueue({ stateFilter: 'pending' });
    expect(result).toHaveLength(1);
    expect(result[0]?.queue.state).toBe('pending');
    expect(result[0]?.submittedBy?.id).toBe('user-1');
    expect(result[0]?.reviewer).toBeNull();
  });

  it('returns both pending and claimed rows when stateFilter is "all"', async () => {
    const rows = [
      { queue: PENDING_QUEUE_ROW, document: DOC },
      { queue: CLAIMED_QUEUE_ROW, document: null },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWithRows(rows, [USER_1, USER_2])),
    );

    const result = await listReviewQueue({ stateFilter: 'all' });
    expect(result).toHaveLength(2);
    expect(result[0]?.queue.state).toBe('pending');
    expect(result[1]?.queue.state).toBe('claimed');
    expect(result[1]?.reviewer?.id).toBe('user-2');
  });
});
