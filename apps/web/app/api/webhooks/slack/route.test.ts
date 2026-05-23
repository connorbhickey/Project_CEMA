import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/integrations-slack', () => ({
  verifySlackSignature: vi.fn(),
  parseSlackEventPayload: vi.fn(),
  parseSlackSlashCommand: vi.fn(),
  getSlackClient: vi.fn().mockReturnValue({}),
  fetchSlackUserDisplayName: vi.fn().mockResolvedValue('connor'),
  postEphemeralReply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  orgSlackConnections: {
    slackTeamId: 'team_col',
    organizationId: 'org_col',
    slackBotToken: 'tok_col',
  },
  communications: { vendorEventId: 'vendor_event_col' },
  slackMessages: { communicationId: 'comm_id_col' },
  deals: { id: 'id_col', organizationId: 'org_col', status: 'status_col' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}));

vi.mock('@cema/queues', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/queue', () => ({
  vercelQueueSend: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from '@cema/db';
import { parseSlackEventPayload, verifySlackSignature } from '@cema/integrations-slack';

const SECRET = 'test-secret';

function makeRequest(body: string, sig: string, ts: string, contentType = 'application/json') {
  return new Request('https://example.com/api/webhooks/slack', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-slack-signature': sig,
      'x-slack-request-timestamp': ts,
    },
    body,
  });
}

describe('POST /api/webhooks/slack', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns 500 when SLACK_SIGNING_SECRET is missing', async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'v0=x', '1716000000'));
    expect(res.status).toBe(500);
  });

  it('returns 401 when signature verification fails', async () => {
    process.env.SLACK_SIGNING_SECRET = SECRET;
    vi.mocked(verifySlackSignature).mockReturnValue(false);
    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'v0=bad', '1716000000'));
    expect(res.status).toBe(401);
  });

  it('responds to a url_verification challenge', async () => {
    process.env.SLACK_SIGNING_SECRET = SECRET;
    vi.mocked(verifySlackSignature).mockReturnValue(true);
    vi.mocked(parseSlackEventPayload).mockReturnValue({
      type: 'url_verification',
      token: 'tok',
      challenge: 'CHALLENGE-1234',
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest('{}', 'v0=ok', '1716000000'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge: string };
    expect(body.challenge).toBe('CHALLENGE-1234');
  });

  it('returns 200 when the team_id is not known to us', async () => {
    process.env.SLACK_SIGNING_SECRET = SECRET;
    vi.mocked(verifySlackSignature).mockReturnValue(true);
    vi.mocked(parseSlackEventPayload).mockReturnValue({
      type: 'event_callback',
      team_id: 'T-unknown',
      api_app_id: 'A0',
      event_id: 'Ev0',
      event_time: 0,
      event: { type: 'message', channel: 'C0', user: 'U0', text: 'hi', ts: '1.0' },
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
    const res = await POST(makeRequest('{}', 'v0=ok', '1716000000'));
    expect(res.status).toBe(200);
  });
});
