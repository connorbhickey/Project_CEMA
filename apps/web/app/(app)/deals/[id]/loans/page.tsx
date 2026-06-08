import { notFound } from 'next/navigation';

import { DealHubHeader } from '@/components/deal-hub/deal-hub-header';
import { DealLoansEditor } from '@/components/deal-loans-editor';
import { getDeal } from '@/lib/actions/get-deal';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDeal(id);
  if (!data) notFound();

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      <DealHubHeader dealId={id} active="loans" />
      <div className="mb-4">
        <h2 className="text-foreground text-lg font-bold tracking-tight">Existing loans</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          The prior mortgages this CEMA consolidates (Schedule A). For a Purchase CEMA these are the{' '}
          <strong className="text-foreground font-semibold">seller&rsquo;s</strong> loans being
          assumed.
        </p>
      </div>
      <DealLoansEditor dealId={id} loans={data.existingLoans} />
    </div>
  );
}
