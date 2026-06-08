import { formatDistanceToNow } from 'date-fns';
import { Activity } from 'lucide-react';

import { AgentFilterChips, type AgentFilterChip } from '@/components/agent-filter-chips';
import { BentoCard, CardEmptyState } from '@/components/deal-hub/bento-card';
import { DealHubHeader } from '@/components/deal-hub/deal-hub-header';
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
    <div className="bg-muted -m-6 min-h-full p-5">
      <DealHubHeader dealId={id} active={null} />

      <BentoCard
        icon={<Activity className="h-4 w-4 text-teal-600 dark:text-teal-400" strokeWidth={2} />}
        iconTile="bg-teal-500/10"
        title="Activity"
      >
        <div className="mb-4">
          <AgentFilterChips chips={typeChips} />
        </div>

        {events.length === 0 ? (
          <CardEmptyState>
            {activeType ? 'No activity for this filter.' : 'No activity yet.'}
          </CardEmptyState>
        ) : (
          <ol className="border-border relative space-y-5 border-l">
            {events.map((event) => (
              <li key={`${event.type}-${event.id}`} className="ml-4">
                <span className="border-background absolute -left-[6.5px] mt-1.5 h-3 w-3 rounded-full border-2 bg-teal-500" />
                <p className="text-foreground text-[13px] font-semibold">{event.label}</p>
                {event.detail ? (
                  <p className="text-muted-foreground max-w-md truncate text-[12.5px]">
                    {event.detail}
                  </p>
                ) : null}
                <time className="text-muted-foreground text-[11px]">
                  {formatDistanceToNow(event.occurredAt, { addSuffix: true })}
                </time>
              </li>
            ))}
          </ol>
        )}

        {nextCursor ? (
          <div className="mt-4">
            <LoadOlderLink href={activityHref(base, { type: activeType, cursor: nextCursor })} />
          </div>
        ) : null}
      </BentoCard>
    </div>
  );
}
