import type { IdpResult } from '@cema/agents-collateral-idp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCollateralIdpStep } from './idp.steps';
import { idpWorkflow } from './idp.workflow';

vi.mock('./idp.steps', () => ({ runCollateralIdpStep: vi.fn() }));

const mockedStep = vi.mocked(runCollateralIdpStep);

describe('idpWorkflow', () => {
  beforeEach(() => {
    mockedStep.mockReset();
  });

  it('runs the step exactly once and passes the result through', async () => {
    const result: IdpResult = { dealId: 'deal-1', documents: [], unreadable: [] };
    mockedStep.mockResolvedValue(result);

    const out = await idpWorkflow('deal-1', 'org-1', 'user-1');

    expect(mockedStep).toHaveBeenCalledTimes(1);
    expect(mockedStep).toHaveBeenCalledWith('deal-1', 'org-1', 'user-1');
    expect(out).toBe(result);
  });

  it('propagates a step failure (the durable retry boundary)', async () => {
    mockedStep.mockRejectedValue(new Error('vendor extraction failed'));

    await expect(idpWorkflow('deal-1', 'org-1', 'user-1')).rejects.toThrow(
      'vendor extraction failed',
    );
  });
});
