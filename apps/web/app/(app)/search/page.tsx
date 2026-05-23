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
      <div>
        <h1 className="mb-6 text-2xl font-semibold">Search</h1>
        <p className="text-muted-foreground text-sm">Enter a query in the search bar above.</p>
      </div>
    );
  }

  const { classification, hits, hint } = await askAnything(query);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Search</h1>

      <div className="rounded-lg border bg-gray-50 p-3 text-xs">
        <p>
          Classified as <span className="font-medium">{classification.intent}</span> (confidence{' '}
          {(classification.confidence * 100).toFixed(0)}%)
        </p>
      </div>

      {hint ? <p className="text-muted-foreground text-sm">{hint}</p> : null}

      {classification.intent === 'search' ? <SearchResults hits={hits} query={query} /> : null}
    </div>
  );
}
