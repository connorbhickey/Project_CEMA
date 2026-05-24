import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({ set: vi.fn(), get: vi.fn() })),
}));

describe('@cema/cache client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('isUpstashConfigured returns false when env vars are missing', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const { isUpstashConfigured } = await import('./client.ts');
    expect(isUpstashConfigured()).toBe(false);
  });

  it('isUpstashConfigured returns true when both env vars are set', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok_test');
    const { isUpstashConfigured } = await import('./client.ts');
    expect(isUpstashConfigured()).toBe(true);
  });

  it('getRedis throws when not configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const { getRedis } = await import('./client.ts');
    expect(() => getRedis()).toThrow('UPSTASH_REDIS_REST_URL is not set');
  });

  it('getRedis returns a Redis instance when configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok_test');
    const { getRedis } = await import('./client.ts');
    expect(getRedis()).toBeDefined();
  });
});
