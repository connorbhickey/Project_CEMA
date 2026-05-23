import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  documents: { id: 'id_col' },
  docusignEnvelopes: { documentId: 'doc_id_col', id: 'id_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));
vi.mock('../audit/with-read-audit', () => ({
  withReadAudit: vi.fn().mockImplementation((_input: unknown, fn: () => unknown) => fn()),
}));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { getEnvelope } from './get-envelope';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };
const ENVELOPE_ID = 'env-uuid-1';

function makeMockTx(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
        }),
      }),
    }),
  };
}

describe('getEnvelope', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
    } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when organization is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as unknown as ReturnType<typeof getDb>);

    expect(await getEnvelope(ENVELOPE_ID)).toBeNull();
  });

  it('returns null when no row is found', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx([]) as never));
    expect(await getEnvelope(ENVELOPE_ID)).toBeNull();
  });

  it('returns envelope + document on happy path', async () => {
    const rows = [
      {
        docusign_envelopes: { id: ENVELOPE_ID, status: 'sent', documentId: 'doc-1' },
        documents: { id: 'doc-1', dealId: 'deal-1' },
      },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));

    const result = await getEnvelope(ENVELOPE_ID);
    expect(result?.envelope.id).toBe(ENVELOPE_ID);
    expect(result?.document?.id).toBe('doc-1');
  });

  it('returns null document when left-join finds none', async () => {
    const rows = [
      {
        docusign_envelopes: { id: ENVELOPE_ID, status: 'created', documentId: 'doc-2' },
        documents: null,
      },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));

    const result = await getEnvelope(ENVELOPE_ID);
    expect(result?.document).toBeNull();
  });
});
