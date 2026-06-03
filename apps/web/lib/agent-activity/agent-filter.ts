import { AGENTS } from '@/lib/dashboard/agents';

/** One agent-activity filter chip: a key, a display label, and the SQL LIKE
 *  pattern its audit actions match (e.g. 'idp.%'). */
export interface AgentFilter {
  readonly key: string;
  readonly label: string;
  readonly pattern: string;
}

/**
 * The filterable buckets for the agent-activity feeds, derived from the AGENTS
 * registry (the 8 audit-emitting agents) + a Lifecycle bucket for deal.* events.
 * Exception Triage is intentionally absent — it emits no audit actions, so there
 * is nothing to filter to (mirrors its absence from the prefix-fold registry).
 */
// SQL LIKE treats `_` and `%` as wildcards; escape them so a prefix containing
// `_` (e.g. 'internal_comm.') matches literally. Postgres LIKE's default escape
// character is backslash.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

export const AGENT_FILTERS: readonly AgentFilter[] = [
  ...AGENTS.map((a) => ({ key: a.key, label: a.label, pattern: `${escapeLike(a.prefix)}%` })),
  { key: 'lifecycle', label: 'Lifecycle & Status', pattern: 'deal.%' },
];

/** Validate an untrusted `?agent=` searchParam — a known filter key, or null. */
export function parseAgentFilter(raw: string | undefined | null): string | null {
  return raw != null && AGENT_FILTERS.some((f) => f.key === raw) ? raw : null;
}

/** The SQL LIKE pattern for a filter key (e.g. 'idp.%'), or null if unknown. */
export function agentLikePattern(key: string): string | null {
  return AGENT_FILTERS.find((f) => f.key === key)?.pattern ?? null;
}
