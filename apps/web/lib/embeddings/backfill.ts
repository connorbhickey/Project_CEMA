import { communications, deals, documents } from '@cema/db';
import { embedText } from '@cema/embeddings';
import { and, eq, isNull } from 'drizzle-orm';

import { withRls } from '../with-rls';

export interface BackfillEmbeddingsResult {
  commsProcessed: number;
  commsEmbedded: number;
  docsProcessed: number;
  docsEmbedded: number;
  errors: number;
}

export async function backfillEmbeddings(orgId: string): Promise<BackfillEmbeddingsResult> {
  const stats: BackfillEmbeddingsResult = {
    commsProcessed: 0,
    commsEmbedded: 0,
    docsProcessed: 0,
    docsEmbedded: 0,
    errors: 0,
  };

  await withRls(orgId, async (tx) => {
    // --- communications ---
    const commRows = await tx
      .select({
        id: communications.id,
        aiSummary: communications.aiSummary,
        sourceThreadId: communications.sourceThreadId,
      })
      .from(communications)
      .where(and(eq(communications.organizationId, orgId), isNull(communications.embedding)));

    for (const c of commRows) {
      stats.commsProcessed += 1;
      const text = c.aiSummary?.trim() || c.sourceThreadId?.trim();
      if (!text) continue;
      try {
        const { embedding } = await embedText({ text });
        await tx
          .update(communications)
          .set({ embedding, embeddingGeneratedAt: new Date() })
          .where(eq(communications.id, c.id));
        stats.commsEmbedded += 1;
      } catch (e) {
        stats.errors += 1;
        void e;
      }
    }

    // --- documents (scoped via deals.organizationId) ---
    const docRows = await tx
      .select({
        id: documents.id,
        blobUrl: documents.blobUrl,
        kind: documents.kind,
      })
      .from(documents)
      .innerJoin(deals, eq(documents.dealId, deals.id))
      .where(and(eq(deals.organizationId, orgId), isNull(documents.embedding)));

    for (const d of docRows) {
      stats.docsProcessed += 1;
      // Use blobUrl as the text seed (filename-like) falling back to kind
      const text = d.blobUrl?.trim() || d.kind?.trim();
      if (!text) continue;
      try {
        const { embedding } = await embedText({ text });
        await tx
          .update(documents)
          .set({ embedding, embeddingGeneratedAt: new Date() })
          .where(eq(documents.id, d.id));
        stats.docsEmbedded += 1;
      } catch (e) {
        stats.errors += 1;
        void e;
      }
    }
  });

  return stats;
}
