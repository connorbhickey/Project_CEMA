import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the two agent entry points the dispatcher fans out to. The pure mapping
// (triggerForStatus) is NOT mocked — the real status->trigger decision runs.
// ---------------------------------------------------------------------------

vi.mock('./collateral-pipeline', () => ({
  runCollateralPipeline: vi.fn(),
}));

vi.mock('./servicer-outreach/run-outreach-action', () => ({
  runOutreachFromDeal: vi.fn(),
}));

import { runCollateralPipeline } from './collateral-pipeline';
import { onDealStatusChanged } from './on-deal-status-changed';
import { runOutreachFromDeal } from './servicer-outreach/run-outreach-action';

beforeEach(() => {
  // The dispatcher discards each agent's return value, so the resolved shape is
  // irrelevant — only that the call was attempted.
  vi.mocked(runCollateralPipeline).mockResolvedValue(undefined as never);
  vi.mocked(runOutreachFromDeal).mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('onDealStatusChanged', () => {
  it("runs the collateral pipeline when a deal enters 'title_work'", async () => {
    await onDealStatusChanged('deal-1', 'title_work');

    expect(runCollateralPipeline).toHaveBeenCalledWith('deal-1');
    expect(runOutreachFromDeal).not.toHaveBeenCalled();
  });

  it("runs the outreach agent when a deal enters 'collateral_chase'", async () => {
    await onDealStatusChanged('deal-1', 'collateral_chase');

    expect(runOutreachFromDeal).toHaveBeenCalledWith('deal-1');
    expect(runCollateralPipeline).not.toHaveBeenCalled();
  });

  it('does nothing for a status with no wired agent', async () => {
    await onDealStatusChanged('deal-1', 'eligibility');

    expect(runCollateralPipeline).not.toHaveBeenCalled();
    expect(runOutreachFromDeal).not.toHaveBeenCalled();
  });

  it('swallows a failing agent run so the status write is never blocked', async () => {
    vi.mocked(runCollateralPipeline).mockRejectedValue(new Error('pipeline boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(onDealStatusChanged('deal-1', 'title_work')).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledTimes(1);

    errSpy.mockRestore();
  });
});
