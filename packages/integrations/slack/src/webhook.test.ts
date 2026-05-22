import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseSlackEventPayload, parseSlackSlashCommand, verifySlackSignature } from './webhook';

const SECRET = 'test-slack-signing-secret-abc123';

function sign(timestamp: string, body: string): string {
  const base = `v0:${timestamp}:${body}`;
  return 'v0=' + createHmac('sha256', SECRET).update(base).digest('hex');
}

const MESSAGE_PAYLOAD = JSON.stringify({
  type: 'event_callback',
  team_id: 'T0123',
  api_app_id: 'A0123',
  event_id: 'Ev0123',
  event_time: 1716000000,
  event: {
    type: 'message',
    channel: 'C0123',
    user: 'U0123',
    text: 'CEMA payoff request to Wells Fargo',
    ts: '1716000000.000100',
  },
});

describe('verifySlackSignature', () => {
  it('returns true for a valid v0 HMAC signature', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(ts, MESSAGE_PAYLOAD);
    expect(verifySlackSignature(SECRET, sig, ts, MESSAGE_PAYLOAD)).toBe(true);
  });

  it('returns false for a tampered body', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(ts, MESSAGE_PAYLOAD);
    expect(verifySlackSignature(SECRET, sig, ts, MESSAGE_PAYLOAD + 'x')).toBe(false);
  });

  it('returns false for a stale timestamp (> 5 minutes old)', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const sig = sign(ts, MESSAGE_PAYLOAD);
    expect(verifySlackSignature(SECRET, sig, ts, MESSAGE_PAYLOAD)).toBe(false);
  });

  it('returns false when the signature does not start with v0=', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(SECRET, 'bogus', ts, MESSAGE_PAYLOAD)).toBe(false);
  });
});

describe('parseSlackEventPayload', () => {
  it('parses a message event_callback', () => {
    const parsed = parseSlackEventPayload(MESSAGE_PAYLOAD);
    expect(parsed.type).toBe('event_callback');
    if (parsed.type !== 'event_callback') throw new Error('unreachable');
    expect(parsed.team_id).toBe('T0123');
    expect(parsed.event.type).toBe('message');
  });

  it('parses a url_verification challenge', () => {
    const parsed = parseSlackEventPayload(
      JSON.stringify({ type: 'url_verification', token: 'tok', challenge: 'CHALLENGE-XYZ' }),
    );
    expect(parsed.type).toBe('url_verification');
    if (parsed.type !== 'url_verification') throw new Error('unreachable');
    expect(parsed.challenge).toBe('CHALLENGE-XYZ');
  });
});

describe('parseSlackSlashCommand', () => {
  it('parses a form-urlencoded slash command body', () => {
    const body = new URLSearchParams({
      token: 'tok',
      team_id: 'T0123',
      team_domain: 'acme',
      channel_id: 'C0123',
      channel_name: 'cema-pipeline',
      user_id: 'U0123',
      user_name: 'connor',
      command: '/cema',
      text: 'status DEAL-1234',
      response_url: 'https://hooks.slack.com/commands/Txxx/yyy',
      trigger_id: 'trig',
    }).toString();
    const parsed = parseSlackSlashCommand(body);
    expect(parsed.command).toBe('/cema');
    expect(parsed.text).toBe('status DEAL-1234');
  });
});
