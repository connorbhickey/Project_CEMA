import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { TopicSchema } from './topics';

const VALID_PAYLOAD = {
  orgId: 'org-123',
  provider: 'ringcentral' as const,
  vendorCallId: 'call-abc',
  vendorEventId: 'event-xyz',
  vendorPayload: { type: 'recording.completed', data: {} },
  receivedAt: '2026-05-21T22:00:00.000Z',
};

describe('telephony.call.ingest schema', () => {
  const schema = TopicSchema['telephony.call.ingest'];

  it('accepts a fully valid payload', () => {
    expect(() => schema.parse(VALID_PAYLOAD)).not.toThrow();
  });

  it('returns all expected fields on a valid parse', () => {
    const result = schema.parse(VALID_PAYLOAD);
    expect(result).toMatchObject(VALID_PAYLOAD);
  });

  it('rejects when orgId is missing', () => {
    const { orgId: _, ...rest } = VALID_PAYLOAD;
    expect(() => schema.parse(rest)).toThrow(ZodError);
  });

  it('rejects when provider is not one of the allowed enum values', () => {
    expect(() => schema.parse({ ...VALID_PAYLOAD, provider: 'twilio_flex' })).toThrow(ZodError);
  });

  it('accepts all four valid provider values', () => {
    for (const provider of ['ringcentral', 'dialpad', 'zoom_phone', 'twilio'] as const) {
      expect(() => schema.parse({ ...VALID_PAYLOAD, provider })).not.toThrow();
    }
  });

  it('rejects when vendorCallId is missing', () => {
    const { vendorCallId: _, ...rest } = VALID_PAYLOAD;
    expect(() => schema.parse(rest)).toThrow(ZodError);
  });

  it('rejects when vendorEventId is missing', () => {
    const { vendorEventId: _, ...rest } = VALID_PAYLOAD;
    expect(() => schema.parse(rest)).toThrow(ZodError);
  });

  it('rejects when receivedAt is not a valid ISO datetime', () => {
    expect(() => schema.parse({ ...VALID_PAYLOAD, receivedAt: 'not-a-date' })).toThrow(ZodError);
  });

  it('accepts vendorPayload as any Record<string, unknown>', () => {
    expect(() =>
      schema.parse({ ...VALID_PAYLOAD, vendorPayload: { nested: { deep: true }, arr: [1, 2] } }),
    ).not.toThrow();
  });
});
