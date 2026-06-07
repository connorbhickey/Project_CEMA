import { blobPut } from '@cema/blob';
import { acquireIdempotencyKey, releaseIdempotencyKey } from '@cema/cache';
import { emitAuditEvent } from '@cema/compliance';
import { communications, getDb, recordings } from '@cema/db';
import { parseTranscriptResponse, verifyDeepgramSignature } from '@cema/integrations-deepgram';
import { eq } from 'drizzle-orm';

interface DeepgramCallbackBody {
  metadata?: { request_id?: string };
}

export async function POST(req: Request): Promise<Response> {
  const webhookSecret = process.env.DEEPGRAM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response('DEEPGRAM_WEBHOOK_SECRET not configured', { status: 500 });
  }

  const signature = req.headers.get('Deepgram-Signature');
  if (!signature) {
    return new Response('Missing Deepgram-Signature', { status: 400 });
  }

  const rawBody = await req.text();

  if (!verifyDeepgramSignature(webhookSecret, signature, rawBody)) {
    return new Response('Invalid Deepgram signature', { status: 403 });
  }

  const body = JSON.parse(rawBody) as DeepgramCallbackBody;
  const requestId = body.metadata?.request_id;

  if (!requestId) {
    return new Response('Missing metadata.request_id in Deepgram payload', { status: 400 });
  }

  const db = getDb();

  const [recording] = await db
    .select()
    .from(recordings)
    .where(eq(recordings.vendorRequestId, requestId))
    .limit(1);

  if (!recording) {
    return new Response(`No recording found for Deepgram request_id ${requestId}`, {
      status: 404,
    });
  }

  // Idempotency: SETNX on the Deepgram request_id (one per transcription job, so a
  // re-delivery is always a retry). A duplicate skips the blob write + audit; the
  // key is released on failure so a genuine retry after a transient error can
  // re-acquire instead of waiting out the 24h TTL.
  const idempotencyKey = `webhook:idempo:deepgram:${requestId}`;
  if (!(await acquireIdempotencyKey(idempotencyKey))) {
    return new Response('OK', { status: 200 });
  }

  try {
    const [comm] = await db
      .select()
      .from(communications)
      .where(eq(communications.id, recording.communicationId))
      .limit(1);

    const normalized = parseTranscriptResponse(JSON.parse(rawBody) as unknown);
    const transcriptJson = JSON.stringify(normalized);
    const transcriptPathname = `recordings/${recording.id}/transcript.json`;

    const blob = await blobPut(transcriptPathname, transcriptJson, 'application/json');

    await db
      .update(recordings)
      .set({
        transcriptBlobUrl: blob.url,
        transcriptBlobPathname: blob.pathname,
        transcriptWordsCount: normalized.words.length,
        transcriptLanguage: normalized.language || null,
        transcriptProvider: 'deepgram-nova-3',
      })
      .where(eq(recordings.id, recording.id));

    await db
      .update(communications)
      .set({ status: 'ready' })
      .where(eq(communications.id, recording.communicationId));

    await emitAuditEvent(db, {
      organizationId: comm?.organizationId ?? '',
      action: 'communication.transcript.ready',
      entityType: 'communication',
      entityId: recording.communicationId,
      metadata: {
        recordingId: recording.id,
        transcriptPathname,
        wordsCount: normalized.words.length,
        transcriptProvider: 'deepgram-nova-3',
      },
    });

    return new Response('OK', { status: 200 });
  } catch (err) {
    await releaseIdempotencyKey(idempotencyKey);
    throw err;
  }
}
