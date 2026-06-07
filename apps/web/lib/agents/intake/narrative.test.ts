import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cema/agents-intake', () => ({
  isLlmConfigured: vi.fn(),
  draftSavingsNarrative: vi.fn(),
}));

vi.mock('@cema/compliance', () => ({
  // identity redactor is enough — the tests assert routing, not redaction itself
  redactPii: vi.fn((s: string) => s),
}));

vi.mock('@cema/db', () => ({
  deals: { id: 'id_col', metadata: 'metadata_col' },
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn().mockReturnValue({}) }));

vi.mock('../../with-rls', () => ({ withRls: vi.fn() }));
vi.mock('../../observability/report-error', () => ({ reportSwallowedError: vi.fn() }));

import { draftSavingsNarrative, isLlmConfigured } from '@cema/agents-intake';

import { reportSwallowedError } from '../../observability/report-error';
import { withRls } from '../../with-rls';

import { draftAndStoreSavingsNarrative, type DraftNarrativeArgs } from './narrative';

const ARGS: DraftNarrativeArgs = {
  dealId: 'deal-1',
  organizationId: 'org-1',
  // the helper only forwards these to draftSavingsNarrative (mocked), so shape is loose
  application: { externalId: 'app-1' } as never,
  savings: { netSavings: 1000 } as never,
  generatedAt: '2026-06-07T00:00:00.000Z',
};

afterEach(() => vi.clearAllMocks());

describe('draftAndStoreSavingsNarrative', () => {
  it('no-ops (returns false) when the LLM is unconfigured', async () => {
    vi.mocked(isLlmConfigured).mockReturnValue(false);
    const result = await draftAndStoreSavingsNarrative(ARGS);
    expect(result).toBe(false);
    expect(draftSavingsNarrative).not.toHaveBeenCalled();
    expect(withRls).not.toHaveBeenCalled();
  });

  it('returns false without persisting when the draft is null', async () => {
    vi.mocked(isLlmConfigured).mockReturnValue(true);
    vi.mocked(draftSavingsNarrative).mockResolvedValue(null);
    const result = await draftAndStoreSavingsNarrative(ARGS);
    expect(result).toBe(false);
    expect(withRls).not.toHaveBeenCalled();
  });

  it('persists the narrative onto deals.metadata and returns true on success', async () => {
    vi.mocked(isLlmConfigured).mockReturnValue(true);
    vi.mocked(draftSavingsNarrative).mockResolvedValue('You will save roughly $X.');

    const setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ metadata: { existing: true } }]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({ set: setSpy }),
    };
    vi.mocked(withRls).mockImplementation((_org, cb) => cb(tx as never));

    const result = await draftAndStoreSavingsNarrative(ARGS);

    expect(result).toBe(true);
    expect(withRls).toHaveBeenCalledWith('org-1', expect.any(Function));
    // merges into existing metadata (does not clobber) + stores the narrative text
    expect(setSpy).toHaveBeenCalledWith({
      metadata: {
        existing: true,
        savingsNarrative: { text: 'You will save roughly $X.', generatedAt: ARGS.generatedAt },
      },
    });
    expect(reportSwallowedError).not.toHaveBeenCalled();
  });

  it('swallows a configured-but-failed model call: routes to Sentry, returns false, never throws', async () => {
    vi.mocked(isLlmConfigured).mockReturnValue(true);
    vi.mocked(draftSavingsNarrative).mockRejectedValue(new Error('gateway 503'));

    const result = await draftAndStoreSavingsNarrative(ARGS);

    expect(result).toBe(false);
    expect(reportSwallowedError).toHaveBeenCalledWith(
      'INTAKE_NARRATIVE_FAILED',
      expect.stringContaining('gateway 503'),
      { dealId: 'deal-1' },
    );
  });
});
