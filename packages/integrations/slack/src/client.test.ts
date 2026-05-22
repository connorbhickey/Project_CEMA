import { describe, expect, it, vi } from 'vitest';

vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    chat: {
      postMessage: vi
        .fn()
        .mockResolvedValue({ ok: true, ts: '1716000000.000200', channel: 'C0123' }),
      postEphemeral: vi.fn().mockResolvedValue({ ok: true }),
    },
    users: {
      info: vi.fn().mockResolvedValue({
        ok: true,
        user: { id: 'U0123', real_name: 'Connor Hickey', profile: { display_name: 'connor' } },
      }),
    },
  })),
}));

import { fetchSlackUserDisplayName, getSlackClient, postEphemeralReply } from './client';

describe('getSlackClient', () => {
  it('constructs a WebClient with the provided bot token', () => {
    const client = getSlackClient('xoxb-fake-token');
    expect(client).toBeDefined();
  });
});

describe('fetchSlackUserDisplayName', () => {
  it('returns the display_name when present', async () => {
    const client = getSlackClient('xoxb-fake-token');
    const name = await fetchSlackUserDisplayName(client, 'U0123');
    expect(name).toBe('connor');
  });
});

describe('postEphemeralReply', () => {
  it('calls chat.postEphemeral on the WebClient', async () => {
    const client = getSlackClient('xoxb-fake-token');
    await expect(
      postEphemeralReply(client, { channel: 'C0123', user: 'U0123', text: 'Deal: ready' }),
    ).resolves.toBeUndefined();
  });
});
