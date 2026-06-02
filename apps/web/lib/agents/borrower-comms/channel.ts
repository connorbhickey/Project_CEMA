import {
  FixtureChannelAdapter,
  type BorrowerCommPacket,
  type ChannelSendResult,
} from '@cema/agents-borrower-comms';

// Dormant FixtureChannelAdapter today; the one-line swap point for a real
// ResendChannelAdapter once RESEND_API_KEY + a verified sending domain exist.
const adapter = new FixtureChannelAdapter();

/**
 * Send a borrower-comms packet via the wired channel. A module-level function
 * (not an exported adapter object) so the dispatcher test mocks it cleanly
 * without tripping unbound-method.
 */
export function sendBorrowerComm(packet: BorrowerCommPacket): Promise<ChannelSendResult> {
  return adapter.send(packet);
}
