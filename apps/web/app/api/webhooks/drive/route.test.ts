import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/integrations-drive', () => ({
  parseDriveNotificationHeaders: vi.fn(),
  verifyDriveChannelToken: vi.fn(),
  getDriveClient: vi.fn().mockReturnValue({}),
  fetchDriveFile: vi.fn(),
  downloadDriveFileBytes: vi.fn().mockResolvedValue(Buffer.from('bytes')),
}));

vi.mock('@cema/blob', () => ({
  blobPut: vi
    .fn()
    .mockResolvedValue({ pathname: 'drive/x/y/z.pdf', url: 'https://blob.example/z' }),
}));

vi.mock('@cema/db', () => ({
  getDb: vi.fn(),
  orgDriveConnections: { driveChannelId: 'ch_col' },
  driveFiles: { driveConnectionId: 'conn_id_col', driveFileId: 'file_id_col' },
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn().mockReturnValue({}) }));
vi.mock('@cema/queues', () => ({ publish: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/queue', () => ({ vercelQueueSend: vi.fn().mockResolvedValue(undefined) }));

import { getDb } from '@cema/db';
import { parseDriveNotificationHeaders, verifyDriveChannelToken } from '@cema/integrations-drive';

function makeReq(headers: Record<string, string>) {
  return new Request('https://example.com/api/webhooks/drive', {
    method: 'POST',
    headers,
    body: '',
  });
}

describe('POST /api/webhooks/drive', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns 400 when X-Goog headers are missing', async () => {
    vi.mocked(parseDriveNotificationHeaders).mockReturnValue(null);
    const { POST } = await import('./route');
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 200 when the channel is unknown', async () => {
    vi.mocked(parseDriveNotificationHeaders).mockReturnValue({
      channelId: 'unknown-ch',
      channelToken: 'tok',
      resourceState: 'update',
      resourceId: 'file-1',
      messageNumber: '1',
    });
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
    const res = await POST(makeReq({}));
    expect(res.status).toBe(200);
  });

  it('returns 401 when the channel token does not match', async () => {
    vi.mocked(parseDriveNotificationHeaders).mockReturnValue({
      channelId: 'ch-1',
      channelToken: 'wrong',
      resourceState: 'update',
      resourceId: 'file-1',
      messageNumber: '1',
    });
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                {
                  id: 'conn-1',
                  organizationId: 'org-1',
                  oauthRefreshToken: 'rt',
                  driveChannelToken: 'expected',
                },
              ]),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>);
    vi.mocked(verifyDriveChannelToken).mockReturnValue(false);
    const { POST } = await import('./route');
    const res = await POST(makeReq({}));
    expect(res.status).toBe(401);
  });

  it('returns 200 for an initial sync handshake', async () => {
    vi.mocked(parseDriveNotificationHeaders).mockReturnValue({
      channelId: 'ch-1',
      channelToken: 'tok',
      resourceState: 'sync',
      resourceId: 'file-1',
      messageNumber: '1',
    });
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                {
                  id: 'conn-1',
                  organizationId: 'org-1',
                  oauthRefreshToken: 'rt',
                  driveChannelToken: 'tok',
                },
              ]),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>);
    vi.mocked(verifyDriveChannelToken).mockReturnValue(true);
    const { POST } = await import('./route');
    const res = await POST(makeReq({}));
    expect(res.status).toBe(200);
  });
});
