import { describe, expect, it, vi } from 'vitest';

import { createConnection, listConnections, revokeConnection } from './connections';

// ---------------------------------------------------------------------------
// Drizzle fluent-API chain mocks (same pattern as @cema/blob recordings.test.ts)
// ---------------------------------------------------------------------------
function makeInsertChain(returning: unknown[]) {
  const valuesChain = { returning: vi.fn().mockResolvedValue(returning) };
  const insert = vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue(valuesChain) });
  return { insert, returning: valuesChain.returning };
}

function makeSelectChain(rows: unknown[]) {
  const whereChain = { where: vi.fn().mockResolvedValue(rows) };
  const fromChain = { from: vi.fn().mockReturnValue(whereChain) };
  const select = vi.fn().mockReturnValue(fromChain);
  return { select, from: fromChain.from, where: whereChain.where };
}

function makeUpdateChain() {
  const whereChain = { where: vi.fn().mockResolvedValue([]) };
  const setChain = { set: vi.fn().mockReturnValue(whereChain) };
  const update = vi.fn().mockReturnValue(setChain);
  return { update, set: setChain.set, where: whereChain.where };
}

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const CONN_ID = '00000000-0000-0000-0000-000000000003';

describe('createConnection', () => {
  it('inserts a row with correct fields and returns the new id', async () => {
    const { insert, returning } = makeInsertChain([{ id: CONN_ID }]);
    const db = { insert } as unknown as Parameters<typeof createConnection>[0];

    const result = await createConnection(db, {
      organizationId: ORG_ID,
      provider: 'ringcentral',
      nangoConnectionId: 'nango-rc-123',
      nangoProviderConfigKey: 'ringcentral',
      createdById: USER_ID,
    });

    expect(insert).toHaveBeenCalledOnce();
    expect(returning).toHaveBeenCalledOnce();
    expect(result.id).toBe(CONN_ID);
  });

  it('passes pending status by default', async () => {
    const valuesCapture = vi
      .fn()
      .mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: CONN_ID }]) });
    const db = {
      insert: vi.fn().mockReturnValue({ values: valuesCapture }),
    } as unknown as Parameters<typeof createConnection>[0];

    await createConnection(db, {
      organizationId: ORG_ID,
      provider: 'dialpad',
      nangoConnectionId: 'nango-dp-456',
      nangoProviderConfigKey: 'dialpad',
      createdById: USER_ID,
    });

    const inserted = valuesCapture.mock.calls[0]?.[0] as unknown as { connectionStatus?: string };
    expect(inserted?.connectionStatus ?? 'pending').toBe('pending');
  });
});

describe('listConnections', () => {
  it('returns connections filtered by orgId', async () => {
    const rows = [
      { id: CONN_ID, organizationId: ORG_ID, provider: 'ringcentral', connectionStatus: 'active' },
    ];
    const { select } = makeSelectChain(rows);
    const db = { select } as unknown as Parameters<typeof listConnections>[0];

    const result = await listConnections(db, { organizationId: ORG_ID });

    expect(select).toHaveBeenCalledOnce();
    expect(result).toEqual(rows);
  });

  it('returns an empty array when no connections exist', async () => {
    const { select } = makeSelectChain([]);
    const db = { select } as unknown as Parameters<typeof listConnections>[0];

    const result = await listConnections(db, { organizationId: ORG_ID });
    expect(result).toEqual([]);
  });
});

describe('revokeConnection', () => {
  it('updates status to revoked and sets revokedAt', async () => {
    const { update, set, where } = makeUpdateChain();
    const db = { update } as unknown as Parameters<typeof revokeConnection>[0];

    await revokeConnection(db, { connectionId: CONN_ID });

    expect(update).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ connectionStatus: 'revoked', revokedAt: expect.any(Date) }),
    );
    expect(where).toHaveBeenCalledOnce();
  });
});
