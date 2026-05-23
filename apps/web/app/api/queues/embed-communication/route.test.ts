import { describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  communications: {},
  emailThreads: {},
  slackMessages: {},
  contactIdentities: {},
  kgEdges: {},
}));
vi.mock('@cema/embeddings', () => ({ embedText: vi.fn() }));
vi.mock('@cema/queues', () => ({
  TopicSchema: {
    'comms.embed': {
      parse: (v: unknown) => v,
    },
  },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), inArray: vi.fn() }));
vi.mock('@cema/typesense', () => ({
  indexCommunication: vi.fn().mockResolvedValue(undefined),
  isTypesenseConfigured: vi.fn().mockReturnValue(true),
}));

import { getDb } from '@cema/db';
import { embedText } from '@cema/embeddings';
import { indexCommunication } from '@cema/typesense';

import { POST } from './route';

function buildDb(
  overrides: {
    selectResult?: unknown[];
    updateResult?: unknown;
  } = {},
) {
  const update = vi.fn().mockReturnValue({
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
    vi.mocked(getDb).mockReturnValue(buildDb({ selectResult: [] }) as never);

    const res = await POST(makeRequest({ orgId: 'org-1', communicationId: 'comm-1' }));
    expect(res.status).toBe(404);
  });

  it('returns 200 and writes embedding', async () => {
    vi.mocked(getDb).mockReturnValue(buildDb({ selectResult: [COMM] }) as never);
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
      buildDb({ selectResult: [{ ...COMM, organizationId: 'org-2' }] }) as never,
    );

    const res = await POST(makeRequest({ orgId: 'org-1', communicationId: 'comm-1' }));
    expect(res.status).toBe(404);
  });

  it('calls indexCommunication after writing embedding', async () => {
    // The route does 3 selects: communications, emailThreads, slackMessages
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([COMM]),
            }),
          }),
        })
        // emailThreads select
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue([{ subject: 'Test Subject', snippet: 'preview text' }]),
            }),
          }),
        })
        // slackMessages select
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    };
    vi.mocked(getDb).mockReturnValue(db as never);
    vi.mocked(embedText).mockResolvedValueOnce({
      embedding: [0.1, 0.2],
      dimensions: 2,
      model: 'text-embedding-3-large',
      inputTokens: 5,
    });

    const res = await POST(makeRequest({ orgId: 'org-1', communicationId: 'comm-1' }));
    expect(res.status).toBe(200);

    // Allow fire-and-forget to resolve
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(indexCommunication)).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'comm-1',
        organization_id: 'org-1',
        kind: 'email',
        subject: 'Test Subject',
        body_preview: 'preview text',
      }),
    );
  });

  it('resolves fromPartyId when email matches a contact identity', async () => {
    const updateMock = vi
      .fn()
      .mockReturnValueOnce({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }) // embedding update
      .mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }); // fromPartyId update

    const selectMock = vi
      .fn()
      // communications select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([COMM]) }),
        }),
      })
      // emailThread select (in Promise.all)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                subject: 'Deal Update',
                snippet: 'snippet',
                fromEmail: 'from@example.com',
                toParticipants: [{ email: 'to@example.com', name: null }],
              },
            ]),
          }),
        }),
      })
      // slackMsg select (in Promise.all)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      })
      // contactIdentities select (email lookup) — no .limit()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi
            .fn()
            .mockResolvedValue([
              { contactId: 'contact-1', normalizedValue: 'from@example.com', kind: 'email' },
            ]),
        }),
      })
      // kgEdges select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ subjectId: 'contact-1', objectId: 'party-1' }]),
        }),
      });

    vi.mocked(getDb).mockReturnValue({ select: selectMock, update: updateMock } as never);
    vi.mocked(embedText).mockResolvedValueOnce({
      embedding: [0.1, 0.2],
      dimensions: 2,
      model: 'text-embedding-3-large',
      inputTokens: 5,
    });

    const res = await POST(makeRequest({ orgId: 'org-1', communicationId: 'comm-1' }));
    expect(res.status).toBe(200);

    // Allow fire-and-forget to complete
    await new Promise((r) => setTimeout(r, 10));

    // Should have called update twice: once for embedding, once for fromPartyId
    expect(updateMock).toHaveBeenCalledTimes(2);
    const secondCall = updateMock.mock.calls[1];
    // Second update is on communications table
    expect(secondCall).toBeDefined();
  });
});
