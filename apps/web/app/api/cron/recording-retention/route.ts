import { getDb, recordings } from '@cema/db';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

const BATCH_SIZE = 500;

export async function GET(): Promise<Response> {
  const db = getDb();

  const expired = await db
    .select({ id: recordings.id })
    .from(recordings)
    .where(
      and(
        lt(recordings.retentionUntil, sql`now()`),
        eq(recordings.legalHold, false),
        isNull(recordings.deletedAt),
      ),
    )
    .limit(BATCH_SIZE);

  if (expired.length === 0) {
    return Response.json({ purged: 0 });
  }

  const ids = expired.map((r) => r.id);

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

  return Response.json({ purged: ids.length });
}
