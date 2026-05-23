import { describe, expect, it, vi } from 'vitest';

import { ensureContact } from './dedup';

describe('ensureContact', () => {
  it('returns existing contactId when identity already exists', async () => {
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ contactId: 'existing-1' }]),
          }),
        }),
      }),
      insert: vi.fn(),
    };
    const res = await ensureContact(tx, {
      orgId: 'org-1',
      kind: 'email',
      value: 'bob@example.com',
      source: 'party',
      sourceId: 'p-1',
    });
    expect(res?.contactId).toBe('existing-1');
    expect(res?.created).toBe(false);
  });

  it('creates a new contact + identity when none exists', async () => {
    let insertCallCount = 0;
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      insert: vi.fn().mockImplementation(() => {
        insertCallCount += 1;
        if (insertCallCount === 1) {
          return {
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 'new-contact-1' }]),
            }),
          };
        }
        return {
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          }),
        };
      }),
    };
    const res = await ensureContact(tx, {
      orgId: 'org-1',
      kind: 'email',
      value: 'newperson@example.com',
      source: 'party',
      sourceId: 'p-2',
    });
    expect(res?.contactId).toBe('new-contact-1');
    expect(res?.created).toBe(true);
  });

  it('returns null when normalization rejects the input', async () => {
    const tx = {
      select: vi.fn(),
      insert: vi.fn(),
    };
    const res = await ensureContact(tx, {
      orgId: 'org-1',
      kind: 'email',
      value: 'not-an-email',
      source: 'party',
      sourceId: null,
    });
    expect(res).toBeNull();
  });
});
