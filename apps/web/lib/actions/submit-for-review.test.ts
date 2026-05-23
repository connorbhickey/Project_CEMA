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
  documents: { id: 'id_col', attorneyReviewRequired: 'arr_col', version: 'ver_col' },
  documentReviewQueue: {
    documentId: 'drq_doc_col',
    documentVersion: 'drq_ver_col',
    organizationId: 'drq_org_col',
    id: 'drq_id_col',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue({}),
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/compliance', () => ({
  emitAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { DocumentNotReviewableError, submitForReview } from './submit-for-review';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };
const USER = { id: 'user-1', clerkUserId: 'clerk-user-1' };

const DOC_REVIEWABLE = {
  id: 'doc-1',
  kind: 'cema_3172',
  attorneyReviewRequired: true,
  version: 1,
  status: 'draft',
};

const DOC_NOT_REVIEWABLE = { ...DOC_REVIEWABLE, attorneyReviewRequired: false };

const QUEUE_ROW = {
  id: 'queue-row-1',
  documentId: 'doc-1',
  documentVersion: 1,
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
        returning: vi.fn().mockResolvedValue([QUEUE_ROW]),
      }),
    }),
  } as unknown as ReturnType<typeof getDb>;
}

// ---------------------------------------------------------------------------
// withRls tx factory helpers
// ---------------------------------------------------------------------------

/**
 * Returns a tx where:
 *   - first  select returns docRows  (document lookup)
 *   - second select returns queueRows (idempotency check)
 *   - insert returns [QUEUE_ROW]
 *   - update resolves void
 */
function makeTxFull(docRows: unknown[], queueRows: unknown[]) {
  let selectCallCount = 0;
  const rowSets = [docRows, queueRows];
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            const rows = rowSets[selectCallCount] ?? [];
            selectCallCount++;
            return Promise.resolve(rows);
          }),
        }),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([QUEUE_ROW]),
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('submitForReview', () => {
  it('throws when org is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: {
        organizations: { findFirst: vi.fn().mockResolvedValue(null) },
        users: { findFirst: vi.fn().mockResolvedValue(USER) },
      },
    } as unknown as ReturnType<typeof getDb>);

    await expect(submitForReview('doc-1')).rejects.toThrow('Organization not found');
  });

  it('throws DocumentNotReviewableError when doc does not require review', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      fn(makeTxFull([DOC_NOT_REVIEWABLE], [])),
    );

    await expect(submitForReview('doc-1')).rejects.toBeInstanceOf(DocumentNotReviewableError);
  });

  it('inserts queue row and flips doc status on happy path', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      // Second select (idempotency check) returns empty → triggers insert
      fn(makeTxFull([DOC_REVIEWABLE], [])),
    );

    const result = await submitForReview('doc-1');
    expect(result.queueId).toBe('queue-row-1');
    expect(result.documentId).toBe('doc-1');
    expect(result.documentVersion).toBe(1);
  });

  it('returns existing queue row without inserting (idempotency)', async () => {
    const existingRow = { id: 'existing-queue-1', documentId: 'doc-1', documentVersion: 1 };
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) =>
      // Second select returns existing row → no insert, returns existing
      fn(makeTxFull([DOC_REVIEWABLE], [existingRow])),
    );

    const result = await submitForReview('doc-1');
    expect(result.queueId).toBe('existing-queue-1');
    expect(result.documentId).toBe('doc-1');
    expect(result.documentVersion).toBe(1);
  });
});
