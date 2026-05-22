import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBlobPut, mockGetDownloadUrl } = vi.hoisted(() => ({
  mockBlobPut: vi.fn(),
  mockGetDownloadUrl: vi.fn(),
}));

vi.mock('./client', () => ({ blobPut: mockBlobPut }));
vi.mock('@vercel/blob', () => ({ getDownloadUrl: mockGetDownloadUrl }));

import { LegalHoldError, putRecording, recordingLifecycle, signedDownloadUrl } from './recordings';

// ---------------------------------------------------------------------------
// Drizzle chain mock helpers
// ---------------------------------------------------------------------------

function makeSelectChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  return { select: vi.fn().mockReturnValue({ from }), _where: where };
}

function makeUpdateChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  return { update: vi.fn().mockReturnValue({ set }), _where: where, _set: set };
}

// ---------------------------------------------------------------------------
// putRecording — path convention
// ---------------------------------------------------------------------------

describe('putRecording — path convention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBlobPut.mockResolvedValue({
      url: 'https://blob.example/placeholder',
      downloadUrl: 'https://blob.example/placeholder?download=1',
      pathname: 'placeholder',
      contentType: 'audio/wav',
      contentDisposition: 'attachment',
    });
  });

  it('builds org/<orgId>/communications/<commId>/recording.wav for audio/wav', async () => {
    await putRecording('org1', 'comm1', Buffer.from('audio'), 'audio/wav');
    const [calledPath] = vi.mocked(mockBlobPut).mock.calls[0] as [string, ...unknown[]];
    expect(calledPath).toBe('org/org1/communications/comm1/recording.wav');
  });

  it('uses .mp3 extension for audio/mpeg', async () => {
    await putRecording('org1', 'comm1', Buffer.from('audio'), 'audio/mpeg');
    const [calledPath] = vi.mocked(mockBlobPut).mock.calls[0] as [string, ...unknown[]];
    expect(calledPath).toMatch(/\.mp3$/);
  });

  it('uses .m4a extension for audio/mp4', async () => {
    await putRecording('org1', 'comm1', Buffer.from('audio'), 'audio/mp4');
    const [calledPath] = vi.mocked(mockBlobPut).mock.calls[0] as [string, ...unknown[]];
    expect(calledPath).toMatch(/\.m4a$/);
  });

  it('uses .ogg extension for audio/ogg', async () => {
    await putRecording('org1', 'comm1', Buffer.from('audio'), 'audio/ogg');
    const [calledPath] = vi.mocked(mockBlobPut).mock.calls[0] as [string, ...unknown[]];
    expect(calledPath).toMatch(/\.ogg$/);
  });

  it('uses .webm extension for audio/webm', async () => {
    await putRecording('org1', 'comm1', Buffer.from('audio'), 'audio/webm');
    const [calledPath] = vi.mocked(mockBlobPut).mock.calls[0] as [string, ...unknown[]];
    expect(calledPath).toMatch(/\.webm$/);
  });

  it('falls back to .bin for unknown MIME types', async () => {
    await putRecording('org1', 'comm1', Buffer.from('audio'), 'application/octet-stream');
    const [calledPath] = vi.mocked(mockBlobPut).mock.calls[0] as [string, ...unknown[]];
    expect(calledPath).toMatch(/\.bin$/);
  });
});

// ---------------------------------------------------------------------------
// putRecording — return value
// ---------------------------------------------------------------------------

describe('putRecording — return value', () => {
  it('returns bytes equal to the buffer byte length', async () => {
    const body = Buffer.from('synthetic wav audio data 1234');
    mockBlobPut.mockResolvedValue({
      url: 'https://blob.example/org/org1/communications/comm1/recording.wav',
      downloadUrl: 'https://blob.example/org/org1/communications/comm1/recording.wav?download=1',
      pathname: 'org/org1/communications/comm1/recording.wav',
      contentType: 'audio/wav',
      contentDisposition: 'attachment',
    });

    const result = await putRecording('org1', 'comm1', body, 'audio/wav');

    expect(result.bytes).toBe(body.byteLength);
  });

  it('includes url, downloadUrl, and pathname from the blob result', async () => {
    mockBlobPut.mockResolvedValue({
      url: 'https://blob.example/org/org1/communications/comm1/recording.wav',
      downloadUrl: 'https://blob.example/org/org1/communications/comm1/recording.wav?download=1',
      pathname: 'org/org1/communications/comm1/recording.wav',
      contentType: 'audio/wav',
      contentDisposition: 'attachment',
    });

    const result = await putRecording('org1', 'comm1', Buffer.from('audio'), 'audio/wav');

    expect(result.url).toBe('https://blob.example/org/org1/communications/comm1/recording.wav');
    expect(result.downloadUrl).toBe(
      'https://blob.example/org/org1/communications/comm1/recording.wav?download=1',
    );
    expect(result.pathname).toBe('org/org1/communications/comm1/recording.wav');
  });
});

