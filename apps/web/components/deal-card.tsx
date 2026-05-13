import { Card, CardContent, CardHeader, CardTitle } from '@cema/ui';
import type { Route } from 'next';
import Link from 'next/link';


import type { Deal } from '@/lib/actions/list-deals';

interface DealCardProps {
  deal: Pick<Deal, 'id' | 'cemaType' | 'status' | 'createdAt'>;
}

const STATUS_LABELS: Record<string, string> = {
  intake: 'Intake',
  eligibility: 'Eligibility',
  authorization: 'Authorization',
  collateral_chase: 'Collateral chase',
  title_work: 'Title work',
  doc_prep: 'Doc prep',
  attorney_review: 'Attorney review',
  closing: 'Closing',
  recording: 'Recording',
  completed: 'Completed',
  exception: 'Exception',
  cancelled: 'Cancelled',
};

export function DealCard({ deal }: DealCardProps) {
  return (
    <Link href={`/deals/${deal.id}` as Route} className="block">
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="text-base">
            {deal.cemaType === 'refi_cema' ? 'Refi CEMA' : 'Purchase CEMA'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Status:</span>
            <span>{STATUS_LABELS[deal.status] ?? deal.status}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Created:</span>
            <span>{deal.createdAt.toLocaleDateString()}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
