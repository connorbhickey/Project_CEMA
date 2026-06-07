import { acquireIdempotencyKey, releaseIdempotencyKey } from '@cema/cache';
import { communications, getDb } from '@cema/db';
import { parseTwilioRecordingCallback, verifyTwilioSignature } from '@cema/integrations-twilio';
import { publish } from '@cema/queues';
import { eq } from 'drizzle-orm';

import { vercelQueueSend } from '@/lib/queue';

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

  // Idempotency guard via the shared @cema/cache helper: SETNX with the default
  // 24h TTL on RecordingSid. acquire returns false when the key already exists
  // (already processed) → skip; it fail-opens when Upstash is unconfigured (the
  // DB row is the fallback dedup). The key is RELEASED on every non-terminal
  // failure path below so Twilio's retry can re-acquire instead of waiting the TTL.
  const idempotencyKey = `telephony:idempo:${callback.recordingSid}`;
  if (!(await acquireIdempotencyKey(idempotencyKey))) {
    return new Response('OK', { status: 200 });
  }

  const [comm] = await getDb()
    .select()
    .from(communications)
    .where(eq(communications.vendorCallId, callback.callSid))
    .limit(1);

  if (!comm) {
    // Release the key — Twilio may have raced ahead of our DB insert path;
    // a retry once the comm row exists should succeed cleanly.
    await releaseIdempotencyKey(idempotencyKey);
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
    await releaseIdempotencyKey(idempotencyKey);
    throw err;
  }

  await publish(
    'comms.embed',
    { orgId: comm.organizationId, communicationId: comm.id },
    vercelQueueSend,
  );

  return new Response('OK', { status: 200 });
}
