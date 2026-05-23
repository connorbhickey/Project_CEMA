import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/auth', () => ({
  getCurrentOrganizationId: vi.fn().mockResolvedValue('clerk-org-1'),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  organizations: {},
  communications: {
    id: 'id_col',
    organizationId: 'org_id_col',
    embedding: 'embedding_col',
    aiSummary: 'ai_summary_col',
    sourceThreadId: 'source_thread_id_col',
  },
  documents: {
    id: 'id_col',
    embedding: 'embedding_col',
    blobUrl: 'blob_url_col',
    kind: 'kind_col',
    dealId: 'deal_id_col',
  },
  deals: { id: 'id_col', organizationId: 'org_id_col' },
}));

vi.mock('@cema/embeddings', () => ({
  embedText: vi
    .fn()
    .mockResolvedValue({
      embedding: new Array(3072).fill(0),
      dimensions: 3072,
      model: 'text-embedding-3-large',
      inputTokens: 5,
    }),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
  sql: Object.assign(vi.fn().mockReturnValue({}), {
    raw: vi.fn().mockReturnValue({}),
  }),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { getDb } from '@cema/db';

import { withRls } from '../with-rls';

import { searchSimilar } from './search-similar';

const ORG = { id: 'org-uuid-1', clerkOrgId: 'clerk-org-1' };

// Builder that resolves to commRows then docRows on successive .limit() calls.
function makeQueryBuilder(commRows: unknown[], docRows: unknown[]) {
  let callCount = 0;
  const limitFn = vi.fn().mockImplementation(() => {
    callCount += 1;
    return Promise.resolve(callCount === 1 ? commRows : docRows);
  });
  const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
  const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
  const innerJoinFn = vi.fn().mockReturnValue({ where: whereFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn, innerJoin: innerJoinFn });
  return {
    select: vi.fn().mockReturnValue({ from: fromFn }),
  };
}

describe('searchSimilar', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(ORG) } },
    } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when query is blank', async () => {
    expect(await searchSimilar({ query: '' })).toEqual([]);
    expect(await searchSimilar({ query: '   ' })).toEqual([]);
  });

  it('returns empty array when org is not found', async () => {
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as unknown as ReturnType<typeof getDb>);

    expect(await searchSimilar({ query: 'payoff letter' })).toEqual([]);
  });

  it('returns merged top-k results sorted by distance', async () => {
    const commRows = [
      { id: 'comm-1', aiSummary: 'payoff summary', sourceThreadId: null, distance: 0.3 },
      { id: 'comm-2', aiSummary: null, sourceThreadId: 'thread-abc', distance: 0.8 },
    ];
    const docRows = [
      { id: 'doc-1', blobUrl: 'https://blob/file.pdf', kind: 'cema_3172', distance: 0.1 },
      { id: 'doc-2', blobUrl: null, kind: 'gap_note', distance: 0.5 },
    ];

    const mockTx = makeQueryBuilder(commRows, docRows);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(mockTx as never));

    const results = await searchSimilar({ query: 'payoff letter', kind: 'all', k: 4 });

    expect(results).toHaveLength(4);
    // Sorted ascending by cosineDistance
    expect(results[0]).toMatchObject({ kind: 'document', id: 'doc-1', cosineDistance: 0.1 });
    expect(results[1]).toMatchObject({ kind: 'communication', id: 'comm-1', cosineDistance: 0.3 });
    expect(results[2]).toMatchObject({ kind: 'document', id: 'doc-2', cosineDistance: 0.5 });
    expect(results[3]).toMatchObject({ kind: 'communication', id: 'comm-2', cosineDistance: 0.8 });

    // Verify preview fall-through
    expect(results[0]!.preview).toBe('https://blob/file.pdf');
    expect(results[1]!.preview).toBe('payoff summary');
    expect(results[2]!.preview).toBe('gap_note');
    expect(results[3]!.preview).toBe('thread-abc');

    // Similarity = 1 - distance/2
    expect(results[0]!.similarity).toBeCloseTo(1 - 0.1 / 2);
  });
});
