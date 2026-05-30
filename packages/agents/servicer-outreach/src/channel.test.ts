import { describe, expect, it } from 'vitest';
import { FixtureChannelAdapter } from './channel';
import type { OutreachPacket } from './types';

const packet: OutreachPacket = {
  channel: 'email',
  to: 'cema@servicer.example',
  subject: 'CEMA collateral file request',
  body: 'Body text.',
  touchNumber: 1,
  dealId: 'deal-123',
};

describe('FixtureChannelAdapter', () => {
  it('accepts a packet and returns a deterministic channel message id', async () => {
    const adapter = new FixtureChannelAdapter();
    const result = await adapter.send(packet);
    expect(result.accepted).toBe(true);
    expect(result.channelMessageId).toBe('fixture:deal-123:touch:1');
  });

  it('records every sent packet for inspection in tests', async () => {
    const adapter = new FixtureChannelAdapter();
    await adapter.send(packet);
    await adapter.send({ ...packet, touchNumber: 2 });
    expect(adapter.sent).toHaveLength(2);
    expect(adapter.sent[1]?.touchNumber).toBe(2);
  });
});
