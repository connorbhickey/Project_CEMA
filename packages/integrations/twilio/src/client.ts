import type { OutboundCallInput, OutboundCallResult } from './types';

function getTwilioCredentials(): { accountSid: string; authToken: string } {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid) throw new Error('TWILIO_ACCOUNT_SID environment variable is required');
  if (!authToken) throw new Error('TWILIO_AUTH_TOKEN environment variable is required');
  return { accountSid, authToken };
}

/**
 * Places an outbound call via the Twilio REST API.
 *
 * Does NOT call `initiateOutboundCall` directly from user-facing code —
 * callers should use the click-to-call server action in apps/web which
 * enforces the TCPA guard (Task 17) before calling this function.
 *
 * Uses fetch + application/x-www-form-urlencoded (Twilio's REST API format)
 * with HTTP Basic auth (Account SID + Auth Token).
 */
export async function initiateOutboundCall(input: OutboundCallInput): Promise<OutboundCallResult> {
  const { accountSid, authToken } = getTwilioCredentials();

  const body = new URLSearchParams({
    To: input.toE164,
    From: input.fromE164,
    Url: input.twimlUrl,
    Record: 'record-from-answer-dual',
    RecordingStatusCallback: input.statusCallbackUrl,
    RecordingStatusCallbackMethod: 'POST',
    RecordingChannels: 'dual',
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Twilio API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { sid: string; status: string };
  return { callSid: data.sid, status: data.status };
}
