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
  documentReviewQueue: { id: 'drq_id_col', state: 'drq_state_col', reviewerId: 'drq_reviewer_col' },
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

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { canTransition } from '@cema/attorney';
import { emitAuditEvent } from '@cema/compliance';
import { getDb } from '@cema/db';

import { withRls } from '../with-rls';


import { claimReview } from './claim-review';
import { ReviewClaimError } from './review-errors';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };
const USER = { id: 'user-1', clerkUserId: 'clerk-user-1' };

const QUEUE_ROW = {
  id: 'queue-1',
  state: 'pending',
  reviewerId: null,
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
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
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
  // Restore canTransition default to true after each clearAllMocks()
  vi.mocked(canTransition).mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('claimReview', () => {
  it('throws ReviewClaimError when org is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: {
        organizations: { findFirst: vi.fn().mockResolvedValue(null) },
        users: { findFirst: vi.fn().mockResolvedValue(USER) },
      },
    } as unknown as ReturnType<typeof getDb>);

    const err = await claimReview('queue-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewClaimError);
    expect((err as Error).message).toBe('Organization not found');
  });

  it('throws ReviewClaimError when canTransition returns false (invalid state)', async () => {
    vi.mocked(canTransition).mockReturnValueOnce(false);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith([QUEUE_ROW])));

    const err = await claimReview('queue-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewClaimError);
    expect((err as Error).message).toMatch(/Cannot claim review/);
  });

  it('returns claimed result on happy path', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith([QUEUE_ROW])));

    const result = await claimReview('queue-1');
    expect(result).toEqual({ queueId: 'queue-1', reviewerId: 'user-1', state: 'claimed' });
  });

  it('emits audit event after successful claim', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith([QUEUE_ROW])));

    await claimReview('queue-1');

    expect(emitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'document.review_claimed',
        entityType: 'document_review_queue',
        entityId: 'queue-1',
        metadata: { reviewerId: 'user-1' },
      }),
    );
  });
});
