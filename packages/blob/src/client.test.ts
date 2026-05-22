import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPut, mockDel } = vi.hoisted(() => ({ mockPut: vi.fn(), mockDel: vi.fn() }));

vi.mock('@vercel/blob', () => ({ put: mockPut, del: mockDel }));

import { blobDel, blobPut } from './client';

describe('blobPut', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls @vercel/blob put with access public and no random suffix', async () => {
    mockPut.mockResolvedValue({
      url: 'https://blob.example/org/o1/rec.wav',
      downloadUrl: 'https://blob.example/org/o1/rec.wav?download=1',
      pathname: 'org/o1/rec.wav',
      contentType: 'audio/wav',
      contentDisposition: 'attachment',
    });

    await blobPut('org/o1/rec.wav', Buffer.from('audio'), 'audio/wav');

    expect(mockPut).toHaveBeenCalledWith(
      'org/o1/rec.wav',
      Buffer.from('audio'),
      expect.objectContaining({
        access: 'public',
        addRandomSuffix: false,
        contentType: 'audio/wav',
      }),
    );
  });

  it('returns the result from @vercel/blob verbatim', async () => {
    const blobResult = {
      url: 'https://blob.example/org/o1/rec.wav',
      downloadUrl: 'https://blob.example/org/o1/rec.wav?download=1',
      pathname: 'org/o1/rec.wav',
      contentType: 'audio/wav',
      contentDisposition: 'attachment',
    };
    mockPut.mockResolvedValue(blobResult);

    const result = await blobPut('org/o1/rec.wav', Buffer.from('audio'), 'audio/wav');

    expect(result).toEqual(blobResult);
  });
});

describe('blobDel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to @vercel/blob del with the provided url', async () => {
    mockDel.mockResolvedValue(undefined);

    await blobDel('https://blob.example/org/o1/rec.wav');

    expect(mockDel).toHaveBeenCalledWith('https://blob.example/org/o1/rec.wav', expect.any(Object));
  });
});
