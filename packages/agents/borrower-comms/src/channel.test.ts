import { describe, expect, it } from 'vitest';

import { FixtureChannelAdapter } from './channel';
import type { BorrowerCommPacket } from './types';

const PACKET: BorrowerCommPacket = {
  dealId: 'deal-1',
  partyId: 'party-1',
  status: 'closing',
  channel: 'email',
  to: 'borrower@example.com',
  subject: 'Your CEMA is scheduled to close',
  body: 'Good news — your CEMA is ready for closing.',
};

describe('FixtureChannelAdapter', () => {
  it('records the packet and reports acceptance', async () => {
    const adapter = new FixtureChannelAdapter();
    const result = await adapter.send(PACKET);

    expect(result.accepted).toBe(true);
    expect(result.channelMessageId).toBe('fixture:deal-1:party-1:closing');
    expect(adapter.sent).toEqual([PACKET]);
  });
});
