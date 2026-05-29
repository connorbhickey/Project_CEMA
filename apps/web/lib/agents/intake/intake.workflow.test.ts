import { FixtureLosAdapter, checkEligibility, type SavingsEstimate } from '@cema/agents-intake';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the durable steps so this test exercises pure orchestration — the await
// ordering, the eligibility branch, argument passing, and result assembly —
// without a DB or the durable runtime. Under the default Vitest config the
// `'use workflow'` directive is inert, so intakeWorkflow runs as a plain async
// function calling these mocks. The real durable runtime is covered by the
// Neon-gated @workflow/vitest integration test (Task 5).
vi.mock('./intake.steps');

import { createDealStep, emitEvaluatedStep, fetchAndEvaluateStep } from './intake.steps';
import { intakeWorkflow } from './intake.workflow';

const ORG_ID = 'org-123';
const USER_ID = 'user-456';

const FAKE_SAVINGS: SavingsEstimate = {
  assignedUpb: 400_000,
  appliedRate: 0.02,
  taxSaved: 8_000,
  fees: 1_000,
  netSavings: 7_000,
  isPlaceholderRate: true,
};

/** Build a realistic {application, eligibility} from the real fixtures + checker. */
async function fixtureEvaluation(externalId: string) {
  const application = await new FixtureLosAdapter().getApplication(externalId);
  const eligibility = checkEligibility(application);
  return { application, eligibility };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('intakeWorkflow', () => {
  it('eligible path: fetch → emit → create, then returns dealId + savings', async () => {
    const evaluation = await fixtureEvaluation('FIX-ELIG-SF');
    vi.mocked(fetchAndEvaluateStep).mockResolvedValue(evaluation);
    vi.mocked(emitEvaluatedStep).mockResolvedValue(undefined);
    vi.mocked(createDealStep).mockResolvedValue({
      dealId: 'DEAL-FIX-ELIG-SF',
      savings: FAKE_SAVINGS,
    });

    const result = await intakeWorkflow('FIX-ELIG-SF', ORG_ID, USER_ID);

    expect(fetchAndEvaluateStep).toHaveBeenCalledWith('FIX-ELIG-SF');
    expect(emitEvaluatedStep).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      externalId: 'FIX-ELIG-SF',
      eligible: true,
      reasons: [],
    });
    expect(createDealStep).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      application: evaluation.application,
    });

    // Audit-split posture: emit `intake.evaluated` BEFORE creating the deal.
    const emitOrder = vi.mocked(emitEvaluatedStep).mock.invocationCallOrder[0]!;
    const createOrder = vi.mocked(createDealStep).mock.invocationCallOrder[0]!;
    expect(emitOrder).toBeLessThan(createOrder);

    expect(result).toEqual({
      externalId: 'FIX-ELIG-SF',
      eligibility: evaluation.eligibility,
      savings: FAKE_SAVINGS,
      dealId: 'DEAL-FIX-ELIG-SF',
    });
  });

  it('ineligible path: emits once, never creates a deal, returns null savings + dealId', async () => {
    const evaluation = await fixtureEvaluation('FIX-INELIG-COOP');
    vi.mocked(fetchAndEvaluateStep).mockResolvedValue(evaluation);
    vi.mocked(emitEvaluatedStep).mockResolvedValue(undefined);

    const result = await intakeWorkflow('FIX-INELIG-COOP', ORG_ID, USER_ID);

    expect(emitEvaluatedStep).toHaveBeenCalledTimes(1);
    expect(createDealStep).not.toHaveBeenCalled();
    expect(result.eligibility.eligible).toBe(false);
    expect(result.savings).toBeNull();
    expect(result.dealId).toBeNull();
  });
});
