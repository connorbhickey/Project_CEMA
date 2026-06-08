import { formatDistanceToNow } from 'date-fns';
import { Clock, FileText, type LucideIcon, MessagesSquare, Zap } from 'lucide-react';

import { BentoCard, CardEmptyState } from '@/components/deal-hub/bento-card';
import { DealHubHeader } from '@/components/deal-hub/deal-hub-header';
import { DealTimelineSubnav } from '@/components/deal-hub/deal-timeline-subnav';
import { getDealTimeline, type TimelineEntrySource } from '@/lib/queries/get-deal-timeline';

const SOURCE_META: Record<TimelineEntrySource, { icon: LucideIcon; tint: string; dot: string }> = {
  communication: {
    icon: MessagesSquare,
    tint: 'text-blue-600 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  document: { icon: FileText, tint: 'text-sky-600 dark:text-sky-400', dot: 'bg-sky-500' },
  agent: { icon: Zap, tint: 'text-teal-600 dark:text-teal-400', dot: 'bg-teal-500' },
};

export default async function DealTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entries = await getDealTimeline(id);

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      <DealHubHeader dealId={id} active="activity" />
      <DealTimelineSubnav dealId={id} active="all" />

      <BentoCard
        icon={<Clock className="h-4 w-4 text-teal-600 dark:text-teal-400" strokeWidth={2} />}
        iconTile="bg-teal-500/10"
        title="Timeline"
      >
        {entries.length === 0 ? (
          <CardEmptyState>
            No activity on this deal yet. Communications, documents, and agent actions appear here
            as they happen.
          </CardEmptyState>
        ) : (
          <ol className="border-border relative space-y-5 border-l" role="list">
            {entries.map((e) => {
              const meta = SOURCE_META[e.source];
              const Icon = meta.icon;
              return (
                <li key={`${e.source}-${e.id}`} className="ml-4" role="listitem">
                  <span
                    className={`border-background absolute -left-[6.5px] mt-1.5 h-3 w-3 rounded-full border-2 ${meta.dot}`}
                  />
                  <div className="flex items-center gap-1.5">
                    <Icon className={`h-3.5 w-3.5 ${meta.tint}`} strokeWidth={2} />
                    <p className="text-foreground text-[13px] font-semibold">{e.label}</p>
                  </div>
                  {e.detail ? (
                    <p className="text-muted-foreground mt-0.5 max-w-md truncate text-[12.5px]">
                      {e.detail}
                    </p>
                  ) : null}
                  <time className="text-muted-foreground text-[11px]">
                    {formatDistanceToNow(e.occurredAt, { addSuffix: true })}
                  </time>
                </li>
              );
            })}
          </ol>
        )}
      </BentoCard>
    </div>
  );
}
