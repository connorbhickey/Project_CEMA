import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseNylasWebhookPayload, verifyNylasWebhookSignature } from './webhook';

const SECRET = 'test-webhook-secret-abc123';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

const EMAIL_PAYLOAD = JSON.stringify({
  specversion: '1.0',
  type: 'message.created',
  source: '/nylas/us',
  data: {
    application_id: 'app123',
    object: {
      grant_id: 'grant-abc',
      object: 'message',
      id: 'msg-001',
      thread_id: 'thread-xyz',
    },
  },
});

const CALENDAR_PAYLOAD = JSON.stringify({
  specversion: '1.0',
  type: 'event.created',
  source: '/nylas/us',
  data: {
    application_id: 'app123',
    object: {
      grant_id: 'grant-abc',
      object: 'event',
      id: 'evt-001',
      calendar_id: 'cal-001',
    },
  },
});

describe('verifyNylasWebhookSignature', () => {
  it('returns true for a valid HMAC-SHA256 signature', () => {
    const sig = sign(EMAIL_PAYLOAD);
    expect(verifyNylasWebhookSignature(SECRET, sig, EMAIL_PAYLOAD)).toBe(true);
  });

  it('returns false for a tampered body', () => {
    const sig = sign(EMAIL_PAYLOAD);
    expect(verifyNylasWebhookSignature(SECRET, sig, EMAIL_PAYLOAD + 'x')).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const sig = createHmac('sha256', 'wrong').update(EMAIL_PAYLOAD).digest('hex');
    expect(verifyNylasWebhookSignature(SECRET, sig, EMAIL_PAYLOAD)).toBe(false);
  });
});

describe('parseNylasWebhookPayload', () => {
  it('parses a message.created event', () => {
    const event = parseNylasWebhookPayload(EMAIL_PAYLOAD);
    expect(event.trigger).toBe('message.created');
    expect(event.grantId).toBe('grant-abc');
    expect(event.objectData).toMatchObject({ id: 'msg-001', threadId: 'thread-xyz' });
  });

  it('parses an event.created event', () => {
    const event = parseNylasWebhookPayload(CALENDAR_PAYLOAD);
    expect(event.trigger).toBe('event.created');
    expect(event.grantId).toBe('grant-abc');
    expect(event.objectData).toMatchObject({ id: 'evt-001', calendarId: 'cal-001' });
  });
});
