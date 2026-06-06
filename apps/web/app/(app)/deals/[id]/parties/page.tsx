import { notFound } from 'next/navigation';

import { DealPartiesEditor } from '@/components/deal-parties-editor';
import { getDeal } from '@/lib/actions/get-deal';
import { getDealParties } from '@/lib/queries/deal-parties';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) notFound();

  const parties = await getDealParties(id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Parties</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The people on this deal. For a Purchase CEMA, add the <strong>seller</strong> (whose
          mortgage is assumed) — the buyer is the borrower / co-borrower.
        </p>
      </div>
      <DealPartiesEditor dealId={id} parties={parties} />
    </div>
  );
}
