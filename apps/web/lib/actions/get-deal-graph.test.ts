import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
}));

vi.mock('@cema/kg', () => ({
  traverse: vi
    .fn()
    .mockResolvedValue([{ nodeId: 'party-1', nodeType: 'party', depth: 1, pathFrom: 'deal-1' }]),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';
import { traverse } from '@cema/kg';

import { withRls } from '../with-rls';

import { getDealGraph } from './get-deal-graph';

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue({
    query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
  } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getDealGraph', () => {
  it('calls traverse starting from the deal node', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn({} as never));
    await getDealGraph('deal-1');
    expect(traverse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ startId: 'deal-1', startType: 'deal' }),
    );
  });

  it('returns traversal nodes', async () => {
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn({} as never));
    const result = await getDealGraph('deal-1');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.nodeType).toBe('party');
  });
});
