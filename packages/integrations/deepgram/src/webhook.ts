import { createHmac } from 'node:crypto';

export function verifyDeepgramSignature(
  secret: string,
  signature: string,
  rawBody: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected === signature;
}
