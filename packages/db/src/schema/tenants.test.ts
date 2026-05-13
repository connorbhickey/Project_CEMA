import { describe, expect, it } from 'vitest';

import { memberships, organizations, users } from './tenants.js';

describe('tenants schema', () => {
  it('organizations table has required columns', () => {
    const cols = Object.keys(organizations);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'clerkOrgId',
        'name',
        'slug',
        'lenderSubtype',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ]),
    );
  });

  it('users table has required columns', () => {
    const cols = Object.keys(users);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'clerkUserId',
        'email',
        'fullName',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ]),
    );
  });

  it('memberships joins users to orgs with role', () => {
    const cols = Object.keys(memberships);
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'organizationId', 'userId', 'role', 'createdAt']),
    );
  });
});
