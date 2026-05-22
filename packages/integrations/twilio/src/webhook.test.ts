import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseTwilioRecordingCallback, verifyTwilioSignature } from './webhook';

const AUTH_TOKEN = 'test_auth_token_32_chars_minimum_xx';
const WEBHOOK_URL = 'https://app.example.com/api/webhooks/twilio';

function makeSignature(url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${k}${params[k]}`).join('');
  return createHmac('sha1', AUTH_TOKEN)
    .update(url + paramString)
    .digest('base64');
}

describe('verifyTwilioSignature', () => {
  it('returns true for a valid signature', () => {
    const params = { CallSid: 'CA123', RecordingStatus: 'completed' };
    const sig = makeSignature(WEBHOOK_URL, params);
    expect(verifyTwilioSignature(AUTH_TOKEN, sig, WEBHOOK_URL, params)).toBe(true);
  });

  it('returns false for a tampered signature', () => {
    const params = { CallSid: 'CA123', RecordingStatus: 'completed' };
    expect(verifyTwilioSignature(AUTH_TOKEN, 'forged-sig', WEBHOOK_URL, params)).toBe(false);
  });

  it('sorts params alphabetically before hashing', () => {
    const params = { Z_last: 'z', A_first: 'a', M_mid: 'm' };
    const sig = makeSignature(WEBHOOK_URL, params);
    expect(verifyTwilioSignature(AUTH_TOKEN, sig, WEBHOOK_URL, params)).toBe(true);
  });

  it('returns false when the URL differs', () => {
    const params = { CallSid: 'CA123' };
    const sig = makeSignature(WEBHOOK_URL, params);
    expect(verifyTwilioSignature(AUTH_TOKEN, sig, WEBHOOK_URL + '?extra=1', params)).toBe(false);
  });

  it('returns false when a param value is tampered', () => {
    const params = { CallSid: 'CA123', RecordingStatus: 'completed' };
    const sig = makeSignature(WEBHOOK_URL, params);
    const tampered = { ...params, RecordingStatus: 'in-progress' };
    expect(verifyTwilioSignature(AUTH_TOKEN, sig, WEBHOOK_URL, tampered)).toBe(false);
  });
});

describe('parseTwilioRecordingCallback', () => {
  it('parses all fields from URLSearchParams', () => {
    const params = new URLSearchParams({
      CallSid: 'CA123',
      RecordingSid: 'RE456',
      RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE456',
      RecordingStatus: 'completed',
      CallDuration: '300',
      AccountSid: 'ACtest',
    });
    expect(parseTwilioRecordingCallback(params)).toEqual({
      callSid: 'CA123',
      recordingSid: 'RE456',
      recordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE456',
      recordingStatus: 'completed',
      callDuration: 300,
      accountSid: 'ACtest',
    });
  });

  it('defaults callDuration to 0 when absent', () => {
    const params = new URLSearchParams({ CallSid: 'CA123' });
    expect(parseTwilioRecordingCallback(params).callDuration).toBe(0);
  });

  it('returns empty strings for absent string fields', () => {
    const params = new URLSearchParams({});
    const result = parseTwilioRecordingCallback(params);
    expect(result.callSid).toBe('');
    expect(result.recordingStatus).toBe('');
  });
});
