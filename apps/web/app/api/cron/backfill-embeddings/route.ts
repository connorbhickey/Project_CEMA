import { communications, deals, documents, getDb } from '@cema/db';
import { publish } from '@cema/queues';
import { eq, isNull } from 'drizzle-orm';

import { withCronSpan } from '@/lib/observability/cron-span';
import { vercelQueueSend } from '@/lib/queue';

const BATCH_SIZE = 100;

export async function GET(): Promise<Response> {
  const result = await withCronSpan('backfill_embeddings', async () => {
    const db = getDb();

    const [commRows, docRows] = await Promise.all([
      db
        .select({ id: communications.id, organizationId: communications.organizationId })
        .from(communications)
        .where(isNull(communications.embeddingGeneratedAt))
        .limit(BATCH_SIZE),
      db
        .select({ id: documents.id, organizationId: deals.organizationId })
        .from(documents)
        .innerJoin(deals, eq(documents.dealId, deals.id))
        .where(isNull(documents.embeddingGeneratedAt))
        .limit(BATCH_SIZE),
    ]);

    await Promise.all([
      ...commRows.map((row) =>
        publish(
          'comms.embed',
          { orgId: row.organizationId, communicationId: row.id },
          vercelQueueSend,
        ),
      ),
      ...docRows.map((row) =>
        publish('docs.embed', { orgId: row.organizationId, documentId: row.id }, vercelQueueSend),
      ),
    ]);

    return { commsQueued: commRows.length, docsQueued: docRows.length };
  });

  return Response.json(result);
}
