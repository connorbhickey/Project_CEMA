import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/integrations-docusign', () => ({
  verifyDocusignSignature: vi.fn(),
  parseDocusignConnectPayload: vi.fn(),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  docusignEnvelopes: { id: 'id_col', docusignEnvelopeId: 'env_id_col' },
  orgDocusignConnections: { id: 'id_col', connectSecret: 'secret_col' },
}));

vi.mock('@cema/compliance', () => ({ emitAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@cema/queues', () => ({ publish: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/queue', () => ({ vercelQueueSend: vi.fn().mockResolvedValue(undefined) }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn().mockReturnValue({}) }));
vi.mock('@cema/cache', () => ({
  acquireIdempotencyKey: vi.fn().mockResolvedValue(true),
  releaseIdempotencyKey: vi.fn().mockResolvedValue(undefined),
}));

import { acquireIdempotencyKey } from '@cema/cache';
import { emitAuditEvent } from '@cema/compliance';
import { getDb } from '@cema/db';
import { parseDocusignConnectPayload, verifyDocusignSignature } from '@cema/integrations-docusign';

function makeReq(body: string, sig = 'sig') {
  return new Request('https://example.com/api/webhooks/docusign', {
    method: 'POST',
    headers: { 'x-docusign-signature-1': sig, 'content-type': 'application/json' },
    body,
  });
}

describe('POST /api/webhooks/docusign', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns 400 when body is not valid JSON', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeReq('not-json'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when envelopeId is missing', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeReq(JSON.stringify({ event: 'envelope-sent', data: {} })));
    expect(res.status).toBe(400);
  });

  it('returns 200 when the envelope is unknown', async () => {
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>);
    const { POST } = await import('./route');
    const res = await POST(
      makeReq(JSON.stringify({ event: 'envelope-sent', data: { envelopeId: 'unknown' } })),
    );
    expect(res.status).toBe(200);
  });

  it('returns 401 on bad signature', async () => {
    const selectFn = vi.fn();
    selectFn.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              envelopeRowId: 'row-1',
              organizationId: 'org-1',
              documentId: 'doc-1',
              docusignConnectionId: 'conn-1',
            },
          ]),
        }),
      }),
    });
    selectFn.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ connectSecret: 'secret' }]),
        }),
      }),
    });
    vi.mocked(getDb).mockReturnValue({
      select: selectFn,
    } as unknown as ReturnType<typeof getDb>);
    vi.mocked(verifyDocusignSignature).mockReturnValue(false);
    const { POST } = await import('./route');
    const res = await POST(
      makeReq(JSON.stringify({ event: 'envelope-sent', data: { envelopeId: 'env-1' } })),
    );
    expect(res.status).toBe(401);
  });

  it('skips the update + audit when this status-change event was already processed', async () => {
    const selectFn = vi.fn();
    selectFn.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              envelopeRowId: 'row-1',
              organizationId: 'org-1',
              documentId: 'doc-1',
              docusignConnectionId: 'conn-1',
            },
          ]),
        }),
      }),
    });
    selectFn.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ connectSecret: 'secret' }]),
        }),
      }),
    });
    const updateFn = vi.fn();
    vi.mocked(getDb).mockReturnValue({
      select: selectFn,
      update: updateFn,
    } as unknown as ReturnType<typeof getDb>);
    vi.mocked(verifyDocusignSignature).mockReturnValue(true);
    vi.mocked(parseDocusignConnectPayload).mockReturnValue({
      event: 'envelope-completed',
      status: 'completed',
      statusChangedDateTime: '2026-06-07T00:00:00Z',
      recipients: [],
      voidedReason: null,
    } as unknown as ReturnType<typeof parseDocusignConnectPayload>);
    vi.mocked(acquireIdempotencyKey).mockResolvedValueOnce(false); // duplicate delivery

    const { POST } = await import('./route');
    const res = await POST(
      makeReq(JSON.stringify({ event: 'envelope-completed', data: { envelopeId: 'env-1' } })),
    );
    expect(res.status).toBe(200);
    expect(updateFn).not.toHaveBeenCalled();
    expect(vi.mocked(emitAuditEvent)).not.toHaveBeenCalled();
  });
});
