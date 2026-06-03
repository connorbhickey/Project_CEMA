import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

import { AgentFilterChips, type AgentFilterChip } from '@/components/agent-filter-chips';
import { AgentStatCards } from '@/components/agent-stat-cards';
import { PipelineFunnel } from '@/components/pipeline-funnel';
import { AGENT_FILTERS, parseAgentFilter } from '@/lib/agent-activity/agent-filter';
import { toOrgActivityItem } from '@/lib/agent-activity/org-activity-item';
import { getOrgExceptions } from '@/lib/agents/exception-triage/get-org-exceptions';
import { summarizeAgentActivity } from '@/lib/dashboard/agent-activity-summary';
import { summarizePipeline } from '@/lib/dashboard/pipeline-summary';
import { getAgentActionCounts } from '@/lib/queries/agent-action-counts';
import { getDealsByStatus } from '@/lib/queries/deals-by-status';
import { getOrgAgentActivity } from '@/lib/queries/org-agent-activity';

interface PageProps {
  searchParams: Promise<{ agent?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const { agent: rawAgent } = await searchParams;
  const activeAgent = parseAgentFilter(rawAgent);

  const [statusCounts, actionCounts, exceptions, rows] = await Promise.all([
    getDealsByStatus(),
    getAgentActionCounts(),
    getOrgExceptions(),
    getOrgAgentActivity(activeAgent ?? undefined),
  ]);

  const pipeline = summarizePipeline(statusCounts);
  const openExceptionCount = exceptions.reduce((n, d) => n + d.exceptions.length, 0);
  const agentCards = summarizeAgentActivity(actionCounts, openExceptionCount);
  const items = rows.map(toOrgActivityItem);

  const filterChips: AgentFilterChip[] = [
    { key: 'all', label: 'All', href: '/dashboard', active: activeAgent === null },
    ...AGENT_FILTERS.map((f) => ({
      key: f.key,
      label: f.label,
      href: `/dashboard?agent=${f.key}`,
      active: activeAgent === f.key,
    })),
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium">Pipeline</h2>
        <PipelineFunnel summary={pipeline} />
      </section>

      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium">Agent activity</h2>
        <AgentStatCards cards={agentCards} />
      </section>

      <section>
        <h2 className="text-muted-foreground mb-4 text-sm font-medium">Recent agent activity</h2>
        <AgentFilterChips chips={filterChips} />
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {activeAgent
              ? 'No activity for this filter.'
              : 'Agent activity will appear here as deals move through the pipeline.'}
          </p>
        ) : (
          <ol className="border-border relative space-y-6 border-l">
            {items.map((item) => (
              <li key={item.id} className="ml-4">
                <span className="border-background bg-muted absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border" />
                <Link href={`/deals/${item.dealId}`} className="hover:underline">
                  <p className="text-foreground text-sm font-medium">{item.label}</p>
                </Link>
                {item.detail && (
                  <p className="text-muted-foreground max-w-md truncate text-sm">{item.detail}</p>
                )}
                <p className="text-muted-foreground text-xs">{item.context}</p>
                <time className="text-muted-foreground text-xs">
                  {formatDistanceToNow(item.occurredAt, { addSuffix: true })}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
