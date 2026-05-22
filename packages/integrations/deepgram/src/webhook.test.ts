import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyDeepgramSignature } from './webhook';

function makeSignature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyDeepgramSignature', () => {
  const SECRET = 'dg-webhook-secret-abc';
  const BODY = '{"request_id":"dg-req-xyz","results":{"channels":[]}}';

  it('returns true for a valid signature', () => {
    const sig = makeSignature(SECRET, BODY);
    expect(verifyDeepgramSignature(SECRET, sig, BODY)).toBe(true);
  });

  it('returns false for a tampered body', () => {
    const sig = makeSignature(SECRET, BODY);
    expect(verifyDeepgramSignature(SECRET, sig, BODY + ' ')).toBe(false);
  });

  it('returns false for a wrong secret', () => {
    const sig = makeSignature('wrong-secret', BODY);
    expect(verifyDeepgramSignature(SECRET, sig, BODY)).toBe(false);
  });

  it('returns false for an empty signature string', () => {
    expect(verifyDeepgramSignature(SECRET, '', BODY)).toBe(false);
  });
});