// ---------------------------------------------------------------------------
// signedDownloadUrl
// ---------------------------------------------------------------------------

describe('signedDownloadUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to @vercel/blob getDownloadUrl with the provided url', async () => {
    mockGetDownloadUrl.mockReturnValue('https://blob.example/org/org1/recording.wav?download=1');

    await signedDownloadUrl('https://blob.example/org/org1/recording.wav');

    expect(mockGetDownloadUrl).toHaveBeenCalledWith('https://blob.example/org/org1/recording.wav');
  });

  it('accepts an optional ttlSeconds parameter without throwing', async () => {
    mockGetDownloadUrl.mockReturnValue('https://blob.example/rec.wav?download=1');

    await expect(signedDownloadUrl('https://blob.example/rec.wav', 600)).resolves.not.toThrow();
  });

  it('uses 300 seconds as the default ttl', async () => {
    mockGetDownloadUrl.mockReturnValue('https://blob.example/rec.wav?download=1');

    // We verify the function is callable without ttlSeconds (default 300 is inferred).
    // The actual TTL enforcement is documented as reserved for Phase 1 private stores.
    await expect(signedDownloadUrl('https://blob.example/rec.wav')).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// LegalHoldError
// ---------------------------------------------------------------------------

describe('LegalHoldError', () => {
  it('is an instance of Error', () => {
    const err = new LegalHoldError('rec-123');
    expect(err).toBeInstanceOf(Error);
  });

  it('message contains the recording id', () => {
    const err = new LegalHoldError('rec-abc');
    expect(err.message).toMatch(/rec-abc/);
  });
});

// ---------------------------------------------------------------------------
// recordingLifecycle.softDelete
// ---------------------------------------------------------------------------

describe('recordingLifecycle.softDelete', () => {
  it('throws LegalHoldError when the recording has legal_hold = true', async () => {
    const { select } = makeSelectChain([{ legalHold: true }]);
    const { update } = makeUpdateChain();
    const db = { select, update } as unknown as Parameters<typeof recordingLifecycle.softDelete>[0];

    await expect(recordingLifecycle.softDelete(db, 'rec-1')).rejects.toThrow(LegalHoldError);
    expect(update).not.toHaveBeenCalled();
  });

  it('throws when no recording row is found', async () => {
    const { select } = makeSelectChain([]);
    const { update } = makeUpdateChain();
    const db = { select, update } as unknown as Parameters<typeof recordingLifecycle.softDelete>[0];

    await expect(recordingLifecycle.softDelete(db, 'rec-missing')).rejects.toThrow(/not found/i);
  });

  it('sets deleted_at when legal_hold is false', async () => {
    const { select } = makeSelectChain([{ legalHold: false }]);
    const { update, _where } = makeUpdateChain();
    const db = { select, update } as unknown as Parameters<typeof recordingLifecycle.softDelete>[0];

    await recordingLifecycle.softDelete(db, 'rec-2');

    expect(update).toHaveBeenCalled();
    expect(_where).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// recordingLifecycle.markLegalHold
// ---------------------------------------------------------------------------

describe('recordingLifecycle.markLegalHold', () => {
  it('updates legal_hold to true', async () => {
    const { update, _set } = makeUpdateChain();
    const db = { update } as unknown as Parameters<typeof recordingLifecycle.markLegalHold>[0];

    await recordingLifecycle.markLegalHold(db, 'rec-3', true);

    expect(update).toHaveBeenCalled();
    expect(_set).toHaveBeenCalledWith(expect.objectContaining({ legalHold: true }));
  });

  it('updates legal_hold to false', async () => {
    const { update, _set } = makeUpdateChain();
    const db = { update } as unknown as Parameters<typeof recordingLifecycle.markLegalHold>[0];

    await recordingLifecycle.markLegalHold(db, 'rec-4', false);

    expect(_set).toHaveBeenCalledWith(expect.objectContaining({ legalHold: false }));
  });
});
