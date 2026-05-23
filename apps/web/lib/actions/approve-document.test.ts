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
    documentVersion: 'drq_ver_col',
  },
  documents: { id: 'doc_id_col' },
  attorneyApprovals: {},
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

import { ReviewDecisionError, approveDocument } from './approve-document';

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
  documentVersion: 1,
};

const QUEUE_ROW_CLAIMED_BY_OTHER = {
  ...QUEUE_ROW_CLAIMED_BY_USER,
  reviewerId: 'user-other',
};

const APPROVAL_ROW = { id: 'approval-1' };

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

function makeTxWith(queueRows: unknown[], approvalReturn: unknown[] = [APPROVAL_ROW]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(queueRows),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(approvalReturn),
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

describe('approveDocument', () => {
  it('throws ReviewDecisionError when org is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: {
        organizations: { findFirst: vi.fn().mockResolvedValue(null) },
        users: { findFirst: vi.fn().mockResolvedValue(USER) },
      },
    } as unknown as ReturnType<typeof getDb>);

    const err = await approveDocument('queue-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewDecisionError);
    expect((err as Error).message).toBe('Organization not found');
  });

  it('throws ReviewDecisionError when the current user is not the reviewer', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWith([QUEUE_ROW_CLAIMED_BY_OTHER])),
    );

    const err = await approveDocument('queue-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewDecisionError);
    expect((err as Error).message).toMatch(/Only the reviewer/);
  });

  it('throws ReviewDecisionError when canTransition returns false', async () => {
    vi.mocked(canTransition).mockReturnValueOnce(false);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWith([QUEUE_ROW_CLAIMED_BY_USER])),
    );

    const err = await approveDocument('queue-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewDecisionError);
    expect((err as Error).message).toMatch(/Cannot approve/);
  });

  it('inserts attorney_approvals row and returns approvalId on happy path', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWith([QUEUE_ROW_CLAIMED_BY_USER])),
    );

    const result = await approveDocument('queue-1');
    expect(result).toEqual({ queueId: 'queue-1', approvalId: 'approval-1' });
  });

  it('emits audit event with approvalId after successful approval', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxWith([QUEUE_ROW_CLAIMED_BY_USER])),
    );

    await approveDocument('queue-1');

    expect(emitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'document.approved',
        entityType: 'document_review_queue',
        entityId: 'queue-1',
        metadata: { approvalId: 'approval-1' },
      }),
    );
  });
});
