import { describe, expect, it } from 'vitest';

import { resolveOrganizationId } from './tenant.js';

describe('resolveOrganizationId', () => {
  it('returns the active Clerk org when present', () => {
    expect(
      resolveOrganizationId({
        orgId: 'org_2abc',
        userId: 'user_2xyz',
      }),
    ).toBe('org_2abc');
  });

  it('throws when user has no active org', () => {
    expect(() => resolveOrganizationId({ userId: 'user_2xyz' })).toThrow(/no active organization/i);
  });

  it('throws when user is signed out', () => {
    expect(() => resolveOrganizationId({})).toThrow(/not authenticated/i);
  });
});
