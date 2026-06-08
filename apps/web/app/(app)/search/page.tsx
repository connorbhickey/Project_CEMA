import { Sparkles } from 'lucide-react';

import { BentoCard } from '@/components/deal-hub/bento-card';
import { SearchResults } from '@/components/search-results';
import { askAnything } from '@/lib/actions/ask-anything';

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const query = q?.trim() ?? '';

  if (!query) {
    return (
      <div className="bg-muted -m-6 min-h-full p-5">
        <div className="mb-5">
          <h1 className="text-foreground text-2xl font-extrabold tracking-tight">Search</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Enter a query in the search bar above.
          </p>
        </div>
      </div>
    );
  }

  const { classification, hits, hint } = await askAnything(query);
  const pct = (classification.confidence * 100).toFixed(0);

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      {/* Page header */}
      <div className="mb-5">
        <h1 className="text-foreground text-2xl font-extrabold tracking-tight">Search</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Results for &ldquo;
          <strong className="text-foreground font-semibold">{query}</strong>&rdquo;
        </p>
      </div>

      {/* Classification card */}
      <div className="mb-5">
        <BentoCard
          icon={<Sparkles className="h-4 w-4 text-teal-600 dark:text-teal-400" strokeWidth={2} />}
          iconTile="bg-teal-500/10"
          title="Query"
        >
          <p className="text-muted-foreground text-[13px]">
            Classified as{' '}
            <strong className="text-foreground font-semibold">{classification.intent}</strong>{' '}
            (confidence {pct}%)
          </p>
          {hint ? <p className="text-muted-foreground mt-1 text-[12.5px]">{hint}</p> : null}
        </BentoCard>
      </div>

      {/* Results */}
      {classification.intent === 'search' ? <SearchResults hits={hits} query={query} /> : null}
    </div>
  );
}
