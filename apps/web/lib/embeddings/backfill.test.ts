import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  communications: {
    id: 'comm_id_col',
    organizationId: 'org_id_col',
    aiSummary: 'ai_summary_col',
    sourceThreadId: 'source_thread_id_col',
    embedding: 'embedding_col',
    embeddingGeneratedAt: 'embedding_generated_at_col',
  },
  documents: {
    id: 'doc_id_col',
    dealId: 'deal_id_col',
    blobUrl: 'blob_url_col',
    kind: 'kind_col',
    embedding: 'embedding_col',
    embeddingGeneratedAt: 'embedding_generated_at_col',
  },
  deals: { id: 'deals_id_col', organizationId: 'deals_org_id_col' },
}));

vi.mock('@cema/embeddings', () => ({
  embedText: vi.fn().mockResolvedValue({
    embedding: new Array(3072).fill(0.1),
    dimensions: 3072,
    model: 'text-embedding-3-large',
    inputTokens: 4,
  }),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
}));

vi.mock('../with-rls', () => ({ withRls: vi.fn() }));

import { embedText } from '@cema/embeddings';

import { withRls } from '../with-rls';

import { backfillEmbeddings } from './backfill';

const ORG_ID = 'org-uuid-1';

/**
 * Build a mock tx that:
 *   - first .select()…chain resolves to commRows
 *   - second .select()…chain resolves to docRows
 *   - .update()…chain resolves to undefined (fire-and-forget)
 */
function makeMockTx(commRows: unknown[], docRows: unknown[]) {
  let selectCallCount = 0;

  const whereFn = vi.fn().mockImplementation(() => {
    // called at the end of both the comm chain and doc chain
    selectCallCount += 1;
    return Promise.resolve(selectCallCount === 1 ? commRows : docRows);
  });
  const innerJoinFn = vi.fn().mockReturnValue({ where: whereFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn, innerJoin: innerJoinFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  // update chain: .update().set().where() → resolved
  const updateWhereFn = vi.fn().mockResolvedValue(undefined);
  const setFn = vi.fn().mockReturnValue({ where: updateWhereFn });
  const updateFn = vi.fn().mockReturnValue({ set: setFn });

  return { select: selectFn, update: updateFn };
}

describe('backfillEmbeddings', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns all-zero stats when there is no data', async () => {
    const mockTx = makeMockTx([], []);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(mockTx as never));

    const result = await backfillEmbeddings(ORG_ID);

    expect(result).toEqual({
      commsProcessed: 0,
      commsEmbedded: 0,
      docsProcessed: 0,
      docsEmbedded: 0,
      errors: 0,
    });
    expect(embedText).not.toHaveBeenCalled();
  });

  it('embeds a comm that has aiSummary and increments commsEmbedded', async () => {
    const commRows = [{ id: 'comm-1', aiSummary: 'payoff confirmed', sourceThreadId: null }];
    const mockTx = makeMockTx(commRows, []);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(mockTx as never));

    const result = await backfillEmbeddings(ORG_ID);

    expect(result.commsProcessed).toBe(1);
    expect(result.commsEmbedded).toBe(1);
    expect(result.docsProcessed).toBe(0);
    expect(result.errors).toBe(0);
    expect(embedText).toHaveBeenCalledWith({ text: 'payoff confirmed' });
  });

  it('increments errors when embedText throws and continues processing other rows', async () => {
    const commRows = [
      { id: 'comm-fail', aiSummary: 'bad text', sourceThreadId: null },
      { id: 'comm-ok', aiSummary: 'good text', sourceThreadId: null },
    ];

    vi.mocked(embedText)
      .mockRejectedValueOnce(new Error('API rate limit'))
      .mockResolvedValueOnce({
        embedding: new Array<number>(3072).fill(0.2),
        dimensions: 3072,
        model: 'text-embedding-3-large',
        inputTokens: 3,
      });

    const mockTx = makeMockTx(commRows, []);
    vi.mocked(withRls).mockImplementationOnce((_orgId, fn) => fn(mockTx as never));

    const result = await backfillEmbeddings(ORG_ID);

    expect(result.commsProcessed).toBe(2);
    expect(result.commsEmbedded).toBe(1);
    expect(result.errors).toBe(1);
  });
});
