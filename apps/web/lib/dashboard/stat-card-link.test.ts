import { describe, expect, it } from 'vitest';

import { statCardLink } from './stat-card-link';

describe('statCardLink', () => {
  it('routes an audit-emitting agent card to its feed filter', () => {
    expect(statCardLink('idp')).toEqual({ kind: 'agent', agentKey: 'idp' });
    expect(statCardLink('borrower_comm')).toEqual({ kind: 'agent', agentKey: 'borrower_comm' });
  });

  it('routes the Lifecycle card to its feed filter', () => {
    expect(statCardLink('lifecycle')).toEqual({ kind: 'agent', agentKey: 'lifecycle' });
  });

  it('routes the Exception Triage card to the /exceptions inbox', () => {
    // 'exception' is NOT an audit-action filter (it counts open exceptions).
    expect(statCardLink('exception')).toEqual({ kind: 'exceptions' });
  });

  it('returns null for an unknown card key', () => {
    expect(statCardLink('mystery')).toBeNull();
  });
});
