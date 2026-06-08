import { describeAuditEvent } from '../agent-activity/describe-audit-event';

import { getDealActivity } from './deal-activity';
import { getDealAgentActivity } from './deal-agent-activity';

export type TimelineEntrySource = 'communication' | 'document' | 'agent';

export interface DealTimelineEntry {
  readonly source: TimelineEntrySource;
  readonly id: string;
  readonly occurredAt: Date;
  readonly label: string;
  readonly detail: string | null;
}

/**
 * The deal's UNIFIED timeline — communications + documents (from `getDealActivity`)
 * interleaved with the agent/lifecycle audit trail (from `getDealAgentActivity`),
 * newest-first into one stream. This is the merged "All" view the spec's Timeline
 * calls for; the per-source pages (Communications / Activity / Agent activity)
 * keep their richer views and are reachable via the Timeline sub-nav.
 *
 * Capped rather than cross-source keyset-paginated: each underlying feed already
 * caps at 200, which is ample for a single deal, and one merged page keeps the
 * "All" view simple.
 */
export async function getDealTimeline(dealId: string, limit = 60): Promise<DealTimelineEntry[]> {
  const [activity, agent] = await Promise.all([
    getDealActivity(dealId, {}),
    getDealAgentActivity(dealId),
  ]);

  const entries: DealTimelineEntry[] = [
    ...activity.items.map((e) => ({
      source: e.type,
      id: e.id,
      occurredAt: e.occurredAt,
      label: e.label,
      detail: e.detail,
    })),
    ...agent.items.map((e) => {
      const { label, detail } = describeAuditEvent(e.action, e.metadata);
      return {
        source: 'agent' as const,
        id: e.id,
        occurredAt: e.occurredAt,
        label,
        detail: detail ?? null,
      };
    }),
  ];

  // Newest-first; id is the deterministic tiebreaker (sources have disjoint id-spaces).
  entries.sort((a, b) => {
    const dt = b.occurredAt.getTime() - a.occurredAt.getTime();
    if (dt !== 0) return dt;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  return entries.slice(0, limit);
}
