import { type DbOrTx, recordings } from '@cema/db';
import { getDownloadUrl } from '@vercel/blob';
import { eq } from 'drizzle-orm';

import { blobPut } from './client';

// Maps audio MIME types to file extensions for deterministic blob pathnames.
const MIME_TO_EXT: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/mp4a-latm': 'm4a',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
};

function extFromMime(mimeType: string): string {
  return MIME_TO_EXT[mimeType.toLowerCase()] ?? 'bin';
}

export async function putRecording(
  orgId: string,
  communicationId: string,
  body: Buffer,
  mimeType: string,
): Promise<{ url: string; downloadUrl: string; pathname: string; bytes: number }> {
  const ext = extFromMime(mimeType);
  const pathname = `org/${orgId}/communications/${communicationId}/recording.${ext}`;
  const result = await blobPut(pathname, body, mimeType);
  return {
    url: result.url,
    downloadUrl: result.downloadUrl,
    pathname: result.pathname,
    bytes: body.byteLength,
  };
}

/**
 * Returns a download URL for the given blob URL.
 *
 * ttlSeconds is accepted for API stability but Vercel Blob v1 public stores
 * do not enforce TTL-based expiry. Phase 1 will re-evaluate when the store
 * transitions to private mode with token-gated access.
 */
export function signedDownloadUrl(blobUrl: string, _ttlSeconds = 300): Promise<string> {
  return Promise.resolve(getDownloadUrl(blobUrl));
}

export class LegalHoldError extends Error {
  constructor(recordingId: string) {
    super(`recording ${recordingId} is on legal hold and cannot be deleted`);
    this.name = 'LegalHoldError';
  }
}

export const recordingLifecycle = {
  async markLegalHold(db: DbOrTx, recordingId: string, hold: boolean): Promise<void> {
    await db.update(recordings).set({ legalHold: hold }).where(eq(recordings.id, recordingId));
  },

  async softDelete(db: DbOrTx, recordingId: string): Promise<void> {
    const [rec] = await db
      .select({ legalHold: recordings.legalHold })
      .from(recordings)
      .where(eq(recordings.id, recordingId));

    if (!rec) throw new Error(`recording ${recordingId} not found`);
    if (rec.legalHold) throw new LegalHoldError(recordingId);

    await db
      .update(recordings)
      .set({ deletedAt: new Date() })
      .where(eq(recordings.id, recordingId));
  },
};
