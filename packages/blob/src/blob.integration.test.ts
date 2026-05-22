/**
 * Integration tests for @cema/blob — run against real Vercel Blob storage.
 * Automatically skipped when BLOB_READ_WRITE_TOKEN is not set.
 * To run locally: BLOB_READ_WRITE_TOKEN=<token> pnpm --filter @cema/blob test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { blobDel } from './client';
import { putRecording, signedDownloadUrl } from './recordings';

const hasToken = !!process.env.BLOB_READ_WRITE_TOKEN;

// Minimal WAV-shaped buffer — not playable, but passes content-type routing.
function syntheticWav(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes, 0);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(sizeBytes - 8, 4);
  buf.write('WAVE', 8);
  return buf;
}

describe.skipIf(!hasToken)('Blob integration (requires BLOB_READ_WRITE_TOKEN)', () => {
  const orgId = 'integration-test-org';
  const communicationId = `comm-${Date.now()}`;
  let uploadedUrl = '';

  beforeAll(async () => {
    const wav = syntheticWav(1024);
    const result = await putRecording(orgId, communicationId, wav, 'audio/wav');
    uploadedUrl = result.url;
  });

  afterAll(async () => {
    if (uploadedUrl) await blobDel(uploadedUrl);
  });

  it('putRecording returns url, pathname, and correct byte count', async () => {
    const wav = syntheticWav(1024);
    const result = await putRecording(orgId, `comm-assert-${Date.now()}`, wav, 'audio/wav');

    expect(result.url).toMatch(/^https:\/\//);
    expect(result.pathname).toMatch(new RegExp(`^org/${orgId}/communications/.+/recording\\.wav$`));
    expect(result.bytes).toBe(1024);

    await blobDel(result.url);
  });

  it('signedDownloadUrl returns a non-empty url for the uploaded blob', async () => {
    const downloadUrl = await signedDownloadUrl(uploadedUrl);
    expect(downloadUrl).toMatch(/^https:\/\//);
  });

  it('the download url responds with 200', async () => {
    const downloadUrl = await signedDownloadUrl(uploadedUrl);
    const res = await fetch(downloadUrl);
    expect(res.status).toBe(200);
  });
});
