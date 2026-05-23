import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/integrations-nylas', () => ({
  verifyNylasWebhookSignature: vi.fn(),
  parseNylasWebhookPayload: vi.fn(),
  fetchEmailThread: vi.fn(),
  fetchCalendarEvent: vi.fn(),
  getNylasClient: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  orgNylasConnections: {
    nylasGrantId: 'nylas_grant_id_col',
    organizationId: 'organization_id_col',
    providerType: 'provider_type_col',
  },
  communications: { vendorEventId: 'vendor_event_id_col' },
  emailThreads: { communicationId: 'communication_id_col' },
  calendarEvents: { communicationId: 'communication_id_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/queues', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/queue', () => ({
  vercelQueueSend: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from '@cema/db';
import { parseNylasWebhookPayload, verifyNylasWebhookSignature } from '@cema/integrations-nylas';

const SECRET = 'test-secret';

function makeRequest(body: string, sig: string) {
  return new Request('https://example.com/api/webhooks/nylas', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nylas-signature': sig,
    },
    body,
  });
}

describe('POST /api/webhooks/nylas', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns 500 when NYLAS_WEBHOOK_SECRET is missing', async () => {
    delete process.env.NYLAS_WEBHOOK_SECRET;

    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'any-sig'));
    expect(res.status).toBe(500);
  });

  it('returns 401 when signature verification fails', async () => {
    process.env.NYLAS_WEBHOOK_SECRET = SECRET;
    vi.mocked(verifyNylasWebhookSignature).mockReturnValue(false);

    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'bad-sig'));
    expect(res.status).toBe(401);
  });

  it('returns 200 for an unrecognized trigger type', async () => {
    process.env.NYLAS_WEBHOOK_SECRET = SECRET;
    vi.mocked(verifyNylasWebhookSignature).mockReturnValue(true);
    vi.mocked(parseNylasWebhookPayload).mockReturnValue({
      trigger: 'grant.expired',
      grantId: 'g1',
      objectData: {},
    });

    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ organizationId: 'org-1', providerType: 'gmail' }]),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>);

    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'valid-sig'));
    expect(res.status).toBe(200);
  });

  it('returns 200 when the grant_id is not known to us', async () => {
    process.env.NYLAS_WEBHOOK_SECRET = SECRET;
    vi.mocked(verifyNylasWebhookSignature).mockReturnValue(true);
    vi.mocked(parseNylasWebhookPayload).mockReturnValue({
      trigger: 'message.created',
      grantId: 'unknown-grant',
      objectData: { id: 'msg-1', threadId: 'thread-1' },
    });

    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>);

    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'valid-sig'));
    expect(res.status).toBe(200);
  });

  it('publishes comms.embed after email communication insert', async () => {
    process.env.NYLAS_WEBHOOK_SECRET = SECRET;
    vi.mocked(verifyNylasWebhookSignature).mockReturnValue(true);
    vi.mocked(parseNylasWebhookPayload).mockReturnValue({
      trigger: 'message.created',
      grantId: 'g1',
      objectData: { threadId: 'thread-1' },
    });

    const { fetchEmailThread } = await import('@cema/integrations-nylas');
    vi.mocked(fetchEmailThread).mockResolvedValue({
      nylasThreadId: 'thread-1',
      nylasGrantId: 'g1',
      subject: 'Test',
      snippet: 'snippet',
      fromEmail: 'from@example.com',
      fromName: 'From',
      toParticipants: [{ email: 'to@example.com', name: null }],
      ccParticipants: [],
      bodyHtml: null,
      bodyPlain: 'text',
      messageCount: 1,
      hasAttachments: false,
      nylasAttachmentIds: [],
      firstMessageAt: new Date('2026-01-01'),
      lastMessageAt: new Date('2026-01-01'),
    });

    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ organizationId: 'org-1', providerType: 'gmail' }]),
          }),
        }),
      }),
      insert: vi
        .fn()
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'comm-1', organizationId: 'org-1' }]),
            }),
          }),
        })
        .mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockResolvedValue([]),
          }),
        }),
    } as unknown as ReturnType<typeof getDb>);

    const { publish } = await import('@cema/queues');
    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'valid-sig'));

    expect(res.status).toBe(200);
    expect(vi.mocked(publish)).toHaveBeenCalledWith(
      'comms.embed',
      { orgId: 'org-1', communicationId: 'comm-1' },
      expect.any(Function),
    );
  });

  it('publishes comms.embed after calendar communication insert', async () => {
    process.env.NYLAS_WEBHOOK_SECRET = SECRET;
    vi.mocked(verifyNylasWebhookSignature).mockReturnValue(true);
    vi.mocked(parseNylasWebhookPayload).mockReturnValue({
      trigger: 'event.created',
      grantId: 'g1',
      objectData: { calendarId: 'cal-1', id: 'event-1' },
    });

    const { fetchCalendarEvent } = await import('@cema/integrations-nylas');
    vi.mocked(fetchCalendarEvent).mockResolvedValue({
      nylasEventId: 'event-1',
      nylasCalendarId: 'cal-1',
      nylasGrantId: 'g1',
      title: 'Test Meeting',
      description: null,
      location: null,
      eventStatus: 'confirmed',
      startsAt: new Date('2026-01-01T10:00:00Z'),
      endsAt: new Date('2026-01-01T11:00:00Z'),
      isAllDay: false,
      organizerEmail: 'organizer@example.com',
      organizerName: 'Organizer',
      attendees: [],
    });

    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ organizationId: 'org-1', providerType: 'gmail' }]),
          }),
        }),
      }),
      insert: vi
        .fn()
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'comm-2', organizationId: 'org-1' }]),
            }),
          }),
        })
        .mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockResolvedValue([]),
          }),
        }),
    } as unknown as ReturnType<typeof getDb>);

    const { publish } = await import('@cema/queues');
    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'valid-sig'));

    expect(res.status).toBe(200);
    expect(vi.mocked(publish)).toHaveBeenCalledWith(
      'comms.embed',
      { orgId: 'org-1', communicationId: 'comm-2' },
      expect.any(Function),
    );
  });
});
