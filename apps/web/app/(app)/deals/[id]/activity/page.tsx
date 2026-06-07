import { formatDistanceToNow } from 'date-fns';

import { AgentFilterChips, type AgentFilterChip } from '@/components/agent-filter-chips';
import { LoadOlderLink } from '@/components/load-older-link';
import { parseActivityCursor } from '@/lib/agent-activity/activity-cursor';
import { activityHref } from '@/lib/agent-activity/activity-href';
import { getDealActivity } from '@/lib/queries/deal-activity';
import {
  DEAL_ACTIVITY_TYPE_FILTERS,
  parseDealActivityType,
} from '@/lib/queries/deal-activity-filter';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; cursor?: string }>;
}

export default async function DealActivityPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { type: rawType, cursor: rawCursor } = await searchParams;
  const activeType = parseDealActivityType(rawType);
  const cursor = parseActivityCursor(rawCursor);

  const { items: events, nextCursor } = await getDealActivity(id, {
    type: activeType,
    cursor,
  });

  const base = `/deals/${id}/activity`;
  // A new filter resets pagination (the cursor is only meaningful within one
  // filtered stream), so the chip hrefs omit `cursor`.
  const typeChips: AgentFilterChip[] = [
    {
      key: 'all',
      label: 'All',
      href: activityHref(base, {}),
      active: activeType === null,
    },
    ...DEAL_ACTIVITY_TYPE_FILTERS.map((f) => ({
      key: f.key,
      label: f.label,
      href: activityHref(base, { type: f.key }),
      active: activeType === f.key,
    })),
  ];

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Activity</h2>
      <AgentFilterChips chips={typeChips} />
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {activeType ? 'No activity for this filter.' : 'No activity yet.'}
        </p>
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
      {nextCursor && (
        <LoadOlderLink href={activityHref(base, { type: activeType, cursor: nextCursor })} />
      )}
    </div>
  );
}
