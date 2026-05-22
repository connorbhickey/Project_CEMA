import { createHmac } from 'node:crypto';

import type { NormalizedConnectPayload } from './types';

export function verifyDocusignSignature(
  connectSecret: string,
  signatureHeader: string,
  rawBody: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', connectSecret).update(rawBody).digest('base64');
  return expected === signatureHeader;
}

export function parseDocusignConnectPayload(rawBody: string): NormalizedConnectPayload {
  const payload = JSON.parse(rawBody) as {
    event: string;
    data?: {
      envelopeId?: string;
      envelopeSummary?: {
        status?: string;
        statusChangedDateTime?: string;
        emailSubject?: string;
        recipients?: {
          signers?: Array<{
            email?: string;
            name?: string;
            routingOrder?: string | number;
            status?: string;
            signedDateTime?: string;
          }>;
        };
        voidedReason?: string;
      };
    };
  };

  const env = payload.data?.envelopeSummary ?? {};
  const signers = env.recipients?.signers ?? [];

  return {
    event: payload.event,
    envelopeId: payload.data?.envelopeId ?? '',
    status: env.status ?? '',
    statusChangedDateTime: env.statusChangedDateTime ?? '',
    subject: env.emailSubject ?? '',
    recipients: signers.map((s) => ({
      email: s.email ?? '',
      name: s.name ?? '',
      routingOrder: Number(s.routingOrder ?? 0),
      status: s.status ?? '',
      signedDateTime: s.signedDateTime ?? null,
    })),
    voidedReason: env.voidedReason ?? null,
    raw: payload,
  };
}
