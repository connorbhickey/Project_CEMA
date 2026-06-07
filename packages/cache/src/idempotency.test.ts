import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  isUpstashConfigured: vi.fn(),
  getRedis: vi.fn(),
}));

import { getRedis, isUpstashConfigured } from './client';
import { acquireIdempotencyKey, releaseIdempotencyKey } from './idempotency';

afterEach(() => vi.clearAllMocks());

describe('acquireIdempotencyKey', () => {
  it('fails open (returns true) when Upstash is unconfigured — no Redis call', async () => {
    vi.mocked(isUpstashConfigured).mockReturnValue(false);
    expect(await acquireIdempotencyKey('k')).toBe(true);
    expect(getRedis).not.toHaveBeenCalled();
  });

  it('returns true when the key is newly acquired (SETNX -> OK)', async () => {
    vi.mocked(isUpstashConfigured).mockReturnValue(true);
    const set = vi.fn().mockResolvedValue('OK');
    vi.mocked(getRedis).mockReturnValue({ set } as never);
    expect(await acquireIdempotencyKey('k', 100)).toBe(true);
    expect(set).toHaveBeenCalledWith('k', '1', { nx: true, ex: 100 });
  });

  it('returns false when the key already exists (SETNX -> null = duplicate)', async () => {
    vi.mocked(isUpstashConfigured).mockReturnValue(true);
    const set = vi.fn().mockResolvedValue(null);
    vi.mocked(getRedis).mockReturnValue({ set } as never);
    expect(await acquireIdempotencyKey('k')).toBe(false);
  });

  it('fails open (returns true) when Redis throws', async () => {
    vi.mocked(isUpstashConfigured).mockReturnValue(true);
    const set = vi.fn().mockRejectedValue(new Error('redis down'));
    vi.mocked(getRedis).mockReturnValue({ set } as never);
    expect(await acquireIdempotencyKey('k')).toBe(true);
  });

  it('defaults to the 24h TTL when none is given', async () => {
    vi.mocked(isUpstashConfigured).mockReturnValue(true);
    const set = vi.fn().mockResolvedValue('OK');
    vi.mocked(getRedis).mockReturnValue({ set } as never);
    await acquireIdempotencyKey('k');
    expect(set).toHaveBeenCalledWith('k', '1', { nx: true, ex: 86_400 });
  });
});

describe('releaseIdempotencyKey', () => {
  it('no-ops when Upstash is unconfigured', async () => {
    vi.mocked(isUpstashConfigured).mockReturnValue(false);
    await releaseIdempotencyKey('k');
    expect(getRedis).not.toHaveBeenCalled();
  });

  it('deletes the key when configured', async () => {
    vi.mocked(isUpstashConfigured).mockReturnValue(true);
    const del = vi.fn().mockResolvedValue(1);
    vi.mocked(getRedis).mockReturnValue({ del } as never);
    await releaseIdempotencyKey('k');
    expect(del).toHaveBeenCalledWith('k');
  });

  it('swallows Redis errors (best-effort)', async () => {
    vi.mocked(isUpstashConfigured).mockReturnValue(true);
    const del = vi.fn().mockRejectedValue(new Error('down'));
    vi.mocked(getRedis).mockReturnValue({ del } as never);
    await expect(releaseIdempotencyKey('k')).resolves.toBeUndefined();
  });
});
