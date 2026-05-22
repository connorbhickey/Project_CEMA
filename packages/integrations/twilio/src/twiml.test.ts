import { describe, expect, it } from 'vitest';

import { NY_TWO_PARTY_DISCLOSURE } from './disclosure';
import { buildOutboundTwiml } from './twiml';

const OPTS = {
  toE164: '+12125551234',
  statusCallbackUrl: 'https://app.example.com/api/webhooks/twilio',
};

describe('buildOutboundTwiml', () => {
  it('returns well-formed XML', () => {
    const xml = buildOutboundTwiml(OPTS);
    expect(xml).toMatch(/^<\?xml/);
    expect(xml).toContain('<Response>');
    expect(xml).toContain('</Response>');
  });

  it('places <Say> disclosure BEFORE <Dial> connection', () => {
    const xml = buildOutboundTwiml(OPTS);
    const sayIdx = xml.indexOf('<Say');
    const dialIdx = xml.indexOf('<Dial');
    expect(sayIdx).toBeGreaterThan(-1);
    expect(dialIdx).toBeGreaterThan(-1);
    expect(sayIdx).toBeLessThan(dialIdx);
  });

  it('embeds the NY two-party disclosure text in <Say>', () => {
    const xml = buildOutboundTwiml(OPTS);
    expect(xml).toContain(NY_TWO_PARTY_DISCLOSURE);
    expect(NY_TWO_PARTY_DISCLOSURE.length).toBeGreaterThan(0);
    expect(NY_TWO_PARTY_DISCLOSURE.toLowerCase()).toContain('recorded');
  });

  it('enables dual-channel recording on <Dial>', () => {
    const xml = buildOutboundTwiml(OPTS);
    expect(xml).toContain('record="record-from-answer-dual"');
  });

  it('includes the recordingStatusCallback URL on <Dial>', () => {
    const xml = buildOutboundTwiml(OPTS);
    expect(xml).toContain(`recordingStatusCallback="${OPTS.statusCallbackUrl}"`);
  });

  it('dials the correct E.164 number inside <Number>', () => {
    const xml = buildOutboundTwiml(OPTS);
    expect(xml).toContain(`<Number>${OPTS.toE164}</Number>`);
  });

  it('uses Polly.Joanna voice on <Say>', () => {
    const xml = buildOutboundTwiml(OPTS);
    expect(xml).toContain('voice="Polly.Joanna"');
  });
});
