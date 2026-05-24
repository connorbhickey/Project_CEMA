import { describe, expect, it, vi } from 'vitest';

const mockLimit = vi.fn().mockResolvedValue({ success: true, remaining: 9, limit: 10, reset: 0 });
const MockRatelimit = vi.fn().mockImplementation(() => ({ limit: mockLimit })) as unknown as {
  new (...args: unknown[]): { limit: typeof mockLimit };
  slidingWindow: (requests: number, window: string) => unknown;
};
(MockRatelimit as { slidingWindow: unknown }).slidingWindow = vi
  .fn()
  .mockReturnValue('sliding-window-config');

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: MockRatelimit,
}));

vi.mock('./client.ts', () => ({
  getRedis: vi.fn().mockReturnValue({}),
  isUpstashConfigured: vi.fn().mockReturnValue(true),
}));

describe('@cema/cache ratelimit', () => {
  it('makeWebhookLimiter returns a Ratelimit instance', async () => {
    const { makeWebhookLimiter } = await import('./ratelimit.ts');
    const limiter = makeWebhookLimiter();
    expect(limiter).toBeDefined();
  });

  it('checkRateLimit returns success:true when limit is not reached', async () => {
    const { checkRateLimit } = await import('./ratelimit.ts');
    const result = await checkRateLimit('127.0.0.1');
    expect(result.success).toBe(true);
  });
});
