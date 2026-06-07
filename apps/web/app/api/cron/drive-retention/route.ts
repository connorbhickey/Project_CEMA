import { blobDel } from '@cema/blob';
import { auditEvents, driveFiles, getDb } from '@cema/db';
import { and, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';

import { withCronSpan } from '@/lib/observability/cron-span';

const BATCH_SIZE = 500;

// Retires the mirrored Vercel Blob for a Drive file 30 days after the source file
// was trashed in Drive (`drive_files.trashedAt`). Mirrors recording-retention: the
// physical blob is deleted (otherwise it stays accessible at its URL forever -- an
// orphan + privacy gap) and the DB blob refs are zeroed. Dormant until the Drive
// sync populates `trashedAt`. Resolves M4 carry-over #12 (Drive Blob retention).
export async function GET(req: Request): Promise<Response> {
  // Vercel cron sets `Authorization: Bearer ${CRON_SECRET}`. Reject anything else
  // to prevent unauthorized data destruction via the public route URL.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await withCronSpan('drive_retention', async () => {
      const db = getDb();

      // drive_files carries organization_id directly (unlike recordings), so no join.
      const expired = await db
        .select({
          id: driveFiles.id,
          organizationId: driveFiles.organizationId,
          blobUrl: driveFiles.blobUrl,
        })
        .from(driveFiles)
        .where(
          and(
            isNotNull(driveFiles.trashedAt),
            lt(driveFiles.trashedAt, sql`now() - interval '30 days'`),
            isNotNull(driveFiles.blobUrl),
            ne(driveFiles.blobUrl, ''),
          ),
        )
        .limit(BATCH_SIZE);

      if (expired.length === 0) {
        return { purged: 0, failedDeletes: 0 };
      }

      const ids = expired.map((r) => r.id);

      // Delete the physical blobs before zeroing the DB refs (best-effort; a failed
      // del is counted, never blocks the cleanup; Vercel Blob del() is idempotent).
      const blobUrls = expired
        .map((r) => r.blobUrl)
        .filter((u): u is string => typeof u === 'string' && u.length > 0);
      const delResults = await Promise.allSettled(blobUrls.map((u) => blobDel(u)));
      const failedDeletes = delResults.filter((r) => r.status === 'rejected').length;

      await db
        .update(driveFiles)
        .set({ blobUrl: null, blobPathname: null })
        .where(inArray(driveFiles.id, ids));

      // Audit-event per purged file (CLAUDE.md §10.5 — data destruction is audited).
      const auditRows = expired.map((r) => ({
        organizationId: r.organizationId,
        action: 'drive_file.blob_purged',
        entityType: 'drive_file',
        entityId: r.id,
        metadata: {
          reason: 'trashed_retention_expired',
          cron: 'drive-retention',
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
