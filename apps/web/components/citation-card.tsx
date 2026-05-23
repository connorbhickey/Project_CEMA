import type { Route } from 'next';
import Link from 'next/link';

import type { SearchHit } from '@/lib/actions/search-similar';

interface CitationCardProps {
  hit: SearchHit;
  href: Route;
}

export function CitationCard({ hit, href }: CitationCardProps) {
  return (
    <Link
      href={href}
      className="hover:bg-muted/50 block rounded-lg border bg-white p-4 shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{hit.preview}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            <span className="capitalize">{hit.kind}</span> · similarity{' '}
            {(hit.similarity * 100).toFixed(1)}%
          </p>
        </div>
      </div>
    </Link>
  );
}
