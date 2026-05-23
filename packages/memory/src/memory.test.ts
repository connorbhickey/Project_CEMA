import { afterEach, describe, expect, it, vi } from 'vitest';

const mockAdd = vi.fn().mockResolvedValue({});
const mockSearch = vi.fn().mockResolvedValue([]);
const mockDeleteAll = vi.fn().mockResolvedValue({});

vi.mock('./client', () => ({
  isMemoryConfigured: vi.fn(),
  getMemoryClient: vi.fn(() => ({
    add: mockAdd,
    search: mockSearch,
    deleteAll: mockDeleteAll,
  })),
}));

import { isMemoryConfigured } from './client';
import { addMemory, clearSessionMemory, searchMemory } from './memory';

describe('addMemory', () => {
  afterEach(() => vi.clearAllMocks());

  it('is a no-op when memory is not configured', async () => {
    vi.mocked(isMemoryConfigured).mockReturnValue(false);
    await addMemory('deal-1', 'some text', 'session-1');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('calls client.add with userId=dealId and runId=sessionId', async () => {
    vi.mocked(isMemoryConfigured).mockReturnValue(true);
    await addMemory('deal-1', 'payoff confirmed', 'session-abc');
    expect(mockAdd).toHaveBeenCalledWith([{ role: 'user', content: 'payoff confirmed' }], {
      user_id: 'deal-1',
      run_id: 'session-abc',
    });
  });
});

describe('searchMemory', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns empty array when not configured', async () => {
    vi.mocked(isMemoryConfigured).mockReturnValue(false);
    const results = await searchMemory('deal-1', 'payoff');
    expect(results).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('returns shaped results when configured', async () => {
    vi.mocked(isMemoryConfigured).mockReturnValue(true);
    mockSearch.mockResolvedValueOnce([
      { id: 'mem-1', memory: 'payoff confirmed at $500k', score: 0.92 },
    ]);
    const results = await searchMemory('deal-1', 'payoff');
    expect(results).toEqual([{ id: 'mem-1', memory: 'payoff confirmed at $500k', score: 0.92 }]);
    expect(mockSearch).toHaveBeenCalledWith('payoff', { user_id: 'deal-1' });
  });
});

describe('clearSessionMemory', () => {
  afterEach(() => vi.clearAllMocks());

  it('is a no-op when not configured', async () => {
    vi.mocked(isMemoryConfigured).mockReturnValue(false);
    await clearSessionMemory('deal-1', 'session-1');
    expect(mockDeleteAll).not.toHaveBeenCalled();
  });

  it('calls client.deleteAll with userId and runId', async () => {
    vi.mocked(isMemoryConfigured).mockReturnValue(true);
    await clearSessionMemory('deal-1', 'session-abc');
    expect(mockDeleteAll).toHaveBeenCalledWith({ user_id: 'deal-1', run_id: 'session-abc' });
  });
});
