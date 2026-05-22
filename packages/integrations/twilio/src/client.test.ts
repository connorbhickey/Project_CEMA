import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { initiateOutboundCall } from './client';

const ACCOUNT_SID = 'ACtest000000000000000000000000000001';
const AUTH_TOKEN = 'test_auth_token_32_chars_minimum_xx';
const OUTBOUND_NUMBER = '+12125559999';

const VALID_INPUT = {
  toE164: '+12125551234',
  fromE164: OUTBOUND_NUMBER,
  twimlUrl: 'https://app.example.com/api/twiml/outbound/comm-123',
  statusCallbackUrl: 'https://app.example.com/api/webhooks/twilio',
};

describe('initiateOutboundCall', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = ACCOUNT_SID;
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sid: 'CA123', status: 'queued' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
  });

  it('throws if TWILIO_ACCOUNT_SID is missing', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    await expect(initiateOutboundCall(VALID_INPUT)).rejects.toThrow('TWILIO_ACCOUNT_SID');
  });

  it('throws if TWILIO_AUTH_TOKEN is missing', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    await expect(initiateOutboundCall(VALID_INPUT)).rejects.toThrow('TWILIO_AUTH_TOKEN');
  });

  it('POSTs to the correct Twilio Calls endpoint', async () => {
    await initiateOutboundCall(VALID_INPUT);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/2010-04-01/Accounts/${ACCOUNT_SID}/Calls.json`);
  });

  it('uses HTTP Basic auth with SID and token', async () => {
    await initiateOutboundCall(VALID_INPUT);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const authHeader = (init.headers as Record<string, string>)['Authorization'];
    const expected = 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
    expect(authHeader).toBe(expected);
  });

  it('enables dual-channel recording in the POST body', async () => {
    await initiateOutboundCall(VALID_INPUT);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(body.get('Record')).toBe('record-from-answer-dual');
    expect(body.get('RecordingChannels')).toBe('dual');
  });

  it('returns the CallSid from the Twilio response', async () => {
    const result = await initiateOutboundCall(VALID_INPUT);
    expect(result.callSid).toBe('CA123');
  });
});
