import type { BorrowerChannelAdapter, BorrowerCommPacket, ChannelSendResult } from './types';

/**
 * Dormant default channel adapter. Records packets in-memory and reports
 * acceptance without sending -- the wiring default until a real
 * ResendChannelAdapter is provisioned behind RESEND_API_KEY + a verified sending
 * domain. Also the test double for the dispatcher behavioral guard.
 */
export class FixtureChannelAdapter implements BorrowerChannelAdapter {
  public readonly sent: BorrowerCommPacket[] = [];

  // Not `async` (no await) -- returns a resolved Promise to satisfy the contract
  // without tripping require-await (packages/agents/* are outside the eslint
  // type-aware project glob).
  send(packet: BorrowerCommPacket): Promise<ChannelSendResult> {
    this.sent.push(packet);
    return Promise.resolve({
      accepted: true,
      channelMessageId: `fixture:${packet.dealId}:${packet.partyId}:${packet.status}`,
    });
  }
}
