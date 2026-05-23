import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  documents: { id: 'id_col', dealId: 'deal_id_col' },
  docusignEnvelopes: { documentId: 'doc_id_col', createdAt: 'created_at_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { listEnvelopes } from './list-envelopes';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };
const DEAL_ID = 'deal-uuid-1';

function makeMockTx(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(rows) }),
        }),
      }),
    }),
  };
}

describe('listEnvelopes', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
    } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when organization is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as unknown as ReturnType<typeof getDb>);

    expect(await listEnvelopes(DEAL_ID)).toEqual([]);
  });

  it('flattens join rows to envelope + document pairs', async () => {
    const rows = [
      {
        docusign_envelopes: { id: 'env-1', status: 'sent', documentId: 'doc-1' },
        documents: { id: 'doc-1', dealId: DEAL_ID },
      },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));

    const result = await listEnvelopes(DEAL_ID);
    expect(result).toHaveLength(1);
    expect(result[0]?.envelope.id).toBe('env-1');
    expect(result[0]?.document?.dealId).toBe(DEAL_ID);
  });

  it('returns null document when left-join finds no document row', async () => {
    const rows = [
      {
        docusign_envelopes: { id: 'env-2', status: 'created', documentId: 'doc-2' },
        documents: null,
      },
    ];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));

    const result = await listEnvelopes(DEAL_ID);
    expect(result[0]?.document).toBeNull();
  });

  it('calls withRls with the resolved org id', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx([]) as never));
    await listEnvelopes(DEAL_ID);
    expect(withRls).toHaveBeenCalledWith(ORG.id, expect.any(Function));
  });
});
