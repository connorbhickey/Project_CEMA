import { SearchResults } from '@/components/search-results';
import { searchSimilar } from '@/lib/actions/search-similar';

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const query = q?.trim() ?? '';
  const hits = query ? await searchSimilar({ query, k: 20 }) : [];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Search</h1>
      {query ? (
        <SearchResults hits={hits} query={query} />
      ) : (
        <p className="text-muted-foreground text-sm">Enter a query in the search bar above.</p>
      )}
    </div>
  );
}
