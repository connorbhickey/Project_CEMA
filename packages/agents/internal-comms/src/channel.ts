import type { ChannelSendResult, InternalChannelAdapter, InternalCommPacket } from './types';

/**
 * Dormant default channel adapter. Records packets in-memory and reports
 * acceptance without sending anything -- the wiring default until a real
 * SlackChannelAdapter is provisioned behind Slack OAuth + a configured channel.
 * Also the test double for the dispatcher behavioral guard.
 */
export class FixtureChannelAdapter implements InternalChannelAdapter {
  public readonly sent: InternalCommPacket[] = [];

  // Not `async` (it does no awaiting) -- returns a resolved Promise to satisfy
  // the InternalChannelAdapter contract without tripping require-await.
  send(packet: InternalCommPacket): Promise<ChannelSendResult> {
    this.sent.push(packet);
    return Promise.resolve({
      accepted: true,
      channelMessageId: `fixture:${packet.dealId}:${packet.status}`,
    });
  }
}
