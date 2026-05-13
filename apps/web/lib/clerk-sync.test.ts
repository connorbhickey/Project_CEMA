import { describe, expect, it } from 'vitest';

import { handleClerkWebhook } from './clerk-sync.js';

describe('handleClerkWebhook', () => {
  it('upserts an organization on organization.created', async () => {
    const dbCalls: string[] = [];
    const fakeDb = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => {
            dbCalls.push('organizations.upsert');
            return Promise.resolve();
          },
        }),
      }),
    };
    await handleClerkWebhook(
      fakeDb as never,
      {
        type: 'organization.created',
        data: {
          id: 'org_2abc',
          name: 'Acme Lending',
          slug: 'acme-lending',
        } as never,
      } as never,
    );
    expect(dbCalls).toContain('organizations.upsert');
  });

  it('upserts a user on user.created', async () => {
    const dbCalls: string[] = [];
    const fakeDb = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => {
            dbCalls.push('users.upsert');
            return Promise.resolve();
          },
        }),
      }),
    };
    await handleClerkWebhook(
      fakeDb as never,
      {
        type: 'user.created',
        data: {
          id: 'user_2xyz',
          email_addresses: [{ email_address: 'test@example.com' }],
          first_name: 'Test',
          last_name: 'User',
        } as never,
      } as never,
    );
    expect(dbCalls).toContain('users.upsert');
  });

  it('ignores unrelated event types', async () => {
    await expect(
      handleClerkWebhook({} as never, { type: 'email.created', data: {} as never } as never),
    ).resolves.toBeUndefined();
  });
});
