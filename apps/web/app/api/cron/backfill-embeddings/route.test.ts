import { describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  communications: {},
  documents: {},
  deals: {},
}));
vi.mock('@cema/queues', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('drizzle-orm', () => ({
  isNull: vi.fn().mockReturnValue({}),
  eq: vi.fn().mockReturnValue({}),
}));
vi.mock('@/lib/queue', () => ({
  vercelQueueSend: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from '@cema/db';
import { publish } from '@cema/queues';

import { GET } from './route';

function buildDb(overrides: { commsResult?: unknown[]; docsResult?: unknown[] } = {}) {
  // The route does two selects in Promise.all:
  // 1. communications select: .select().from().where().limit()
  // 2. documents select: .select().from().innerJoin().where().limit()
  const select = vi
    .fn()
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(overrides.commsResult ?? []),
        }),
      }),
    })
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(overrides.docsResult ?? []),
          }),
        }),
      }),
    });
  return { select };
}

describe('GET /api/cron/backfill-embeddings', () => {
  it('returns 200 with zero counts when no rows need embedding', async () => {
    vi.mocked(getDb).mockReturnValue(buildDb() as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { commsQueued: number; docsQueued: number };
    expect(body).toEqual({ commsQueued: 0, docsQueued: 0 });
  });

  it('publishes comms.embed for each communication without embedding', async () => {
    vi.mocked(getDb).mockReturnValue(
      buildDb({
        commsResult: [
          { id: 'comm-1', organizationId: 'org-1' },
          { id: 'comm-2', organizationId: 'org-1' },
        ],
      }) as never,
    );

    const res = await GET();
    expect(res.status).toBe(200);
    expect(vi.mocked(publish)).toHaveBeenCalledWith(
      'comms.embed',
      { orgId: 'org-1', communicationId: 'comm-1' },
      expect.any(Function),
    );
    const body = (await res.json()) as { commsQueued: number; docsQueued: number };
    expect(body.commsQueued).toBe(2);
  });

  it('publishes docs.embed for each document without embedding', async () => {
    vi.mocked(getDb).mockReturnValue(
      buildDb({
        docsResult: [{ id: 'doc-1', organizationId: 'org-1' }],
      }) as never,
    );

    const res = await GET();
    expect(res.status).toBe(200);
    expect(vi.mocked(publish)).toHaveBeenCalledWith(
      'docs.embed',
      { orgId: 'org-1', documentId: 'doc-1' },
      expect.any(Function),
    );
    const body = (await res.json()) as { commsQueued: number; docsQueued: number };
    expect(body.docsQueued).toBe(1);
  });
});
