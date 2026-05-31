import type { ChainResult } from '@cema/agents-chain-of-title';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runChainOfTitleStep } from './chain.steps';
import { chainWorkflow } from './chain.workflow';

vi.mock('./chain.steps', () => ({ runChainOfTitleStep: vi.fn() }));

const mockedStep = vi.mocked(runChainOfTitleStep);

describe('chainWorkflow', () => {
  beforeEach(() => {
    mockedStep.mockReset();
  });

  it('runs the step exactly once and passes the result through', async () => {
    const result: ChainResult = { dealId: 'deal-1', status: 'clean', breaks: [], routes: [] };
    mockedStep.mockResolvedValue(result);

    const out = await chainWorkflow('deal-1', 'org-1', 'user-1');

    expect(mockedStep).toHaveBeenCalledTimes(1);
    expect(mockedStep).toHaveBeenCalledWith('deal-1', 'org-1', 'user-1');
    expect(out).toBe(result);
  });

  it('propagates a step failure (the durable retry boundary)', async () => {
    mockedStep.mockRejectedValue(new Error('load failed'));

    await expect(chainWorkflow('deal-1', 'org-1', 'user-1')).rejects.toThrow('load failed');
  });
});
