import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// All vi.mock() calls are hoisted by Vitest before imports.
// ---------------------------------------------------------------------------

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'clerk-user-1' }),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  users: {},
  documentReviewQueue: {
    id: 'drq_id_col',
    state: 'drq_state_col',
    reviewerId: 'drq_reviewer_col',
    documentId: 'drq_doc_col',
  },
  documents: { id: 'doc_id_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/attorney', () => ({
  canTransition: vi.fn().mockReturnValue(true),
}));

vi.mock('@cema/compliance', () => ({
  emitAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

// Mock review-errors so reject-document (which imports ReviewDecisionError
// from ./review-errors) uses a predictable class in tests.
vi.mock('./review-errors', () => ({
  ReviewDecisionError: class ReviewDecisionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ReviewDecisionError';
    }
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { canTransition } from '@cema/attorney';
import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { rejectDocument } from './reject-document';
import { ReviewDecisionError } from './review-errors';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };
const USER = { id: 'user-1', clerkUserId: 'clerk-user-1' };

const QUEUE_ROW_CLAIMED_BY_USER = {
  id: 'queue-1',
  state: 'claimed',
  reviewerId: 'user-1',
  documentId: 'doc-1',
};

const QUEUE_ROW_CLAIMED_BY_OTHER = {
  ...QUEUE_ROW_CLAIMED_BY_USER,
  reviewerId: 'user-other',
};

// ---------------------------------------------------------------------------
// Shared mock-db factory
// ---------------------------------------------------------------------------

function makeDb() {
  return {
    query: {
      organizations: { findFirst: vi.fn().mockResolvedValue(ORG) },
      users: { findFirst: vi.fn().mockResolvedValue(USER) },
    },
  } as unknown as ReturnType<typeof getDb>;
}

// ---------------------------------------------------------------------------
// withRls tx factory helpers
// ---------------------------------------------------------------------------

function makeTxWith(queueRows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(queueRows),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  } as never;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue(makeDb());
  vi.mocked(canTransition).mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('rejectDocument', () => {
  it('throws ReviewDecisionError when reason is empty or whitespace', async () => {
    await expect(rejectDocument('queue-1', '')).rejects.toBeInstanceOf(ReviewDecisionError);
    await expect(rejectDocument('queue-1', '   ')).rejects.toThrow('Rejection reason is required');
  });

  it('throws ReviewDecisionError when the current user is not the reviewer', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWith([QUEUE_ROW_CLAIMED_BY_OTHER])),
    );

    const err = await rejectDocument('queue-1', 'missing docs').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewDecisionError);
    expect((err as Error).message).toMatch(/Only the reviewer/);
  });

  it('throws ReviewDecisionError when canTransition returns false', async () => {
    vi.mocked(canTransition).mockReturnValueOnce(false);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWith([QUEUE_ROW_CLAIMED_BY_USER])),
    );

    const err = await rejectDocument('queue-1', 'missing docs').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewDecisionError);
    expect((err as Error).message).toMatch(/Cannot reject/);
  });

  it('updates queue state to rejected and returns queueId on happy path', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWith([QUEUE_ROW_CLAIMED_BY_USER])),
    );

    const result = await rejectDocument('queue-1', 'Signature missing on page 3');
    expect(result).toEqual({ queueId: 'queue-1' });
  });
});
