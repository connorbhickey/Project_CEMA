import {
  FixtureLosAdapter,
  checkEligibility,
  estimateSavings,
  type EligibilityResult,
  type IneligibilityReason,
  type NormalizedApplication,
  type SavingsEstimate,
} from '@cema/agents-intake';

import { buildIntakeDeps } from './deps';

/**
 * The three durable steps of the Intake Agent's WDK workflow (ADR 0013). Each
 * mirrors one awaited boundary of the orchestration-agnostic core `runIntake`
 * (`@cema/agents-intake`), but is shaped for the durable runtime instead of the
 * dependency-injection seam:
 *
 *   - The core takes a non-serializable `IntakeDeps` (closures + a LosAdapter
 *     instance) injected once. That cannot cross a durable step boundary, so
 *     each step here instead receives only **serializable** primitives
 *     (ids, plain application/eligibility objects) and rebuilds its own
 *     `IntakeDeps` internally via {@link buildIntakeDeps}.
 *   - The deterministic pure functions (`checkEligibility`, `estimateSavings`)
 *     run inline inside the steps that need them — they are cheap and have no
 *     I/O, so they need no boundary of their own (same as the core, where they
 *     surface as span attributes rather than child spans).
 *
 * These run in full Node (steps are NOT sandboxed — only the `'use workflow'`
 * orchestrator is), so importing the DB-backed `buildIntakeDeps` here is safe.
 *
 * Logging is PII-safe per CLAUDE.md §10.3 / hard rule #3: only the LOS
 * externalId (not PII) and boolean outcomes — never UPB, fees, tax, net-savings,
 * names, or addresses.
 */

/**
 * Step 1: fetch the application from the LOS and run the deterministic
 * eligibility check. Bundles `runIntake`'s fetch + (inline) eligibility into one
 * durable boundary so a single replay-cached result carries both. Uses the
 * FixtureLosAdapter until a real LOS adapter is wired (ADR 0010 carry-over #5).
 */
export async function fetchAndEvaluateStep(externalId: string): Promise<{
  application: NormalizedApplication;
  eligibility: EligibilityResult;
}> {
  'use step';
  const application = await new FixtureLosAdapter().getApplication(externalId);
  const eligibility = checkEligibility(application);
  console.log(
    `[intake.step] fetch+evaluate externalId=${externalId} eligible=${eligibility.eligible}`,
  );
  return { application, eligibility };
}

/**
 * Step 2: emit the `intake.evaluated` audit event for every run (eligible or
 * not), BEFORE any deal is created — preserving the core's audit-split posture
 * so the decision is durably recorded even if a later step fails.
 */
export async function emitEvaluatedStep(args: {
  organizationId: string;
  actorUserId: string;
  externalId: string;
  eligible: boolean;
  reasons: IneligibilityReason[];
}): Promise<void> {
  'use step';
  const { organizationId, actorUserId, externalId, eligible, reasons } = args;
  const deps = buildIntakeDeps({
    organizationId,
    actorUserId,
    adapter: new FixtureLosAdapter(),
  });
  await deps.emitAudit({ action: 'intake.evaluated', externalId, eligible, reasons });
  console.log(`[intake.step] emit evaluated externalId=${externalId} eligible=${eligible}`);
}

/**
 * Step 3 (eligible path only): compute the savings estimate (inline, on
 * PLACEHOLDER_RATES until ADR 0010 carry-over #4 lands) and create the minimal
 * intake Deal, which owns the atomic `deal.created` audit row. Returns both the
 * new deal id and the savings so the workflow can assemble its result.
 */
export async function createDealStep(args: {
  organizationId: string;
  actorUserId: string;
  application: NormalizedApplication;
}): Promise<{ dealId: string; savings: SavingsEstimate }> {
  'use step';
  const { organizationId, actorUserId, application } = args;
  const savings = estimateSavings(application);
  const deps = buildIntakeDeps({
    organizationId,
    actorUserId,
    adapter: new FixtureLosAdapter(),
  });
  const { dealId } = await deps.createDeal({ application, savings });
  console.log(
    `[intake.step] create deal externalId=${application.externalId} created=${Boolean(dealId)}`,
  );
  return { dealId, savings };
}
