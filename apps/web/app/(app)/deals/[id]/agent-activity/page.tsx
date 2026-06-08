import { formatDistanceToNow } from 'date-fns';
import { Zap } from 'lucide-react';

import { AgentFilterChips, type AgentFilterChip } from '@/components/agent-filter-chips';
import { BentoCard, CardEmptyState } from '@/components/deal-hub/bento-card';
import { DealHubHeader } from '@/components/deal-hub/deal-hub-header';
import { DealTimelineSubnav } from '@/components/deal-hub/deal-timeline-subnav';
import { LoadOlderLink } from '@/components/load-older-link';
import { parseActivityCursor } from '@/lib/agent-activity/activity-cursor';
import { activityHref } from '@/lib/agent-activity/activity-href';
import { AGENT_FILTERS, parseAgentFilter } from '@/lib/agent-activity/agent-filter';
import { describeAuditEvent } from '@/lib/agent-activity/describe-audit-event';
import { SINCE_FILTERS, parseSinceFilter, sinceCutoffMs } from '@/lib/agent-activity/since-filter';
import { getDealAgentActivity } from '@/lib/queries/deal-agent-activity';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ agent?: string; since?: string; cursor?: string }>;
}

export default async function DealAgentActivityPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { agent: rawAgent, since: rawSince, cursor: rawCursor } = await searchParams;
  const activeAgent = parseAgentFilter(rawAgent);
  const activeSince = parseSinceFilter(rawSince);
  const cursor = parseActivityCursor(rawCursor);
  const cutoffMs = activeSince ? sinceCutoffMs(activeSince) : null;
  const sinceDate = cutoffMs != null ? new Date(Date.now() - cutoffMs) : undefined;

  const { items: events, nextCursor } = await getDealAgentActivity(
    id,
    activeAgent ?? undefined,
    sinceDate,
    cursor ?? undefined,
  );

  const base = `/deals/${id}/agent-activity`;
  const agentChips: AgentFilterChip[] = [
    {
      key: 'all',
      label: 'All',
      href: activityHref(base, { since: activeSince }),
      active: activeAgent === null,
    },
    ...AGENT_FILTERS.map((f) => ({
      key: f.key,
      label: f.label,
      href: activityHref(base, { agent: f.key, since: activeSince }),
      active: activeAgent === f.key,
    })),
  ];

  const sinceChips: AgentFilterChip[] = SINCE_FILTERS.map((f) => ({
    key: f.key,
    label: f.label,
    href: activityHref(base, { agent: activeAgent, since: f.cutoffMs === null ? null : f.key }),
    active: f.cutoffMs === null ? activeSince === null : activeSince === f.key,
  }));

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      <DealHubHeader dealId={id} active="activity" />
      <DealTimelineSubnav dealId={id} active="agent-activity" />

      <BentoCard
        icon={<Zap className="h-4 w-4 text-teal-600 dark:text-teal-400" strokeWidth={2} />}
        iconTile="bg-teal-500/10"
        title="Agent activity"
      >
        <div className="mb-4 space-y-1.5">
          <AgentFilterChips chips={agentChips} />
          <AgentFilterChips chips={sinceChips} />
        </div>

        {events.length === 0 ? (
          <CardEmptyState>
            {activeAgent || activeSince ? 'No activity for this filter.' : 'No agent activity yet.'}
          </CardEmptyState>
        ) : (
          <ol className="border-border relative space-y-5 border-l">
            {events.map((event) => {
              const { label, detail } = describeAuditEvent(event.action, event.metadata);
              return (
                <li key={event.id} className="ml-4">
                  <span className="border-background absolute -left-[6.5px] mt-1.5 h-3 w-3 rounded-full border-2 bg-teal-500" />
                  <p className="text-foreground text-[13px] font-semibold">{label}</p>
                  {detail ? (
                    <p className="text-muted-foreground max-w-md truncate text-[12.5px]">
                      {detail}
                    </p>
                  ) : null}
                  <time className="text-muted-foreground text-[11px]">
                    {formatDistanceToNow(event.occurredAt, { addSuffix: true })}
                  </time>
                </li>
              );
            })}
          </ol>
        )}

        {nextCursor ? (
          <div className="mt-4">
            <LoadOlderLink
              href={activityHref(base, {
                agent: activeAgent,
                since: activeSince,
                cursor: nextCursor,
              })}
            />
          </div>
        ) : null}
      </BentoCard>
    </div>
  );
}
