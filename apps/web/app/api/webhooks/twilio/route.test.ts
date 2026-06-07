import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  communications: {},
}));

vi.mock('@cema/queues', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/queue', () => ({
  vercelQueueSend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@cema/cache', () => ({
  acquireIdempotencyKey: vi.fn().mockResolvedValue(true),
  releaseIdempotencyKey: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from '@cema/db';
import { publish } from '@cema/queues';
import { acquireIdempotencyKey, releaseIdempotencyKey } from '@cema/cache';

import { POST } from './route';

const AUTH_TOKEN = 'test_auth_token_32_chars_minimum_xx';
const WEBHOOK_URL = 'https://app.example.com/api/webhooks/twilio';

const COMPLETED_PARAMS: Record<string, string> = {
  AccountSid: 'ACtest',
  CallDuration: '300',
  CallSid: 'CA123',
  RecordingSid: 'RE456',
  RecordingStatus: 'completed',
  RecordingUrl: 'https://api.twilio.com/Recordings/RE456',
};

function makeSignature(url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${k}${params[k]}`).join('');
  return createHmac('sha1', AUTH_TOKEN)
    .update(url + paramString)
    .digest('base64');
}

function makeRequest(params: Record<string, string>, overrideSignature?: string): Request {
  const body = new URLSearchParams(params).toString();
  const sig = overrideSignature ?? makeSignature(WEBHOOK_URL, params);
  return new Request(WEBHOOK_URL, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': sig,
    },
  });
}

function setupDbMock(rows: object[]) {
  vi.mocked(getDb).mockReturnValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof getDb>);
}

describe('POST /api/webhooks/twilio', () => {
  beforeEach(() => {
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.TWILIO_AUTH_TOKEN;
  });

  it('returns 500 if TWILIO_AUTH_TOKEN is missing', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const req = new Request(WEBHOOK_URL, { method: 'POST', body: '' });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('returns 400 if X-Twilio-Signature header is missing', async () => {
    const body = new URLSearchParams(COMPLETED_PARAMS).toString();
    const req = new Request(WEBHOOK_URL, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 403 if signature is invalid', async () => {
    const req = makeRequest(COMPLETED_PARAMS, 'bad-signature');
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 200 without publishing for in-progress recording', async () => {
    const params = { ...COMPLETED_PARAMS, RecordingStatus: 'in-progress' };
    const req = makeRequest(params);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(publish).not.toHaveBeenCalled();
  });

  it('returns 404 if no communication row matches the CallSid', async () => {
    setupDbMock([]);
    const res = await POST(makeRequest(COMPLETED_PARAMS));
    expect(res.status).toBe(404);
  });

  it('returns 200 and publishes both telephony.call.ingest and comms.embed for a valid completed recording', async () => {
    setupDbMock([{ id: 'comm-uuid-1', organizationId: 'org-uuid-1' }]);
    const res = await POST(makeRequest(COMPLETED_PARAMS));
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledTimes(2);
    const [topic, payload] = vi.mocked(publish).mock.calls[0] as [
      string,
      Record<string, unknown>,
      unknown,
    ];
    expect(topic).toBe('telephony.call.ingest');
    expect(payload).toMatchObject({
      orgId: 'org-uuid-1',
      provider: 'twilio',
      vendorCallId: 'CA123',
      vendorEventId: 'RE456',
    });
  });

  it('publishes comms.embed with communicationId for completed recording', async () => {
    setupDbMock([{ id: 'comm-uuid-1', organizationId: 'org-uuid-1' }]);
    await POST(makeRequest(COMPLETED_PARAMS));
    const calls = vi.mocked(publish).mock.calls as [string, Record<string, unknown>, unknown][];
    const embedCall = calls.find(([topic]) => topic === 'comms.embed');
    expect(embedCall).toBeDefined();
    expect(embedCall![1]).toEqual({ orgId: 'org-uuid-1', communicationId: 'comm-uuid-1' });
  });

  it('publishes vendorPayload containing the raw Twilio params', async () => {
    setupDbMock([{ id: 'comm-uuid-1', organizationId: 'org-uuid-1' }]);
    await POST(makeRequest(COMPLETED_PARAMS));
    const [, payload] = vi.mocked(publish).mock.calls[0] as [
      string,
      Record<string, unknown>,
      unknown,
    ];
    const vendorPayload = payload['vendorPayload'] as Record<string, string>;
    expect(vendorPayload['RecordingStatus']).toBe('completed');
    expect(vendorPayload['CallSid']).toBe('CA123');
  });

  it('returns 200 without publishing when the idempotency key was already acquired (duplicate)', async () => {
    vi.mocked(acquireIdempotencyKey).mockResolvedValueOnce(false);

    const res = await POST(makeRequest(COMPLETED_PARAMS));
    expect(res.status).toBe(200);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes both topics when the idempotency key is freshly acquired', async () => {
    // acquireIdempotencyKey defaults to true (fresh / fail-open).
    setupDbMock([{ id: 'comm-uuid-1', organizationId: 'org-uuid-1' }]);

    const res = await POST(makeRequest(COMPLETED_PARAMS));
    expect(res.status).toBe(200);
    // M8 added comms.embed publish after telephony.call.ingest
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('releases idempotency key when communication is not found (so Twilio retry can succeed)', async () => {
    setupDbMock([]);

    const res = await POST(makeRequest(COMPLETED_PARAMS));
    expect(res.status).toBe(404);
    expect(releaseIdempotencyKey).toHaveBeenCalledWith('telephony:idempo:RE456');
    expect(publish).not.toHaveBeenCalled();
  });

  it('releases idempotency key when publish throws (so Twilio retry can succeed)', async () => {
    setupDbMock([{ id: 'comm-uuid-1', organizationId: 'org-uuid-1' }]);
    vi.mocked(publish).mockRejectedValueOnce(new Error('queue down'));

    await expect(POST(makeRequest(COMPLETED_PARAMS))).rejects.toThrow('queue down');
    expect(releaseIdempotencyKey).toHaveBeenCalledWith('telephony:idempo:RE456');
  });
});
