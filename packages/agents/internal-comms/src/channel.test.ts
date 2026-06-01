import { describe, expect, it } from 'vitest';

import { FixtureChannelAdapter } from './channel';
import type { InternalCommPacket } from './types';

const PACKET: InternalCommPacket = {
  dealId: 'deal-1',
  status: 'attorney_review',
  channel: 'pipeline',
  message: 'A deal has entered attorney review and is ready for an attorney to act.',
};

describe('FixtureChannelAdapter', () => {
  it('records the packet and reports acceptance', async () => {
    const adapter = new FixtureChannelAdapter();
    const result = await adapter.send(PACKET);

    expect(result.accepted).toBe(true);
    expect(result.channelMessageId).toBe('fixture:deal-1:attorney_review');
    expect(adapter.sent).toEqual([PACKET]);
  });
});
