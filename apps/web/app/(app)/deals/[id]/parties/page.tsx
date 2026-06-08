import { notFound } from 'next/navigation';

import { DealHubHeader } from '@/components/deal-hub/deal-hub-header';
import { DealPartiesEditor } from '@/components/deal-parties-editor';
import { getDeal } from '@/lib/actions/get-deal';
import { getDealParties } from '@/lib/queries/deal-parties';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) notFound();

  const parties = await getDealParties(id);

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      <DealHubHeader dealId={id} active="parties" />
      <div className="mb-4">
        <h2 className="text-foreground text-lg font-bold tracking-tight">Parties</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          The people on this deal. For a Purchase CEMA, add the{' '}
          <strong className="text-foreground font-semibold">seller</strong> (whose mortgage is
          assumed) — the buyer is the borrower / co-borrower.
        </p>
      </div>
      <DealPartiesEditor dealId={id} parties={parties} />
    </div>
  );
}
