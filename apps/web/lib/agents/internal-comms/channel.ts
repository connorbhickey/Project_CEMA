import {
  FixtureChannelAdapter,
  type ChannelSendResult,
  type InternalCommPacket,
} from '@cema/agents-internal-comms';

// Dormant FixtureChannelAdapter today; the one-line swap point for a real
// SlackChannelAdapter (over org_slack_connections) once Slack OAuth + a
// configured channel are provisioned.
const adapter = new FixtureChannelAdapter();

/**
 * Send an internal-comms packet via the wired channel. A module-level function
 * (not an exported adapter object) so the dispatcher unit test can mock it
 * cleanly without tripping `unbound-method`, mirroring how the agent dispatcher
 * mocks its module-level entry points.
 */
export function sendInternalComm(packet: InternalCommPacket): Promise<ChannelSendResult> {
  return adapter.send(packet);
}
