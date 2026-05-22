import { createHmac } from 'node:crypto';

import type { SlackEventPayload, SlackSlashCommand } from './types';

// Slack docs: https://api.slack.com/authentication/verifying-requests-from-slack
// Signed base: "v0:{timestamp}:{rawBody}", HMAC-SHA256 keyed with signing secret.
// Replay window: 5 minutes (300 seconds).

const REPLAY_WINDOW_SECONDS = 300;

export function verifySlackSignature(
  signingSecret: string,
  signatureHeader: string,
  timestampHeader: string,
  rawBody: string,
): boolean {
  if (!signatureHeader.startsWith('v0=')) return false;
  const tsNum = Number(timestampHeader);
  if (!Number.isFinite(tsNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > REPLAY_WINDOW_SECONDS) return false;
  const base = `v0:${timestampHeader}:${rawBody}`;
  const expected = 'v0=' + createHmac('sha256', signingSecret).update(base).digest('hex');
  return expected === signatureHeader;
}

export function parseSlackEventPayload(rawBody: string): SlackEventPayload {
  return JSON.parse(rawBody) as SlackEventPayload;
}

export function parseSlackSlashCommand(rawBody: string): SlackSlashCommand {
  const params = new URLSearchParams(rawBody);
  return {
    token: params.get('token') ?? '',
    team_id: params.get('team_id') ?? '',
    team_domain: params.get('team_domain') ?? '',
    channel_id: params.get('channel_id') ?? '',
    channel_name: params.get('channel_name') ?? '',
    user_id: params.get('user_id') ?? '',
    user_name: params.get('user_name') ?? '',
    command: params.get('command') ?? '',
    text: params.get('text') ?? '',
    response_url: params.get('response_url') ?? '',
    trigger_id: params.get('trigger_id') ?? '',
  };
}
