import { describe, expect, it } from 'vitest';

import { parseSavingsNarrative } from './savings-narrative';

describe('parseSavingsNarrative', () => {
  it('reads a well-formed narrative from metadata', () => {
    const md = {
      savingsNarrative: { text: 'You may save roughly $X.', generatedAt: '2026-06-07T00:00:00Z' },
    };
    expect(parseSavingsNarrative(md)).toEqual({
      text: 'You may save roughly $X.',
      generatedAt: '2026-06-07T00:00:00Z',
    });
  });

  it('tolerates a missing generatedAt', () => {
    const md = { savingsNarrative: { text: 'Savings text.' } };
    expect(parseSavingsNarrative(md)).toEqual({ text: 'Savings text.', generatedAt: null });
  });

  it('returns null when no narrative is present (the common case — LLM env-gated)', () => {
    expect(parseSavingsNarrative({})).toBeNull();
    expect(parseSavingsNarrative({ recording: { crfn: '2026-1' } })).toBeNull();
  });

  it('is defensive against arbitrary / malformed jsonb', () => {
    expect(parseSavingsNarrative(null)).toBeNull();
    expect(parseSavingsNarrative('a string')).toBeNull();
    expect(parseSavingsNarrative({ savingsNarrative: 'not an object' })).toBeNull();
    expect(parseSavingsNarrative({ savingsNarrative: { text: '' } })).toBeNull(); // empty text
    expect(parseSavingsNarrative({ savingsNarrative: { text: 42 } })).toBeNull(); // wrong type
  });
});
