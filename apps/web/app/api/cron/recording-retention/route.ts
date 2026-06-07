import { blobDel } from '@cema/blob';
import { auditEvents, communications, getDb, recordings } from '@cema/db';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import { withCronSpan } from '@/lib/observability/cron-span';

const BATCH_SIZE = 500;

// CLAUDE.md §10.5 (audit log immutability): every communication-recording state
// change MUST emit an audit event. Soft-deletion counts as a state change, so
// the cron inserts one audit row per purged recording in a single bulk insert
// after the soft-delete write succeeds.
export async function GET(req: Request): Promise<Response> {
  // Vercel cron sets `Authorization: Bearer ${CRON_SECRET}` on every invocation.
  // Reject anything else to prevent unauthorized data destruction via the
  // public route URL. CRON_SECRET is auto-provisioned by Vercel.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  try {
    const result = await withCronSpan('recording_retention', async () => {
      const db = getDb();

      // Join with communications to pick up organization_id for each recording —
      // recordings has no direct org_id; the org lives one hop away. We need it
      // for the audit_events.organization_id NOT NULL column.
      const expired = await db
        .select({
          id: recordings.id,
          organizationId: communications.organizationId,
          recordingBlobUrl: recordings.recordingBlobUrl,
          transcriptBlobUrl: recordings.transcriptBlobUrl,
        })
        .from(recordings)
        .innerJoin(communications, eq(recordings.communicationId, communications.id))
        .where(
          and(
            lt(recordings.retentionUntil, sql`now()`),
            eq(recordings.legalHold, false),
            isNull(recordings.deletedAt),
          ),
        )
        .limit(BATCH_SIZE);

      if (expired.length === 0) {
        return { purged: 0, failedDeletes: 0 };
      }

      const ids = expired.map((r) => r.id);

      // Physically delete the blobs from Vercel Blob BEFORE zeroing the DB URLs.
      // Otherwise the soft-delete only un-links the blob in our DB while it stays
      // accessible at its (unguessable) URL forever -- an orphan + privacy gap.
      // Best-effort: a failed del is counted but never blocks the soft-delete, and
      // Vercel Blob del() is idempotent so a re-run is safe (resolves M9 carry-over #3).
      const blobUrls = expired
        .flatMap((r) => [r.recordingBlobUrl, r.transcriptBlobUrl])
        .filter((u): u is string => typeof u === 'string' && u.length > 0);
      const delResults = await Promise.allSettled(blobUrls.map((u) => blobDel(u)));
      const failedDeletes = delResults.filter((r) => r.status === 'rejected').length;

      await db
        .update(recordings)
        .set({
          deletedAt: sql`now()`,
          recordingBlobUrl: '',
          recordingBlobPathname: '',
          transcriptBlobUrl: null,
          transcriptBlobPathname: null,
        })
        .where(inArray(recordings.id, ids));

      // Audit-event row per soft-deleted recording. actorUserId is null
      // (system-initiated cron) per the audit schema's actorUserId nullable spec.
      const auditRows = expired.map((r) => ({
        organizationId: r.organizationId,
        action: 'recording.soft_deleted',
        entityType: 'recording',
        entityId: r.id,
        metadata: {
          reason: 'retention_expired',
          cron: 'recording-retention',
          batchSize: expired.length,
        },
      }));
      await db.insert(auditEvents).values(auditRows);

      return { purged: ids.length, failedDeletes };
    });

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return Response.json({ purged: 0, error: message }, { status: 500 });
  }
}
