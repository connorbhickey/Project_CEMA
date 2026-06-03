import { AGENTS, EXCEPTION_TRIAGE_AGENT, LIFECYCLE_BUCKET } from './agents';

/** A row from getAgentActionCounts: one deal-scoped audit action + its all-time count. */
export interface AgentActionCount {
  readonly action: string;
  readonly count: number;
}

/** One agent stat card. `unit` distinguishes Exception Triage's "open" count from
 *  the all-time action counts so the UI can label them correctly. */
export interface AgentStatCard {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly unit: 'actions' | 'open';
}

/**
 * Pure: fold all-time deal-scoped audit-action counts into the agent fleet's
 * stat cards, in a stable pipeline order. Each agent's count is the sum of its
 * prefixed actions; deal.* and any unmapped action roll up into the Lifecycle
 * bucket. Exception Triage is appended with its open-exception count (a distinct
 * unit), since it emits no audit actions of its own.
 */
export function summarizeAgentActivity(
  counts: readonly AgentActionCount[],
  openExceptionCount: number,
): AgentStatCard[] {
  const byAgent = new Map<string, number>(AGENTS.map((a) => [a.key, 0]));
  let lifecycle = 0;

  for (const { action, count } of counts) {
    const agent = AGENTS.find((a) => action.startsWith(a.prefix));
    if (agent) {
      byAgent.set(agent.key, (byAgent.get(agent.key) ?? 0) + count);
    } else {
      lifecycle += count;
    }
  }

  const agentCards: AgentStatCard[] = AGENTS.map((a) => ({
    key: a.key,
    label: a.label,
    count: byAgent.get(a.key) ?? 0,
    unit: 'actions',
  }));

  return [
    ...agentCards,
    {
      key: EXCEPTION_TRIAGE_AGENT.key,
      label: EXCEPTION_TRIAGE_AGENT.label,
      count: openExceptionCount,
      unit: 'open',
    },
    { key: LIFECYCLE_BUCKET.key, label: LIFECYCLE_BUCKET.label, count: lifecycle, unit: 'actions' },
  ];
}
