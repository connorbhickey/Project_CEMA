import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  driveFiles: {
    dealId: 'deal_id_col',
    syncStatus: 'sync_status_col',
    lastSyncedAt: 'last_synced_at_col',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
  or: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { listDriveFiles } from './list-drive-files';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };
const DEAL_ID = 'deal-uuid-1';

function makeMockTx(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(rows) }),
      }),
    }),
  };
}

describe('listDriveFiles', () => {
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

    expect(await listDriveFiles(DEAL_ID)).toEqual([]);
  });

  it('returns files for the deal', async () => {
    const rows = [{ id: 'f-1', dealId: DEAL_ID, fileName: 'payoff.pdf', syncStatus: 'synced' }];
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx(rows) as never));
    const result = await listDriveFiles(DEAL_ID);
    expect(result).toHaveLength(1);
  });

  it('returns empty when no files', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx([]) as never));
    const result = await listDriveFiles(DEAL_ID);
    expect(result).toEqual([]);
  });

  it('calls withRls with the resolved org id', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(makeMockTx([]) as never));
    await listDriveFiles(DEAL_ID);
    expect(withRls).toHaveBeenCalledWith(ORG.id, expect.any(Function));
  });
});
