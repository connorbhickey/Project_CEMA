import { formatDistanceToNow } from 'date-fns';
import type { Route } from 'next';

import { AgentFilterChips, type AgentFilterChip } from '@/components/agent-filter-chips';
import { AGENT_FILTERS, parseAgentFilter } from '@/lib/agent-activity/agent-filter';
import { describeAuditEvent } from '@/lib/agent-activity/describe-audit-event';
import { getDealAgentActivity } from '@/lib/queries/deal-agent-activity';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ agent?: string }>;
}

export default async function DealAgentActivityPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { agent: rawAgent } = await searchParams;
  const activeAgent = parseAgentFilter(rawAgent);
  const events = await getDealAgentActivity(id, activeAgent ?? undefined);

  const base = `/deals/${id}/agent-activity`;
  const filterChips: AgentFilterChip[] = [
    { key: 'all', label: 'All', href: base as Route, active: activeAgent === null },
    ...AGENT_FILTERS.map((f) => ({
      key: f.key,
      label: f.label,
      href: `${base}?agent=${f.key}` as Route,
      active: activeAgent === f.key,
    })),
  ];

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Agent activity</h2>
      <AgentFilterChips chips={filterChips} />
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {activeAgent ? 'No activity for this filter.' : 'No agent activity yet.'}
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
