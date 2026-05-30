import type { ChannelSendResult, OutreachPacket, ServicerChannelAdapter } from './types';

/**
 * Dormant default channel adapter. Records packets in-memory and reports
 * acceptance without sending anything -- the wiring default until a real
 * ResendChannelAdapter is provisioned behind a design partner + RESEND_API_KEY.
 * Also the test double for the orchestrator behavioral guard (PR-4).
 */
export class FixtureChannelAdapter implements ServicerChannelAdapter {
  public readonly sent: OutreachPacket[] = [];

  async send(packet: OutreachPacket): Promise<ChannelSendResult> {
    this.sent.push(packet);
    return {
      accepted: true,
      channelMessageId: `fixture:${packet.dealId}:touch:${packet.touchNumber}`,
    };
  }
}
