import { describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => ({
  embed: vi.fn().mockResolvedValue({
    embedding: new Array(3072).fill(0).map((_, i) => i / 3072),
    usage: { tokens: 7 },
  }),
}));

vi.mock('@ai-sdk/openai', () => ({
  openai: {
    embedding: vi.fn().mockReturnValue({ modelId: 'text-embedding-3-large' }),
  },
}));

import { embedText } from './client';

describe('embedText', () => {
  it('returns a 3072-dim embedding for text input', async () => {
    const res = await embedText({ text: 'CEMA payoff letter' });
    expect(res.dimensions).toBe(3072);
    expect(res.embedding).toHaveLength(3072);
    expect(res.model).toBe('text-embedding-3-large');
    expect(res.inputTokens).toBe(7);
  });

  it('uses text-embedding-3-large by default', async () => {
    const res = await embedText({ text: 'CEMA payoff letter' });
    expect(res.model).toBe('text-embedding-3-large');
  });
});
