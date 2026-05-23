import { getCurrentOrganizationId } from '@cema/auth';
import { getDb, organizations } from '@cema/db';
import { addMemory, isMemoryConfigured, searchMemory } from '@cema/memory';
import { classifyQueryIntent, type QueryClassification } from '@cema/search';
import { isTypesenseConfigured, searchTypesense, type TypesenseHit } from '@cema/typesense';
import { eq } from 'drizzle-orm';

import { searchSimilar, type SearchHit } from './search-similar';

export interface AskAnythingResult {
  classification: QueryClassification;
  hits: SearchHit[];
  hint: string | null;
  memoryContext: string[];
}

function adaptTypesenseHit(hit: TypesenseHit): SearchHit {
  return {
    kind: hit.kind,
    id: hit.id,
    cosineDistance: 0.5,
    similarity: 0.5,
    preview: '(full-text match)',
  };
}

export async function askAnything(
  query: string,
  k = 10,
  dealId?: string,
  sessionId?: string,
): Promise<AskAnythingResult> {
  const classification = await classifyQueryIntent(query);

  const memoryContext: string[] = [];

  if (isMemoryConfigured() && dealId) {
    const memories = await searchMemory(dealId, query);
    for (const m of memories) {
      memoryContext.push(m.memory);
    }
  }

  if (classification.intent === 'search') {
    const pgHits = await searchSimilar({ query, k });

    let mergedHits = pgHits;

    if (isTypesenseConfigured()) {
      const clerkOrgId = await getCurrentOrganizationId();
      const db = getDb();
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.clerkOrgId, clerkOrgId),
      });

      if (org) {
        const tsHits = await searchTypesense(query, { organizationId: org.id });
        const pgIds = new Set(pgHits.map((h) => h.id));
        const tsAdditional = tsHits.filter((h) => !pgIds.has(h.id)).map(adaptTypesenseHit);
        mergedHits = [...pgHits, ...tsAdditional].slice(0, k);
      }
    }

    if (isMemoryConfigured() && dealId && sessionId) {
      void addMemory(dealId, query, sessionId);
    }

    return { classification, hits: mergedHits, hint: null, memoryContext };
  }

  if (classification.intent === 'action') {
    return {
      classification,
      hits: [],
      hint: 'Action queries are not yet executed automatically. Phase 1 will surface concrete action suggestions.',
      memoryContext,
    };
  }

  return {
    classification,
    hits: [],
    hint: 'Analytics queries are not yet executed. Phase 1 will translate this query into SQL.',
    memoryContext,
  };
}
