import { getCurrentOrganizationId } from '@cema/auth';
import { communications, deals, documents, getDb, organizations } from '@cema/db';
import { embedText } from '@cema/embeddings';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { withRls } from '../with-rls';

export type SearchEntityKind = 'communication' | 'document' | 'all';

export interface SearchHit {
  kind: 'communication' | 'document';
  id: string;
  cosineDistance: number;
  similarity: number;
  preview: string;
}

export interface SearchSimilarInput {
  query: string;
  kind?: SearchEntityKind;
  k?: number;
}

export async function searchSimilar(input: SearchSimilarInput): Promise<SearchHit[]> {
  const { query, kind = 'all', k = 10 } = input;
  if (!query.trim()) return [];

  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const { embedding } = await embedText({ text: query });
  const vectorLiteral = sql.raw(`'[${embedding.join(',')}]'::vector`);

  return withRls(org.id, async (tx) => {
    const hits: SearchHit[] = [];

    if (kind === 'communication' || kind === 'all') {
      const rows = await tx
        .select({
          id: communications.id,
          aiSummary: communications.aiSummary,
          sourceThreadId: communications.sourceThreadId,
          distance: sql<number>`${communications.embedding} <=> ${vectorLiteral}`,
        })
        .from(communications)
        .where(and(eq(communications.organizationId, org.id), isNotNull(communications.embedding)))
        .orderBy(sql`${communications.embedding} <=> ${vectorLiteral}`)
        .limit(k);

      for (const r of rows) {
        hits.push({
          kind: 'communication',
          id: r.id,
          cosineDistance: r.distance,
          similarity: 1 - r.distance / 2,
          preview: r.aiSummary ?? r.sourceThreadId ?? '(no preview)',
        });
      }
    }

    if (kind === 'document' || kind === 'all') {
      // documents are scoped to deals, not directly to orgs — join through deals
      const rows = await tx
        .select({
          id: documents.id,
          blobUrl: documents.blobUrl,
          kind: documents.kind,
          distance: sql<number>`${documents.embedding} <=> ${vectorLiteral}`,
        })
        .from(documents)
        .innerJoin(deals, eq(documents.dealId, deals.id))
        .where(and(eq(deals.organizationId, org.id), isNotNull(documents.embedding)))
        .orderBy(sql`${documents.embedding} <=> ${vectorLiteral}`)
        .limit(k);

      for (const r of rows) {
        hits.push({
          kind: 'document',
          id: r.id,
          cosineDistance: r.distance,
          similarity: 1 - r.distance / 2,
          preview: r.blobUrl ?? r.kind ?? '(no preview)',
        });
      }
    }

    return hits.sort((a, b) => a.cosineDistance - b.cosineDistance).slice(0, k);
  });
}
