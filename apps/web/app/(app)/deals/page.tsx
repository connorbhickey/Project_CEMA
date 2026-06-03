import { Button } from '@cema/ui';
import type { Route } from 'next';
import Link from 'next/link';

import { DealCard } from '@/components/deal-card';
import { listDeals } from '@/lib/actions/list-deals';
import { dealStatusLabel, parseDealStatusFilter } from '@/lib/deals/deal-status';

const NEW_DEAL_HREF = '/deals/new' as Route<'/deals/new'>;
const ALL_DEALS_HREF = '/deals' as Route<'/deals'>;

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const { status: rawStatus } = await searchParams;
  const status = parseDealStatusFilter(rawStatus);
  const deals = await listDeals(status ?? undefined);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Deals</h1>
        <Link href={NEW_DEAL_HREF}>
          <Button>New deal</Button>
        </Link>
      </div>

      {status && (
        <p className="text-muted-foreground mb-4 flex items-center gap-2 text-sm">
          <span>
            Showing <span className="text-foreground font-medium">{dealStatusLabel(status)}</span> ·{' '}
            {deals.length} {deals.length === 1 ? 'deal' : 'deals'}
          </span>
          <Link href={ALL_DEALS_HREF} className="underline">
            All deals
          </Link>
        </p>
      )}

      {deals.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {status
            ? `No deals in ${dealStatusLabel(status)}.`
            : 'No deals yet. Click "New deal" to create your first.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </div>
      )}
    </div>
  );
}
