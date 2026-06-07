import { describe, expect, it, vi } from 'vitest';

import { withCronSpan } from './cron-span';

describe('withCronSpan', () => {
  it('returns the work result unchanged', async () => {
    const result = await withCronSpan('test_cron', () =>
      Promise.resolve({ purged: 5, failedDeletes: 1 }),
    );
    expect(result).toEqual({ purged: 5, failedDeletes: 1 });
  });

  it('runs the work exactly once', async () => {
    const fn = vi.fn().mockResolvedValue({ count: 0 });
    await withCronSpan('test_cron', fn);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('rethrows so the caller can shape its own error response', async () => {
    await expect(
      withCronSpan('test_cron', () => Promise.reject(new Error('db boom'))),
    ).rejects.toThrow('db boom');
  });
});
