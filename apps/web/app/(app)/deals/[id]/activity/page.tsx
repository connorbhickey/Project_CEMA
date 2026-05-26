import { formatDistanceToNow } from 'date-fns';

import { getDealActivity } from '@/lib/queries/deal-activity';

export default async function DealActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const events = await getDealActivity(id);

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Activity</h2>
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No activity yet.</p>
      ) : (
        <ol className="border-border relative space-y-6 border-l">
          {events.map((event) => (
            <li key={`${event.type}-${event.id}`} className="ml-4">
              <span className="border-background bg-muted absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border" />
              <p className="text-foreground text-sm font-medium">{event.label}</p>
              {event.detail && (
                <p className="text-muted-foreground max-w-md truncate text-sm">{event.detail}</p>
              )}
              <time className="text-muted-foreground text-xs">
                {formatDistanceToNow(event.occurredAt, { addSuffix: true })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
