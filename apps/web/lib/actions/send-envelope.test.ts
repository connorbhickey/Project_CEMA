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
  documents: { id: 'id_col' },
  attorneyApprovals: { documentId: 'doc_col', documentVersion: 'ver_col', id: 'aa_id_col' },
  orgDocusignConnections: {
    organizationId: 'org_col',
    connectionStatus: 'status_col',
    createdAt: 'created_col',
  },
  docusignEnvelopes: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/blob', () => ({
  signedDownloadUrl: vi.fn().mockResolvedValue('https://blob.vercel-storage.com/doc.pdf'),
}));

vi.mock('@cema/compliance', () => ({
  emitAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@cema/integrations-docusign', () => ({
  getDocusignClient: vi.fn().mockResolvedValue({}),
  createEnvelope: vi.fn().mockResolvedValue({
    envelopeId: 'ds-env-1',
    status: 'sent',
    uri: '/e',
    statusDateTime: '2026-05-22T15:00:00Z',
  }),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { AttorneyReviewMissingError, sendEnvelope } from './send-envelope';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };
const USER = { id: 'user-1', clerkUserId: 'clerk-user-1' };

const CONN = {
  id: 'conn-1',
  docusignAccountId: 'ACCT',
  docusignBaseUrl: 'https://demo.docusign.net/restapi',
  integrationKey: 'IK',
  docusignUserId: 'U',
  rsaPrivateKey: 'KEY',
};

const DOC_REVIEW_REQUIRED = {
  id: 'doc-1',
  kind: 'cema_3172',
  attorneyReviewRequired: true,
  version: 1,
  blobUrl: 'https://blob.vercel-storage.com/doc.pdf',
};

const DOC_NO_REVIEW = { ...DOC_REVIEW_REQUIRED, attorneyReviewRequired: false };

const VALID_INPUT = {
  documentId: 'doc-1',
  subject: 'Please sign',
  recipients: [{ email: 'b@example.com', name: 'Borrower', role: 'signer' }],
};

// Stub global fetch to return PDF bytes
vi.spyOn(globalThis, 'fetch').mockResolvedValue({
  ok: true,
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
} as unknown as Response);

// ---------------------------------------------------------------------------
// Shared mock-db factory
// ---------------------------------------------------------------------------

function makeDb() {
  return {
    query: {
      organizations: { findFirst: vi.fn().mockResolvedValue(ORG) },
      users: { findFirst: vi.fn().mockResolvedValue(USER) },
    },
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([CONN]),
          }),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'row-1' }]),
      }),
    }),
  } as unknown as ReturnType<typeof getDb>;
}

// ---------------------------------------------------------------------------
// withRls mock helpers
// ---------------------------------------------------------------------------

function makeTxWith(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
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

describe('sendEnvelope — attorney-review gate (Hard rule #2)', () => {
  it('throws AttorneyReviewMissingError when doc requires review and no approval exists', async () => {
    vi.mocked(withRls)
      // First call: fetch the document
      .mockImplementationOnce((_orgId, fn) => fn(makeTxWith([DOC_REVIEW_REQUIRED])))
      // Second call: query for attorney approvals — returns empty
      .mockImplementationOnce((_orgId, fn) => fn(makeTxWith([])));

    await expect(sendEnvelope(VALID_INPUT)).rejects.toBeInstanceOf(AttorneyReviewMissingError);
  });

  it('proceeds when doc requires review AND a matching approval exists', async () => {
    vi.mocked(withRls)
      .mockImplementationOnce((_orgId, fn) => fn(makeTxWith([DOC_REVIEW_REQUIRED])))
      .mockImplementationOnce((_orgId, fn) => fn(makeTxWith([{ id: 'approval-1' }])));

    const res = await sendEnvelope(VALID_INPUT);
    expect(res.docusignEnvelopeId).toBe('ds-env-1');
    expect(res.envelopeRowId).toBe('row-1');
  });

  it('proceeds when doc does NOT require review (skips approval check entirely)', async () => {
    vi.mocked(withRls)
      // Only one withRls call expected — no approval query
      .mockImplementationOnce((_orgId, fn) => fn(makeTxWith([DOC_NO_REVIEW])));

    const res = await sendEnvelope(VALID_INPUT);
    expect(res.docusignEnvelopeId).toBe('ds-env-1');
    // withRls called exactly once (doc fetch only, no approval check)
    expect(withRls).toHaveBeenCalledTimes(1);
  });

  it('throws when the document is not found', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith([])));

    await expect(sendEnvelope(VALID_INPUT)).rejects.toThrow('Document doc-1 not found');
  });

  it('throws DocusignConnectionMissingError when org has no active connection', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeTxWith([DOC_NO_REVIEW])));

    // Override the db mock to return no DocuSign connection
    vi.mocked(getDb).mockReturnValue({
      ...makeDb(),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>);

    const { DocusignConnectionMissingError } = await import('./send-envelope');
    await expect(sendEnvelope(VALID_INPUT)).rejects.toBeInstanceOf(DocusignConnectionMissingError);
  });

  it('throws when org is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: {
        organizations: { findFirst: vi.fn().mockResolvedValue(null) },
        users: { findFirst: vi.fn().mockResolvedValue(USER) },
      },
    } as unknown as ReturnType<typeof getDb>);

    await expect(sendEnvelope(VALID_INPUT)).rejects.toThrow('Organization not found');
  });
});
