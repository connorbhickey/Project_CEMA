import type { IdpResult } from '@cema/agents-collateral-idp';
import { FixtureIdpAdapter, runCollateralIdp } from '@cema/agents-collateral-idp';

import { buildIdpDeps } from './deps';

/**
 * The one durable step: rebuilds deps internally (the durable boundary is not
 * serializable -- WDK's codec does not carry functions or class instances) and
 * runs the whole IDP core. A rejected effect throws, which WDK treats as a
 * retryable step failure.
 */
export async function runCollateralIdpStep(
  dealId: string,
  organizationId: string,
  actorUserId: string,
): Promise<IdpResult> {
  'use step';

  const deps = buildIdpDeps({ organizationId, actorUserId, idp: new FixtureIdpAdapter() });
  const result = await runCollateralIdp(dealId, deps);

  // PII-safe: ids + counts only (never party names, amounts, or addresses).
  console.log(
    `idp.step deal=${dealId} documents=${result.documents.length} unreadable=${result.unreadable.length}`,
  );

  return result;
}
