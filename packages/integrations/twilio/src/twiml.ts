import { NY_TWO_PARTY_DISCLOSURE } from './disclosure';
import type { OutboundTwimlOptions } from './types';

/**
 * Builds the TwiML XML served to Twilio when it dials out.
 *
 * Order is compliance-critical: <Say> disclosure MUST appear before <Dial>
 * so the recording starts only after the consent preamble. Hard rule #5.
 *
 * recordingChannels="dual" captures caller + callee on separate tracks,
 * which Deepgram's diarization pipeline uses to attribute speakers correctly.
 */
export function buildOutboundTwiml(options: OutboundTwimlOptions): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Say voice="Polly.Joanna">${NY_TWO_PARTY_DISCLOSURE}</Say>`,
    '  <Pause length="1"/>',
    `  <Dial record="record-from-answer-dual"`,
    `        recordingStatusCallback="${options.statusCallbackUrl}"`,
    '        recordingStatusCallbackMethod="POST"',
    '        recordingChannels="dual">',
    `    <Number>${options.toE164}</Number>`,
    '  </Dial>',
    '</Response>',
  ].join('\n');
}
