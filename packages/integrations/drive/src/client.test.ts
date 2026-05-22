import { describe, expect, it, vi } from 'vitest';

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn().mockReturnValue({
      files: {
        get: vi.fn().mockImplementation((params: { fileId: string; alt?: string }) => {
          if (params.alt === 'media') {
            return Promise.resolve({ data: Buffer.from('hello-drive-bytes') });
          }
          return Promise.resolve({
            data: {
              id: params.fileId,
              name: 'payoff.pdf',
              mimeType: 'application/pdf',
              size: '12345',
              parents: ['parentFolder'],
              trashed: false,
              modifiedTime: '2026-05-20T12:00:00.000Z',
            },
          });
        }),
        watch: vi.fn().mockResolvedValue({
          data: {
            id: 'channel-abc',
            expiration: '1716100000000',
            resourceId: 'resource-xyz',
          },
        }),
      },
    }),
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
      })),
    },
  },
}));

import { downloadDriveFileBytes, fetchDriveFile, getDriveClient, startDriveWatch } from './client';

describe('fetchDriveFile', () => {
  it('returns NormalizedDriveFile', async () => {
    const drive = getDriveClient({ refreshToken: 'rt' });
    const file = await fetchDriveFile(drive, 'file-1');
    expect(file.fileName).toBe('payoff.pdf');
    expect(file.mimeType).toBe('application/pdf');
    expect(file.sizeBytes).toBe(12345);
    expect(file.driveFolderId).toBe('parentFolder');
    expect(file.trashed).toBe(false);
  });
});

describe('downloadDriveFileBytes', () => {
  it('returns the file bytes as a Buffer', async () => {
    const drive = getDriveClient({ refreshToken: 'rt' });
    const bytes = await downloadDriveFileBytes(drive, 'file-1');
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.toString()).toBe('hello-drive-bytes');
  });
});

describe('startDriveWatch', () => {
  it('starts a watch channel and returns expiration + resourceId', async () => {
    const drive = getDriveClient({ refreshToken: 'rt' });
    const result = await startDriveWatch(drive, {
      fileId: 'file-1',
      channelId: 'channel-abc',
      channelToken: 'tok',
      webhookUrl: 'https://example.com/api/webhooks/drive',
      ttlSeconds: 86400,
    });
    expect(result.channelId).toBe('channel-abc');
    expect(result.resourceId).toBe('resource-xyz');
    expect(result.expiration).toBeInstanceOf(Date);
  });
});
