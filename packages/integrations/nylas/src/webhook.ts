import { createHmac } from 'node:crypto';

import type { NylasWebhookEvent } from './types';

export function verifyNylasWebhookSignature(
  secret: string,
  signature: string,
  rawBody: string,
): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected === signature;
}

export function parseNylasWebhookPayload(rawBody: string): NylasWebhookEvent {
  const payload = JSON.parse(rawBody) as {
    type: string;
    data: {
      object: {
        grant_id: string;
        id: string;
        thread_id?: string;
        calendar_id?: string;
        [key: string]: unknown;
      };
    };
  };

  const trigger = payload.type;
  const grantId = payload.data.object.grant_id;
  const raw = payload.data.object;

  if (trigger === 'message.created') {
    return {
      trigger,
      grantId,
      objectData: { id: raw.id, threadId: raw.thread_id ?? '' },
    };
  }

  if (trigger === 'event.created' || trigger === 'event.updated') {
    return {
      trigger,
      grantId,
      objectData: { id: raw.id, calendarId: raw.calendar_id ?? '' },
    };
  }

  return { trigger, grantId, objectData: raw };
}
