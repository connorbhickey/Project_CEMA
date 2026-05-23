import { getCurrentUser } from '@cema/auth';
import { notFound } from 'next/navigation';

import { ReviewDetailPanel } from '@/components/review-detail-panel';
import { listReviewQueue } from '@/lib/actions/list-review-queue';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const allItems = await listReviewQueue({ stateFilter: 'all', limit: 200 });
  const item = allItems.find((i) => i.queue.id === id);
  if (!item) notFound();

  const currentUser = await getCurrentUser();
  const reviewerIsCurrentUser = item.reviewer?.clerkUserId === currentUser?.id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {item.document?.kind ?? `Document ${item.queue.documentId}`}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Version {item.queue.documentVersion} &middot; State: {item.queue.state}
        </p>
      </div>

      <ReviewDetailPanel
        queueId={item.queue.id}
        state={item.queue.state}
        reviewerIsCurrentUser={reviewerIsCurrentUser}
      />

      {item.queue.state === 'rejected' && item.queue.rejectionReason ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">Rejection reason</p>
          <p className="mt-1 text-sm text-red-700">{item.queue.rejectionReason}</p>
        </div>
      ) : null}
    </div>
  );
}
