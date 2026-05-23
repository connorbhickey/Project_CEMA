import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('mem0ai', () => ({
  MemoryClient: vi.fn().mockImplementation(() => ({})),
}));

import { getMemoryClient, isMemoryConfigured } from './client';

describe('isMemoryConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns false when MEM0_API_KEY is not set', () => {
    vi.stubEnv('MEM0_API_KEY', '');
    expect(isMemoryConfigured()).toBe(false);
  });

  it('returns true when MEM0_API_KEY is set', () => {
    vi.stubEnv('MEM0_API_KEY', 'test-key');
    expect(isMemoryConfigured()).toBe(true);
  });
});

describe('getMemoryClient', () => {
  beforeEach(() => {
    vi.stubEnv('MEM0_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('throws when MEM0_API_KEY is not set', () => {
    vi.stubEnv('MEM0_API_KEY', '');
    expect(() => getMemoryClient()).toThrow('MEM0_API_KEY is not set');
  });

  it('returns a client when MEM0_API_KEY is set', () => {
    const client = getMemoryClient();
    expect(client).toBeDefined();
  });
});
