import { classifyQueryIntent, type QueryClassification } from '@cema/search';

import { searchSimilar, type SearchHit } from './search-similar';

export interface AskAnythingResult {
  classification: QueryClassification;
  hits: SearchHit[];
  hint: string | null;
}

export async function askAnything(query: string): Promise<AskAnythingResult> {
  const classification = await classifyQueryIntent(query);

  if (classification.intent === 'search') {
    const hits = await searchSimilar({ query, k: 10 });
    return { classification, hits, hint: null };
  }

  if (classification.intent === 'action') {
    return {
      classification,
      hits: [],
      hint: 'Action queries are not yet executed automatically. Phase 1 will surface concrete action suggestions.',
    };
  }

  return {
    classification,
    hits: [],
    hint: 'Analytics queries are not yet executed. Phase 1 will translate this query into SQL.',
  };
}
