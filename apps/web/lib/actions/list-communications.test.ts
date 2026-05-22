import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-123'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  communications: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({
  withRls: vi.fn(),
}));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { listCommunications } from './list-communications';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-123' };
const DEAL_ID = 'deal-uuid-1';

const COMM_PENDING = {
  id: 'comm-uuid-1',
  dealId: DEAL_ID,
  kind: 'call',
  direction: 'outbound',
  medium: 'phone_softphone',
  provider: 'twilio',
  fromE164: '+12125559999',
  toE164: '+12125551234',
  status: 'pending',
  startedAt: null,
  durationSeconds: null,
  createdAt: new Date('2026-05-22T01:00:00Z'),
};

const COMM_READY = {
  id: 'comm-uuid-2',
  dealId: DEAL_ID,
  kind: 'call',
  direction: 'inbound',
  medium: 'phone_softphone',
  provider: 'twilio',
  fromE164: '+12125551234',
  toE164: '+12125559999',
  status: 'ready',
  startedAt: new Date('2026-05-22T00:00:00Z'),
  durationSeconds: 120,
  createdAt: new Date('2026-05-22T00:00:00Z'),
};

function makeMockTx(comms: unknown[] = [COMM_READY, COMM_PENDING]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(comms),
        }),
      }),
    }),
  };
}

describe('listCommunications', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({
      query: {
        organizations: {
          findFirst: vi.fn().mockResolvedValue(ORG),
        },
      },
    } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when organization is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: {
        organizations: { findFirst: vi.fn().mockResolvedValue(null) },
      },
    } as unknown as ReturnType<typeof getDb>);

    const result = await listCommunications(DEAL_ID);
    expect(result).toBeNull();
  });

  it('returns communications list from withRls', async () => {
    const mockTx = makeMockTx();
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(mockTx as never));

    const result = await listCommunications(DEAL_ID);

    expect(result).toHaveLength(2);
  });

  it('calls withRls with the resolved org id', async () => {
    const mockTx = makeMockTx();
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(mockTx as never));

    await listCommunications(DEAL_ID);

    expect(withRls).toHaveBeenCalledWith(ORG.id, expect.any(Function));
  });

  it('returns empty array when deal has no communications', async () => {
    const mockTx = makeMockTx([]);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(mockTx as never));

    const result = await listCommunications(DEAL_ID);

    expect(result).toEqual([]);
  });
});
