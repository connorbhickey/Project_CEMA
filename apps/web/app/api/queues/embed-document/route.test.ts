import { describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  documents: {},
  deals: {},
}));
vi.mock('@cema/embeddings', () => ({ embedText: vi.fn() }));
vi.mock('@cema/queues', () => ({
  TopicSchema: {
    'docs.embed': {
      parse: (v: unknown) => v,
    },
  },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

import { getDb } from '@cema/db';
import { embedText } from '@cema/embeddings';

import { POST } from './route';

function makeDb(selectResult: unknown[] = []) {
  const update = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  });
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(selectResult),
        }),
      }),
    }),
  });
  return { select, update };
}

const DOC_ROW = {
  doc: { id: 'doc-1', kind: 'cema_3172', extractedData: { upb: 500000 } },
  dealOrgId: 'org-1',
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/queues/embed-document', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/queues/embed-document', () => {
  it('returns 404 if document not found', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb([]) as never);

    const res = await POST(makeRequest({ orgId: 'org-1', documentId: 'doc-1' }));
    expect(res.status).toBe(404);
  });

  it('returns 200 and writes embedding with extracted data', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb([DOC_ROW]) as never);
    vi.mocked(embedText).mockResolvedValueOnce({
      embedding: [0.3, 0.4],
      dimensions: 2,
      model: 'text-embedding-3-large',
      inputTokens: 10,
    });

    const res = await POST(makeRequest({ orgId: 'org-1', documentId: 'doc-1' }));
    expect(res.status).toBe(200);
    expect(embedText).toHaveBeenCalledWith({
      text: 'cema_3172 {"upb":500000}',
    });
  });

  it('returns 404 if document belongs to different org', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb([{ ...DOC_ROW, dealOrgId: 'org-2' }]) as never);

    const res = await POST(makeRequest({ orgId: 'org-1', documentId: 'doc-1' }));
    expect(res.status).toBe(404);
  });
});
