import { createHmac } from 'node:crypto';

export function verifyTwilioSignature(
  authToken: string,
  twilioSignature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${k}${params[k]}`).join('');
  const data = url + paramString;
  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  return expected === twilioSignature;
}

export interface TwilioRecordingCallback {
  callSid: string;
  recordingSid: string;
  recordingUrl: string;
  recordingStatus: string;
  callDuration: number;
  accountSid: string;
}

export function parseTwilioRecordingCallback(params: URLSearchParams): TwilioRecordingCallback {
  return {
    callSid: params.get('CallSid') ?? '',
    recordingSid: params.get('RecordingSid') ?? '',
    recordingUrl: params.get('RecordingUrl') ?? '',
    recordingStatus: params.get('RecordingStatus') ?? '',
    callDuration: parseInt(params.get('CallDuration') ?? '0', 10),
    accountSid: params.get('AccountSid') ?? '',
  };
}
