import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock @cema/search classifier
vi.mock('@cema/search', () => ({
  classifyQueryIntent: vi.fn(),
}));

// Mock search-similar
vi.mock('./search-similar', () => ({
  searchSimilar: vi.fn(),
}));

import { classifyQueryIntent } from '@cema/search';

import { askAnything } from './ask-anything';
import { searchSimilar } from './search-similar';


const SEARCH_CLASSIFICATION = { intent: 'search' as const, confidence: 0.95, entities: [] };
const ACTION_CLASSIFICATION = { intent: 'action' as const, confidence: 0.9, entities: [] };
const ANALYTICS_CLASSIFICATION = { intent: 'analytics' as const, confidence: 0.88, entities: [] };

const MOCK_HITS = [
  {
    kind: 'communication' as const,
    id: 'comm-1',
    cosineDistance: 0.2,
    similarity: 0.9,
    preview: 'payoff summary',
  },
];

describe('askAnything', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty hits and search classification for empty query', async () => {
    vi.mocked(classifyQueryIntent).mockResolvedValueOnce({
      intent: 'search',
      confidence: 1,
      entities: [],
    });
    vi.mocked(searchSimilar).mockResolvedValueOnce([]);

    const result = await askAnything('');

    expect(result.classification.intent).toBe('search');
    expect(result.hits).toEqual([]);
    expect(result.hint).toBeNull();
  });

  it('dispatches to searchSimilar for search intent and returns hits', async () => {
    vi.mocked(classifyQueryIntent).mockResolvedValueOnce(SEARCH_CLASSIFICATION);
    vi.mocked(searchSimilar).mockResolvedValueOnce(MOCK_HITS);

    const result = await askAnything('Wells Fargo payoff letter format');

    expect(result.classification).toEqual(SEARCH_CLASSIFICATION);
    expect(searchSimilar).toHaveBeenCalledWith({
      query: 'Wells Fargo payoff letter format',
      k: 10,
    });
    expect(result.hits).toEqual(MOCK_HITS);
    expect(result.hint).toBeNull();
  });

  it('returns hint and no hits for action intent', async () => {
    vi.mocked(classifyQueryIntent).mockResolvedValueOnce(ACTION_CLASSIFICATION);

    const result = await askAnything('Call Bob at Wells Fargo');

    expect(result.classification).toEqual(ACTION_CLASSIFICATION);
    expect(result.hits).toEqual([]);
    expect(result.hint).toContain('Phase 1');
    expect(searchSimilar).not.toHaveBeenCalled();
  });

  it('returns hint and no hits for analytics intent', async () => {
    vi.mocked(classifyQueryIntent).mockResolvedValueOnce(ANALYTICS_CLASSIFICATION);

    const result = await askAnything('How many CEMAs closed last month?');

    expect(result.classification).toEqual(ANALYTICS_CLASSIFICATION);
    expect(result.hits).toEqual([]);
    expect(result.hint).toContain('SQL');
    expect(searchSimilar).not.toHaveBeenCalled();
  });
});
