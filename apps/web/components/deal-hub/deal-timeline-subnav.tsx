import { Activity, LayoutList, type LucideIcon, MessagesSquare, Zap } from 'lucide-react';
import Link from 'next/link';

import { routeHref } from '@/lib/routes';

/**
 * Secondary nav for the deal-hub **Timeline** tab — the "source filter" the spec
 * calls for. "All" is the unified merged stream (`/timeline`); the other three are
 * the richer per-source views (Communications / Activity / Agent activity). All
 * four sit under the single "Timeline" tab; rendered below <DealHubHeader>.
 */
export type TimelineSource = 'all' | 'communications' | 'activity' | 'agent-activity';

const SOURCES: { key: TimelineSource; label: string; segment: string; icon: LucideIcon }[] = [
  { key: 'all', label: 'All', segment: '/timeline', icon: LayoutList },
  {
    key: 'communications',
    label: 'Communications',
    segment: '/communications',
    icon: MessagesSquare,
  },
  { key: 'activity', label: 'Activity', segment: '/activity', icon: Activity },
  { key: 'agent-activity', label: 'Agent activity', segment: '/agent-activity', icon: Zap },
];

export function DealTimelineSubnav({ dealId, active }: { dealId: string; active: TimelineSource }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {SOURCES.map(({ key, label, segment, icon: Icon }) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={routeHref(`/deals/${dealId}${segment}`)}
            className={[
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-semibold transition-colors',
              isActive
                ? 'border-teal-600/30 bg-teal-500/10 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/15 dark:text-teal-400'
                : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground',
            ].join(' ')}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
