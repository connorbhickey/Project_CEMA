import { notFound } from 'next/navigation';

import { DealLoansEditor } from '@/components/deal-loans-editor';
import { getDeal } from '@/lib/actions/get-deal';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDeal(id);
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Existing loans</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The prior mortgages this CEMA consolidates (Schedule A). For a Purchase CEMA these are the{' '}
          <strong>seller&rsquo;s</strong> loans being assumed.
        </p>
      </div>
      <DealLoansEditor dealId={id} loans={data.existingLoans} />
    </div>
  );
}
