import type { IntakeResult } from '@cema/agents-intake';

import { createDealStep, emitEvaluatedStep, fetchAndEvaluateStep } from './intake.steps';

/**
 * Durable WDK wrap of the Intake Agent (ADR 0013). This `"use workflow"` function
 * is the orchestrator: it runs in a sandboxed VM with NO Node.js, so it imports
 * only the step references and a TYPE-ONLY IntakeResult (erased at compile time →
 * zero runtime import). Every Node-touching effect — LOS fetch, audit emit, deal
 * insert — lives behind the three `"use step"` boundaries in ./intake.steps, which
 * the runtime enqueues and persists individually.
 *
 * The shape is identical to the core `runIntake` (fetch+evaluate → emit audit →
 * branch on eligibility → create deal), so behavior is unchanged; only the
 * execution model differs (durable, replayable steps vs. an in-process await
 * chain). The audit-split posture is preserved: emitEvaluatedStep runs before
 * createDealStep, and because each step's result is persisted, a crash-resume
 * replays completed steps from cache rather than re-running them — so the deal
 * insert is not duplicated on retry.
 *
 * The intake savings narrative (the only LLM surface) is intentionally NOT part of
 * this path; it stays additive and downstream, never gating deal creation.
 */
export async function intakeWorkflow(
  externalId: string,
  organizationId: string,
  actorUserId: string,
): Promise<IntakeResult> {
  'use workflow';

  const { application, eligibility } = await fetchAndEvaluateStep(externalId);

  await emitEvaluatedStep({
    organizationId,
    actorUserId,
    externalId,
    eligible: eligibility.eligible,
    reasons: eligibility.reasons,
  });

  if (!eligibility.eligible) {
    return { externalId, eligibility, savings: null, dealId: null };
  }

  const { dealId, savings } = await createDealStep({ organizationId, actorUserId, application });

  return { externalId, eligibility, savings, dealId };
}
