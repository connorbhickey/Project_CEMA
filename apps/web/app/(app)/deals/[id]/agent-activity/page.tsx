import { formatDistanceToNow } from 'date-fns';

import { AgentFilterChips, type AgentFilterChip } from '@/components/agent-filter-chips';
import { activityHref } from '@/lib/agent-activity/activity-href';
import { AGENT_FILTERS, parseAgentFilter } from '@/lib/agent-activity/agent-filter';
import { describeAuditEvent } from '@/lib/agent-activity/describe-audit-event';
import { SINCE_FILTERS, parseSinceFilter, sinceCutoffMs } from '@/lib/agent-activity/since-filter';
import { getDealAgentActivity } from '@/lib/queries/deal-agent-activity';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ agent?: string; since?: string }>;
}

export default async function DealAgentActivityPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { agent: rawAgent, since: rawSince } = await searchParams;
  const activeAgent = parseAgentFilter(rawAgent);
  const activeSince = parseSinceFilter(rawSince);
  const cutoffMs = activeSince ? sinceCutoffMs(activeSince) : null;
  const sinceDate = cutoffMs != null ? new Date(Date.now() - cutoffMs) : undefined;

  const events = await getDealAgentActivity(id, activeAgent ?? undefined, sinceDate);

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
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Agent activity</h2>
      <AgentFilterChips chips={agentChips} />
      <AgentFilterChips chips={sinceChips} />
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {activeAgent || activeSince ? 'No activity for this filter.' : 'No agent activity yet.'}
        </p>
      ) : (
        <ol className="border-border relative space-y-6 border-l">
          {events.map((event) => {
            const { label, detail } = describeAuditEvent(event.action, event.metadata);
            return (
              <li key={event.id} className="ml-4">
                <span className="border-background bg-muted absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border" />
                <p className="text-foreground text-sm font-medium">{label}</p>
                {detail && (
                  <p className="text-muted-foreground max-w-md truncate text-sm">{detail}</p>
                )}
                <time className="text-muted-foreground text-xs">
                  {formatDistanceToNow(event.occurredAt, { addSuffix: true })}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
