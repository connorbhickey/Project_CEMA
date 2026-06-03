import { AGENT_FILTERS } from '@/lib/agent-activity/agent-filter';
import { EXCEPTION_TRIAGE_AGENT } from '@/lib/dashboard/agents';

/** Where a clicked dashboard stat card drills to:
 *  - an agent (or Lifecycle) card filters the feed (?agent=<key>);
 *  - the Exception Triage card opens the /exceptions inbox (it has no audit
 *    actions to filter to — its count is open exceptions);
 *  - anything else is not clickable. */
export type StatCardLink = { kind: 'agent'; agentKey: string } | { kind: 'exceptions' } | null;

export function statCardLink(key: string): StatCardLink {
  if (AGENT_FILTERS.some((f) => f.key === key)) return { kind: 'agent', agentKey: key };
  if (key === EXCEPTION_TRIAGE_AGENT.key) return { kind: 'exceptions' };
  return null;
}
