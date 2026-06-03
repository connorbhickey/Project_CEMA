import { describe, expect, it } from 'vitest';

import { AGENT_FILTERS, agentLikePattern, parseAgentFilter } from './agent-filter';

describe('AGENT_FILTERS', () => {
  it('has the 8 audit-emitting agents + a lifecycle bucket, each with a % pattern', () => {
    expect(AGENT_FILTERS.map((f) => f.key)).toEqual([
      'intake',
      'outreach',
      'idp',
      'chain',
      'docgen',
      'recording',
      'internal_comm',
      'borrower_comm',
      'lifecycle',
    ]);
    expect(AGENT_FILTERS.every((f) => f.pattern.endsWith('%'))).toBe(true);
  });

  it('excludes Exception Triage (it emits no audits)', () => {
    expect(AGENT_FILTERS.some((f) => f.key === 'exception')).toBe(false);
  });
});

describe('parseAgentFilter', () => {
  it('accepts a valid agent key and lifecycle', () => {
    expect(parseAgentFilter('idp')).toBe('idp');
    expect(parseAgentFilter('lifecycle')).toBe('lifecycle');
  });

  it('rejects invalid / undefined', () => {
    expect(parseAgentFilter('exception')).toBeNull(); // not a filter (no audits)
    expect(parseAgentFilter('foo')).toBeNull();
    expect(parseAgentFilter(undefined)).toBeNull();
  });
});

describe('agentLikePattern', () => {
  it('maps an agent key to its action-prefix LIKE pattern', () => {
    expect(agentLikePattern('idp')).toBe('idp.%');
    expect(agentLikePattern('lifecycle')).toBe('deal.%');
  });

  it('returns null for an unknown key', () => {
    expect(agentLikePattern('foo')).toBeNull();
  });
});
