import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { publish } from './publish';

const VALID_PAYLOAD = {
  orgId: 'org-123',
  provider: 'dialpad' as const,
  vendorCallId: 'call-abc',
  vendorEventId: 'event-xyz',
  vendorPayload: { event: 'call.ended' },
  receivedAt: '2026-05-21T22:00:00.000Z',
};

describe('publish', () => {
  it('calls sender with the validated payload when payload is valid', async () => {
    const sender = vi.fn().mockResolvedValue(undefined);

    await publish('telephony.call.ingest', VALID_PAYLOAD, sender);

    expect(sender).toHaveBeenCalledOnce();
    expect(sender).toHaveBeenCalledWith('telephony.call.ingest', VALID_PAYLOAD);
  });

  it('throws ZodError and does NOT call sender when payload is invalid', async () => {
    const sender = vi.fn();

    await expect(
      publish('telephony.call.ingest', { ...VALID_PAYLOAD, provider: 'bad_provider' }, sender),
    ).rejects.toThrow(ZodError);

    expect(sender).not.toHaveBeenCalled();
  });

  it('throws ZodError when a required field is missing', async () => {
    const sender = vi.fn();
    const { orgId: _, ...missingOrgId } = VALID_PAYLOAD;

    await expect(publish('telephony.call.ingest', missingOrgId, sender)).rejects.toThrow(ZodError);

    expect(sender).not.toHaveBeenCalled();
  });

  it('passes the topic name to the sender', async () => {
    const sender = vi.fn().mockResolvedValue(undefined);

    await publish('telephony.call.ingest', VALID_PAYLOAD, sender);

    const [calledTopic] = sender.mock.calls[0] as [string, ...unknown[]];
    expect(calledTopic).toBe('telephony.call.ingest');
  });
});
