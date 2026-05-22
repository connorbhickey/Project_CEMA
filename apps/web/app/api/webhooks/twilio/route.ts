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

  const [comm] = await getDb()
    .select()
    .from(communications)
    .where(eq(communications.vendorCallId, callback.callSid))
    .limit(1);

  if (!comm) {
    return new Response('Communication not found for CallSid', { status: 404 });
  }

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

  return new Response('OK', { status: 200 });
}
