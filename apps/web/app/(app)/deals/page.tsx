import { Button } from '@cema/ui';
import Link from 'next/link';


import { DealCard } from '@/components/deal-card';
import { listDeals } from '@/lib/actions/list-deals';

export default async function Page() {
  const allDeals = await listDeals();
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Deals</h1>
        <Link href="/deals/new">
          <Button>New deal</Button>
        </Link>
      </div>
      {allDeals.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No deals yet. Click &quot;New deal&quot; to create your first.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {allDeals.map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </div>
      )}
    </div>
  );
}
