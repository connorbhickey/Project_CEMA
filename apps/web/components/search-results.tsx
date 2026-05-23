import type { Route } from 'next';

import { CitationCard } from './citation-card';

import type { SearchHit } from '@/lib/actions/search-similar';

interface SearchResultsProps {
  hits: SearchHit[];
  query: string;
}

function hrefForHit(hit: SearchHit): Route {
  if (hit.kind === 'communication') return `/communications/${hit.id}` as Route;
  return `/documents/${hit.id}` as Route;
}

export function SearchResults({ hits, query }: SearchResultsProps) {
  if (hits.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-muted-foreground text-sm font-medium">
          No matches for &ldquo;{query}&rdquo;
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Communications + documents must be embedded first. Run the backfill if this is unexpected.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">
        {hits.length} result{hits.length === 1 ? '' : 's'} for &ldquo;{query}&rdquo;
      </p>
      <ul className="space-y-2" role="list">
        {hits.map((hit) => (
          <li key={`${hit.kind}-${hit.id}`}>
            <CitationCard hit={hit} href={hrefForHit(hit)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
