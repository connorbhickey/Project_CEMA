import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseDocusignConnectPayload, verifyDocusignSignature } from './webhook';

const SECRET = 'connect-secret-abc';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('base64');
}

const COMPLETED_PAYLOAD = JSON.stringify({
  event: 'envelope-completed',
  data: {
    envelopeId: 'env-001',
    envelopeSummary: {
      status: 'completed',
      statusChangedDateTime: '2026-05-22T15:00:00Z',
      emailSubject: 'Please sign your CEMA',
      recipients: {
        signers: [
          {
            email: 'borrower@example.com',
            name: 'Borrower Name',
            routingOrder: '1',
            status: 'completed',
            signedDateTime: '2026-05-22T15:00:00Z',
          },
        ],
      },
    },
  },
});

describe('verifyDocusignSignature', () => {
  it('returns true for a valid base64 HMAC', () => {
    expect(verifyDocusignSignature(SECRET, sign(COMPLETED_PAYLOAD), COMPLETED_PAYLOAD)).toBe(true);
  });

  it('returns false for tampered body', () => {
    expect(verifyDocusignSignature(SECRET, sign(COMPLETED_PAYLOAD), COMPLETED_PAYLOAD + 'x')).toBe(
      false,
    );
  });

  it('returns false when signature header is empty', () => {
    expect(verifyDocusignSignature(SECRET, '', COMPLETED_PAYLOAD)).toBe(false);
  });
});

describe('parseDocusignConnectPayload', () => {
  it('extracts envelope + recipient status', () => {
    const parsed = parseDocusignConnectPayload(COMPLETED_PAYLOAD);
    expect(parsed.envelopeId).toBe('env-001');
    expect(parsed.status).toBe('completed');
    expect(parsed.recipients).toHaveLength(1);
    expect(parsed.recipients[0]!.signedDateTime).toBe('2026-05-22T15:00:00Z');
  });
});
