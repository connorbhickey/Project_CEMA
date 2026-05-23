import { ReviewQueueRow } from '@/components/review-queue-row';
import { listReviewQueue } from '@/lib/actions/list-review-queue';

export default async function Page() {
  const items = await listReviewQueue({ stateFilter: 'all' });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Attorney review queue</h1>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm font-medium">No documents awaiting review</p>
          <p className="text-muted-foreground mt-1 text-xs">
            When a processor submits a CEMA document for review, it will appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" role="list" aria-label="Review queue">
          {items.map((item) => (
            <li key={item.queue.id}>
              <ReviewQueueRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
