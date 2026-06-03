import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
}));

vi.mock('@cema/kg', () => ({
  findNeighbors: vi.fn(),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';
import { findNeighbors } from '@cema/kg';

import { withRls } from '../with-rls';

import { getDealGraph } from './get-deal-graph';

const ORG = { id: 'org-1', clerkOrgId: 'clerk-org-1' };

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue({
    query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
  } as never);
  vi.mocked(withRls).mockImplementation((_orgId, fn) => fn({} as never));
  // deal -> two instrument docs; doc-1 -> doc-2 via chain_precedes; doc-2 -> end.
  vi.mocked(findNeighbors).mockImplementation((_tx, input) => {
    if (input.nodeId === 'deal-1') {
      return Promise.resolve([
        { nodeId: 'doc-1', nodeType: 'document', predicate: 'deal_has_instrument' },
        { nodeId: 'doc-2', nodeType: 'document', predicate: 'deal_has_instrument' },
      ] as never);
    }
    if (input.nodeId === 'doc-1' && input.predicate === 'chain_precedes') {
      return Promise.resolve([
        { nodeId: 'doc-2', nodeType: 'document', predicate: 'chain_precedes' },
      ] as never);
    }
    return Promise.resolve([] as never);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getDealGraph', () => {
  it('returns the deal membership edges and the chain_precedes edges', async () => {
    const { edges } = await getDealGraph('deal-1');

    const membership = edges.filter((e) => e.predicate === 'deal_has_instrument');
    expect(membership.map((e) => e.objectId).sort()).toEqual(['doc-1', 'doc-2']);
    expect(membership.every((e) => e.subjectId === 'deal-1' && e.subjectType === 'deal')).toBe(
      true,
    );

    const chain = edges.filter((e) => e.predicate === 'chain_precedes');
    expect(chain).toEqual([
      {
        subjectId: 'doc-1',
        subjectType: 'document',
        predicate: 'chain_precedes',
        objectId: 'doc-2',
        objectType: 'document',
      },
    ]);
  });

  it('starts the traversal from the deal node', async () => {
    await getDealGraph('deal-1');
    expect(findNeighbors).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nodeId: 'deal-1', nodeType: 'deal' }),
    );
  });
});
