import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the AI SDK the same way @cema/search's classifier test does, so no real
// model call is made. generateTextMock is hoisted-safe (referenced lazily). The
// explicit return type keeps the line-7 forwarder off no-unsafe-return — a bare
// vi.fn() returns `any`, and the lazy wrapper would propagate that.
const generateTextMock = vi.fn<(args: unknown) => Promise<{ text: string }>>();
vi.mock('ai', () => ({
  generateText: (args: unknown) => generateTextMock(args),
}));
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn().mockReturnValue({ modelId: 'claude-sonnet-4-6' }),
}));

import { draftSavingsNarrative, isLlmConfigured } from './narrative';
import { buildSavingsNarrativePrompt } from './prompts/savings-narrative';
import type { NormalizedApplication, SavingsEstimate } from './types';

function app(overrides: Partial<NormalizedApplication> = {}): NormalizedApplication {
  return {
    externalId: 'LOS-0001',
    cemaType: 'refi_cema',
    state: 'NY',
    propertyType: 'single_family',
    loanProgram: 'conventional',
    lienPosition: 1,
    existingUpb: 400_000,
    newLoanAmount: 500_000,
    county: 'Kings',
    ...overrides,
  };
}

function savings(overrides: Partial<SavingsEstimate> = {}): SavingsEstimate {
  return {
    assignedUpb: 400_000,
    appliedRate: 0.02,
    taxSaved: 8_000,
    fees: 1_000,
    netSavings: 7_000,
    isPlaceholderRate: false,
    ...overrides,
  };
}

describe('isLlmConfigured', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is false when ANTHROPIC_API_KEY is empty/unset', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(isLlmConfigured()).toBe(false);
  });

  it('is true when ANTHROPIC_API_KEY is set', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    expect(isLlmConfigured()).toBe(true);
  });
});

describe('draftSavingsNarrative', () => {
  // Block body (returns undefined) is deliberate: an expression body would return
  // the mock from mockReset(), and vitest treats a function returned from a hook as
  // a teardown callback — it would re-invoke the reject-configured mock after the
  // test, surfacing an unhandled rejection that fails the (otherwise passing) test.
  beforeEach(() => {
    generateTextMock.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns null and never calls the model when unconfigured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const result = await draftSavingsNarrative(app(), savings());
    expect(result).toBeNull();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('returns the generated narrative text when configured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    generateTextMock.mockResolvedValue({ text: 'This CEMA saves you about $7,000.' });
    const result = await draftSavingsNarrative(app(), savings());
    expect(result).toBe('This CEMA saves you about $7,000.');
    expect(generateTextMock).toHaveBeenCalledOnce();
  });

  it('trims surrounding whitespace from the model output', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    generateTextMock.mockResolvedValue({ text: '\n  Net savings ~$7,000.  \n' });
    expect(await draftSavingsNarrative(app(), savings())).toBe('Net savings ~$7,000.');
  });

  it('lets a configured-but-failed model call surface (null means "off", not "broken")', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    generateTextMock.mockRejectedValue(new Error('gateway 503'));
    await expect(draftSavingsNarrative(app(), savings())).rejects.toThrow('gateway 503');
  });
});

describe('buildSavingsNarrativePrompt', () => {
  it('grounds the prompt in the provided savings figures (no invented numbers)', () => {
    const prompt = buildSavingsNarrativePrompt(app(), savings({ netSavings: 7_000 }));
    expect(prompt).toContain('7000');
    expect(prompt).toContain('Kings');
  });

  it('instructs a preliminary-estimate caveat when rates are placeholder', () => {
    const prompt = buildSavingsNarrativePrompt(app(), savings({ isPlaceholderRate: true }));
    expect(prompt.toLowerCase()).toContain('preliminary');
  });

  it('omits the placeholder caveat when rates are confirmed', () => {
    const prompt = buildSavingsNarrativePrompt(app(), savings({ isPlaceholderRate: false }));
    expect(prompt.toLowerCase()).not.toContain('preliminary');
  });

  it('forbids legal/tax advice (attorney-supervised posture)', () => {
    const prompt = buildSavingsNarrativePrompt(app(), savings());
    expect(prompt.toLowerCase()).toContain('not legal or tax advice');
  });
});
