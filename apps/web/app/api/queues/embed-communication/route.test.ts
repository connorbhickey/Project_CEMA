import { describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  communications: {},
}));
vi.mock('@cema/embeddings', () => ({ embedText: vi.fn() }));
vi.mock('@cema/queues', () => ({
  TopicSchema: {
    'comms.embed': {
      parse: (v: unknown) => v,
    },
  },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

import { getDb } from '@cema/db';
import { embedText } from '@cema/embeddings';

import { POST } from './route';

function makeDb(overrides: Partial<ReturnType<typeof buildDb>> = {}) {
  return buildDb(overrides);
}

function buildDb(
  overrides: {
    selectResult?: unknown[];
    updateResult?: unknown;
  } = {},
) {
  const update = vi
    .fn()
    .mockReturnValue({
      set: vi
        .fn()
        .mockReturnValue({ where: vi.fn().mockResolvedValue(overrides.updateResult ?? []) }),
    });
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(overrides.selectResult ?? []),
      }),
    }),
  });
  return { select, update };
}

const COMM = {
  id: 'comm-1',
  organizationId: 'org-1',
  kind: 'email',
  aiSummary: 'payoff summary',
  sourceThreadId: 'thread-1',
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/queues/embed-communication', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/queues/embed-communication', () => {
  it('returns 404 if communication not found', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb({ selectResult: [] }) as never);

    const res = await POST(makeRequest({ orgId: 'org-1', communicationId: 'comm-1' }));
    expect(res.status).toBe(404);
  });

  it('returns 200 and writes embedding', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb({ selectResult: [COMM] }) as never);
    vi.mocked(embedText).mockResolvedValueOnce({
      embedding: [0.1, 0.2],
      dimensions: 2,
      model: 'text-embedding-3-large',
      inputTokens: 5,
    });

    const res = await POST(makeRequest({ orgId: 'org-1', communicationId: 'comm-1' }));
    expect(res.status).toBe(200);
    expect(embedText).toHaveBeenCalledWith({ text: 'payoff summary thread-1 email' });
  });

  it('returns 200 with no-op if comm belongs to different org', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeDb({ selectResult: [{ ...COMM, organizationId: 'org-2' }] }) as never,
    );

    const res = await POST(makeRequest({ orgId: 'org-1', communicationId: 'comm-1' }));
    expect(res.status).toBe(404);
  });
});
