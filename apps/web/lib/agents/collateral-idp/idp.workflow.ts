import type { IdpResult } from '@cema/agents-collateral-idp';

import { runCollateralIdpStep } from './idp.steps';

/**
 * Durable collateral-IDP workflow. Single-pass: IDP has no cadence, so the
 * whole core runs as ONE step with no sleep loop. The durable boundary buys
 * crash-safety + step-level retry of the (future) vendor extraction call, not
 * time-based resumption. Takes three serializable strings (the durable
 * boundary cannot carry deps).
 */
export async function idpWorkflow(
  dealId: string,
  organizationId: string,
  actorUserId: string,
): Promise<IdpResult> {
  'use workflow';

  return runCollateralIdpStep(dealId, organizationId, actorUserId);
}
