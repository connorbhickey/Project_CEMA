import { getRedis, isUpstashConfigured } from '@cema/cache';
import { communications, getDb } from '@cema/db';
import { parseTwilioRecordingCallback, verifyTwilioSignature } from '@cema/integrations-twilio';
import { publish } from '@cema/queues';
import { eq } from 'drizzle-orm';

import { vercelQueueSend } from '@/lib/queue';

// Helper: clear the SETNX idempotency marker so Twilio's retry can succeed.
// Fail-quiet on Redis errors — DB-level constraints provide fallback dedup.
async function releaseIdempotencyKey(recordingSid: string): Promise<void> {
  if (!isUpstashConfigured()) return;
  try {
    const redis = getRedis();
    await redis.del(`telephony:idempo:${recordingSid}`);
  } catch {
    // Upstash unavailable — nothing to release; the 24h TTL will expire the key naturally
  }
}

export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return new Response('TWILIO_AUTH_TOKEN not configured', { status: 500 });
  }

  const twilioSignature = req.headers.get('x-twilio-signature');
  if (!twilioSignature) {
    return new Response('Missing X-Twilio-Signature', { status: 400 });
  }

  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const paramsObj = Object.fromEntries(params.entries());

  if (!verifyTwilioSignature(authToken, twilioSignature, req.url, paramsObj)) {
    return new Response('Invalid Twilio signature', { status: 403 });
  }

  const callback = parseTwilioRecordingCallback(params);

  if (callback.recordingStatus !== 'completed') {
    return new Response('OK', { status: 200 });
  }

  // Idempotency guard: SETNX with 24-hour TTL on RecordingSid.
  // Returns null when key already existed (NX condition failed) → already processed.
  // The key is RELEASED on every non-terminal failure path below so that
  // Twilio's retry can succeed instead of getting stuck for the full TTL.
  if (isUpstashConfigured()) {
    try {
      const redis = getRedis();
      const key = `telephony:idempo:${callback.recordingSid}`;
      const acquired = await redis.set(key, '1', { nx: true, ex: 86400 });
      if (acquired === null) {
        return new Response('OK', { status: 200 });
      }
    } catch {
      // Upstash unavailable — DB-level constraint provides fallback dedup
    }
  }

  const [comm] = await getDb()
    .select()
    .from(communications)
    .where(eq(communications.vendorCallId, callback.callSid))
    .limit(1);

  if (!comm) {
    // Release the key — Twilio may have raced ahead of our DB insert path;
    // a retry once the comm row exists should succeed cleanly.
    await releaseIdempotencyKey(callback.recordingSid);
    return new Response('Communication not found for CallSid', { status: 404 });
  }

  try {
    await publish(
      'telephony.call.ingest',
      {
        orgId: comm.organizationId,
        provider: 'twilio',
        vendorCallId: callback.callSid,
        vendorEventId: callback.recordingSid,
        vendorPayload: paramsObj,
        receivedAt: new Date().toISOString(),
      },
      vercelQueueSend,
    );
  } catch (err) {
    // Publish failed — release the idempotency key so Twilio's retry path can
    // re-attempt the queue handoff. Then re-throw so the caller sees a 5xx.
    await releaseIdempotencyKey(callback.recordingSid);
    throw err;
  }

  await publish(
    'comms.embed',
    { orgId: comm.organizationId, communicationId: comm.id },
    vercelQueueSend,
  );

  return new Response('OK', { status: 200 });
}
