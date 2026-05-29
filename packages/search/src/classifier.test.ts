import { describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => ({
  generateObject: vi.fn().mockImplementation(({ prompt }: { prompt: string }) => {
    // Extract only the query line from the prompt (last non-empty line after "Query: ")
    const queryMatch = /Query:\s*(.+)$/m.exec(prompt);
    const query = queryMatch ? queryMatch[1]!.toLowerCase() : '';
    let intent: 'search' | 'action' | 'analytics' = 'search';
    if (query.includes('call') || query.includes('send')) intent = 'action';
    if (query.includes('count') || query.includes('average') || query.includes('how many'))
      intent = 'analytics';
    return { object: { intent, confidence: 0.92, entities: [] } };
  }),
}));

// createAnthropic is a two-level factory: createAnthropic(config) → gateway(modelId)
// → model object (the generateObject mock above ignores it).
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => () => ({ modelId: 'anthropic/claude-sonnet-4.6' })),
}));

import { classifyQueryIntent } from './classifier';

describe('classifyQueryIntent', () => {
  it('classifies a fact-retrieval query as search', async () => {
    const result = await classifyQueryIntent('Wells Fargo payoff letter format');
    expect(result.intent).toBe('search');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies an action query as action', async () => {
    const result = await classifyQueryIntent('Call Bob at Wells Fargo');
    expect(result.intent).toBe('action');
  });

  it('classifies a counting query as analytics', async () => {
    const result = await classifyQueryIntent('How many CEMAs closed last month?');
    expect(result.intent).toBe('analytics');
  });

  it('returns search with full confidence for empty query', async () => {
    const result = await classifyQueryIntent('');
    expect(result.intent).toBe('search');
    expect(result.confidence).toBe(1);
  });
});
