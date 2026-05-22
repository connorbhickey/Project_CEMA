import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { createHandler } from './consume';

const VALID_PAYLOAD = {
  orgId: 'org-456',
  provider: 'zoom_phone' as const,
  vendorCallId: 'call-zp-1',
  vendorEventId: 'evt-zp-1',
  vendorPayload: { recording_url: 'https://example.com/rec.mp4' },
  receivedAt: '2026-05-21T23:00:00.000Z',
};

describe('createHandler', () => {
  it('returns a function', () => {
    const fn = createHandler('telephony.call.ingest', vi.fn());
    expect(typeof fn).toBe('function');
  });

  it('calls the handler with the validated payload when raw input is valid', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const fn = createHandler('telephony.call.ingest', handler);

    await fn(VALID_PAYLOAD);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(VALID_PAYLOAD);
  });

  it('throws ZodError and does NOT call handler when raw input is invalid', async () => {
    const handler = vi.fn();
    const fn = createHandler('telephony.call.ingest', handler);

    await expect(fn({ ...VALID_PAYLOAD, provider: 'not_valid' })).rejects.toThrow(ZodError);

    expect(handler).not.toHaveBeenCalled();
  });

  it('throws ZodError when a required field is absent', async () => {
    const handler = vi.fn();
    const fn = createHandler('telephony.call.ingest', handler);
    const { vendorEventId: _, ...missingField } = VALID_PAYLOAD;

    await expect(fn(missingField)).rejects.toThrow(ZodError);

    expect(handler).not.toHaveBeenCalled();
  });

  it('handler receives a fully typed payload with correct provider value', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const fn = createHandler('telephony.call.ingest', handler);

    await fn(VALID_PAYLOAD);

    const capturedPayload = handler.mock.calls[0]?.[0] as typeof VALID_PAYLOAD;
    expect(capturedPayload.provider).toBe('zoom_phone');
  });
});
