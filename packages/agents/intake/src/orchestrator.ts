import { checkEligibility } from './eligibility';
import { estimateSavings } from './savings';
import type { IntakeDeps, IntakeResult } from './types';

/**
 * Runs the Intake Agent end-to-end for one application (spec §9.3).
 *
 * The sequence is deliberately a flat chain of awaited collaborators —
 *   adapter.getApplication → checkEligibility → emitAudit → estimateSavings → createDeal
 * — so each `await` is a natural durability boundary that maps 1:1 onto a future
 * Vercel Workflow DevKit `step.run(...)` when we wrap this (plan Decision 1). The
 * core itself stays orchestration-agnostic: no app, DB, Clerk, or LLM imports —
 * every effect arrives through {@link IntakeDeps}.
 *
 * Eligibility and savings are deterministic (legal correctness over LLM judgment);
 * the LLM narrative is additive and lives downstream, never on this path.
 *
 * Audit ownership is split on purpose: this function emits only `intake.evaluated`
 * (for every run, eligible or not, so the decision is always recorded), while the
 * `deal.created` row is owned by `createDeal`, which writes it atomically with the
 * Deal insert. The audit emit happens BEFORE deal creation, so an evaluated
 * decision survives even if the subsequent insert fails.
 */
export async function runIntake(externalId: string, deps: IntakeDeps): Promise<IntakeResult> {
  const application = await deps.adapter.getApplication(externalId);
  const eligibility = checkEligibility(application);

  await deps.emitAudit({
    action: 'intake.evaluated',
    externalId,
    eligible: eligibility.eligible,
    reasons: eligibility.reasons,
  });

  if (!eligibility.eligible) {
    return { externalId, eligibility, savings: null, dealId: null };
  }

  const savings = estimateSavings(application, deps.rates);
  const { dealId } = await deps.createDeal({ application, savings });

  return { externalId, eligibility, savings, dealId };
}
