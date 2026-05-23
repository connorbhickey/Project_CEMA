import { getTypesenseClient } from './client';
import { COMMUNICATIONS_COLLECTION, DOCUMENTS_COLLECTION } from './collections';

export interface TypesenseFilters {
  organizationId: string;
  kind?: string;
}

export interface TypesenseHit {
  kind: 'communication' | 'document';
  id: string;
  textMatchScore: number;
}

export async function searchTypesense(
  query: string,
  filters: TypesenseFilters,
): Promise<TypesenseHit[]> {
  const client = getTypesenseClient();
  const orgFilter = `organization_id:=${filters.organizationId}`;

  const [commResults, docResults] = await Promise.allSettled([
    client.collections(COMMUNICATIONS_COLLECTION).documents().search({
      q: query,
      query_by: 'subject,body_preview',
      filter_by: orgFilter,
      per_page: 10,
    }),
    client.collections(DOCUMENTS_COLLECTION).documents().search({
      q: query,
      query_by: 'filename',
      filter_by: orgFilter,
      per_page: 10,
    }),
  ]);

  const hits: TypesenseHit[] = [];

  if (commResults.status === 'fulfilled') {
    for (const hit of commResults.value.hits ?? []) {
      const doc = hit.document as Record<string, unknown>;
      hits.push({
        kind: 'communication',
        id: doc['id'] as string,
        textMatchScore: hit.text_match ?? 0,
      });
    }
  }

  if (docResults.status === 'fulfilled') {
    for (const hit of docResults.value.hits ?? []) {
      const doc = hit.document as Record<string, unknown>;
      hits.push({
        kind: 'document',
        id: doc['id'] as string,
        textMatchScore: hit.text_match ?? 0,
      });
    }
  }

  return hits.sort((a, b) => b.textMatchScore - a.textMatchScore);
}
