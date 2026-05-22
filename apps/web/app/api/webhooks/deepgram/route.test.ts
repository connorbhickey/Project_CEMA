import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/integrations-deepgram', () => ({
  verifyDeepgramSignature: vi.fn().mockReturnValue(true),
  parseTranscriptResponse: vi.fn().mockReturnValue({
    language: 'en-US',
    confidence: 0.98,
    words: [{ text: 'Hello', start: 0.1, end: 0.4, speaker: 0 }],
    paragraphs: [{ text: 'Hello.', start: 0.1, end: 0.4, speaker: 0 }],
  }),
}));

vi.mock('@cema/blob', () => ({
  blobPut: vi.fn().mockResolvedValue({
    url: 'https://blob.vercel-storage.com/recordings/rec-1/transcript.json',
    pathname: 'recordings/rec-1/transcript.json',
  }),
}));

vi.mock('@cema/compliance', () => ({
  emitAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  recordings: {},
  communications: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

import { blobPut } from '@cema/blob';
import { emitAuditEvent } from '@cema/compliance';
import { getDb } from '@cema/db';
import { parseTranscriptResponse, verifyDeepgramSignature } from '@cema/integrations-deepgram';

import { POST } from './route';

const RECORDING = {
  id: 'rec-uuid-1',
  communicationId: 'comm-uuid-1',
  recordingBlobUrl: 'https://blob.vercel-storage.com/recordings/rec-uuid-1/audio.wav',
};

const COMMUNICATION = { id: 'comm-uuid-1', organizationId: 'org-uuid-1' };

const DEEPGRAM_BODY = JSON.stringify({
  metadata: { request_id: 'dg-req-abc123' },
  results: { channels: [] },
});

function makeRequest(body = DEEPGRAM_BODY, signature = 'valid-sig') {
  return new Request('https://app.example.com/api/webhooks/deepgram', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Deepgram-Signature': signature,
    },
    body,
  });
}

function makeMockDb(recording = RECORDING, communication = COMMUNICATION) {
  const select = vi.fn();

  select.mockReturnValueOnce({
    from: () => ({ where: () => ({ limit: vi.fn().mockResolvedValue([recording]) }) }),
  });
  select.mockReturnValueOnce({
    from: () => ({ where: () => ({ limit: vi.fn().mockResolvedValue([communication]) }) }),
  });

  const update = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  });

  return { select, update, execute: vi.fn() };
}

describe('POST /api/webhooks/deepgram', () => {
  beforeEach(() => {
    process.env.DEEPGRAM_WEBHOOK_SECRET = 'dg-webhook-secret';
    vi.mocked(getDb).mockReturnValue(makeMockDb() as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DEEPGRAM_WEBHOOK_SECRET;
  });

  it('returns 500 when DEEPGRAM_WEBHOOK_SECRET is not set', async () => {
    delete process.env.DEEPGRAM_WEBHOOK_SECRET;
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
  });

  it('returns 400 when Deepgram-Signature header is missing', async () => {
    const req = new Request('https://app.example.com/api/webhooks/deepgram', {
      method: 'POST',
      body: DEEPGRAM_BODY,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 403 when signature verification fails', async () => {
    vi.mocked(verifyDeepgramSignature).mockReturnValueOnce(false);
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });

  it('returns 404 when no recording matches the request_id', async () => {
    const emptyDb = {
      select: vi.fn().mockReturnValue({
        from: () => ({ where: () => ({ limit: vi.fn().mockResolvedValue([]) }) }),
      }),
      update: vi.fn(),
    };
    vi.mocked(getDb).mockReturnValueOnce(emptyDb as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
  });

  it('calls parseTranscriptResponse with the parsed body', async () => {
    await POST(makeRequest());
    expect(parseTranscriptResponse).toHaveBeenCalledWith(JSON.parse(DEEPGRAM_BODY));
  });

  it('uploads transcript JSON to blob under the recording path', async () => {
    await POST(makeRequest());
    expect(blobPut).toHaveBeenCalledWith(
      expect.stringContaining('rec-uuid-1'),
      expect.any(String),
      'application/json',
    );
  });

  it('emits communication.transcript.ready audit event', async () => {
    await POST(makeRequest());
    expect(emitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'communication.transcript.ready' }),
    );
  });

  it('returns 200 on happy path', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
  });
});
