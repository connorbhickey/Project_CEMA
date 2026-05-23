import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/search', () => ({ classifyQueryIntent: vi.fn() }));
vi.mock('./search-similar', () => ({ searchSimilar: vi.fn() }));
vi.mock('@cema/typesense', () => ({
  isTypesenseConfigured: vi.fn(),
  searchTypesense: vi.fn(),
}));
vi.mock('@cema/auth', () => ({ getCurrentOrganizationId: vi.fn() }));
vi.mock('@cema/db', () => ({
  getDb: vi.fn(() => ({
    query: { organizations: { findFirst: vi.fn() } },
  })),
  organizations: {},
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

import { classifyQueryIntent } from '@cema/search';
import { isTypesenseConfigured, searchTypesense } from '@cema/typesense';

import { askAnything } from './ask-anything';
import { searchSimilar } from './search-similar';

const SEARCH = { intent: 'search' as const, confidence: 0.95, entities: [] };
const ACTION = { intent: 'action' as const, confidence: 0.9, entities: [] };
const ANALYTICS = { intent: 'analytics' as const, confidence: 0.88, entities: [] };

const PG_HITS = [
  {
    kind: 'communication' as const,
    id: 'comm-1',
    cosineDistance: 0.2,
    similarity: 0.9,
    preview: 'payoff summary',
  },
];
const TS_HITS_NEW = [{ kind: 'document' as const, id: 'doc-99', textMatchScore: 1000 }];
const TS_HITS_DUPE = [{ kind: 'communication' as const, id: 'comm-1', textMatchScore: 900 }];

describe('askAnything', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty hits for search intent with empty query', async () => {
    vi.mocked(classifyQueryIntent).mockResolvedValueOnce({
      intent: 'search',
      confidence: 1,
      entities: [],
    });
    vi.mocked(searchSimilar).mockResolvedValueOnce([]);
    vi.mocked(isTypesenseConfigured).mockReturnValue(false);

    const result = await askAnything('');
    expect(result.classification.intent).toBe('search');
    expect(result.hits).toEqual([]);
    expect(result.hint).toBeNull();
  });

  it('dispatches to searchSimilar for search intent', async () => {
    vi.mocked(classifyQueryIntent).mockResolvedValueOnce(SEARCH);
    vi.mocked(searchSimilar).mockResolvedValueOnce(PG_HITS);
    vi.mocked(isTypesenseConfigured).mockReturnValue(false);

    const result = await askAnything('Wells Fargo payoff letter format');
    expect(searchSimilar).toHaveBeenCalledWith({
      query: 'Wells Fargo payoff letter format',
      k: 10,
    });
    expect(result.hits).toEqual(PG_HITS);
    expect(result.hint).toBeNull();
  });

  it('merges Typesense-only hits when Typesense is configured', async () => {
    const { getDb } = await import('@cema/db');
    const { getCurrentOrganizationId } = await import('@cema/auth');

    vi.mocked(classifyQueryIntent).mockResolvedValueOnce(SEARCH);
    vi.mocked(searchSimilar).mockResolvedValueOnce(PG_HITS);
    vi.mocked(isTypesenseConfigured).mockReturnValue(true);
    vi.mocked(getCurrentOrganizationId).mockResolvedValueOnce('clerk-org-1');
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValueOnce({ id: 'org-uuid-1' }) } },
    } as never);
    vi.mocked(searchTypesense).mockResolvedValueOnce(TS_HITS_NEW);

    const result = await askAnything('payoff');
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]).toEqual(PG_HITS[0]);
    expect(result.hits[1]).toMatchObject({
      kind: 'document',
      id: 'doc-99',
      preview: '(full-text match)',
    });
  });

  it('deduplicates Typesense hits already in pgvector results', async () => {
    const { getDb } = await import('@cema/db');
    const { getCurrentOrganizationId } = await import('@cema/auth');

    vi.mocked(classifyQueryIntent).mockResolvedValueOnce(SEARCH);
    vi.mocked(searchSimilar).mockResolvedValueOnce(PG_HITS);
    vi.mocked(isTypesenseConfigured).mockReturnValue(true);
    vi.mocked(getCurrentOrganizationId).mockResolvedValueOnce('clerk-org-1');
    vi.mocked(getDb).mockReturnValue({
      query: { organizations: { findFirst: vi.fn().mockResolvedValueOnce({ id: 'org-uuid-1' }) } },
    } as never);
    vi.mocked(searchTypesense).mockResolvedValueOnce(TS_HITS_DUPE);

    const result = await askAnything('payoff');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toEqual(PG_HITS[0]);
  });

  it('returns hint and no hits for action intent', async () => {
    vi.mocked(classifyQueryIntent).mockResolvedValueOnce(ACTION);

    const result = await askAnything('Call Bob at Wells Fargo');
    expect(result.hits).toEqual([]);
    expect(result.hint).toContain('Phase 1');
    expect(searchSimilar).not.toHaveBeenCalled();
  });

  it('returns hint and no hits for analytics intent', async () => {
    vi.mocked(classifyQueryIntent).mockResolvedValueOnce(ANALYTICS);

    const result = await askAnything('How many CEMAs closed last month?');
    expect(result.hits).toEqual([]);
    expect(result.hint).toContain('SQL');
    expect(searchSimilar).not.toHaveBeenCalled();
  });
});
