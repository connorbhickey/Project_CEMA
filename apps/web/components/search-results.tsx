import { SearchX } from 'lucide-react';

import { CitationCard } from './citation-card';

import type { SearchHit } from '@/lib/actions/search-similar';

interface SearchResultsProps {
  hits: SearchHit[];
  query: string;
}

function hrefForHit(hit: SearchHit): string {
  if (hit.kind === 'communication') return `/communications/${hit.id}`;
  return `/documents/${hit.id}`;
}

export function SearchResults({ hits, query }: SearchResultsProps) {
  if (hits.length === 0) {
    return (
      <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-muted mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
            <SearchX className="h-6 w-6 text-slate-500 dark:text-slate-400" strokeWidth={1.5} />
          </div>
          <p className="text-foreground text-sm font-semibold">
            No matches for &ldquo;{query}&rdquo;
          </p>
          <p className="text-muted-foreground mt-1 text-[12.5px]">
            Communications + documents must be embedded first. Run the backfill if this is
            unexpected.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">
        {hits.length} result{hits.length === 1 ? '' : 's'} for &ldquo;{query}&rdquo;
      </p>
      <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
        {hits.map((hit) => (
          <CitationCard key={`${hit.kind}-${hit.id}`} hit={hit} href={hrefForHit(hit)} />
        ))}
      </div>
    </div>
  );
}
