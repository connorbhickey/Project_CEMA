import { describe, expect, it } from 'vitest';

import { getRlsContext, withRlsContext } from './rls';

describe('RLS context helpers', () => {
  it('withRlsContext returns a SET LOCAL SQL statement for a valid UUID', () => {
    const stmt = withRlsContext('00000000-0000-0000-0000-000000000001');
    expect(stmt).toContain("SET LOCAL app.current_organization_id = '00000000");
  });

  it('throws if given a non-UUID org id', () => {
    expect(() => withRlsContext('not-a-uuid')).toThrow(/UUID/);
  });

  it('throws on SQL-injection-like input (quote in the string)', () => {
    expect(() => withRlsContext("' OR 1=1 --")).toThrow();
  });

  it('parses the current org from a context envelope', () => {
    const ctx = { currentOrganizationId: '00000000-0000-0000-0000-000000000001' };
    expect(getRlsContext(ctx).orgId).toBe('00000000-0000-0000-0000-000000000001');
  });
});
