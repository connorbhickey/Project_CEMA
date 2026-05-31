import type { ChainResult } from '@cema/agents-chain-of-title';

import { buildChainDeps, runChainOfTitle } from './deps';

/**
 * The one durable step: rebuilds deps internally (the durable boundary is not
 * serializable -- WDK's codec does not carry functions or class instances) and
 * runs the whole Chain-of-Title core. A rejected effect throws, which WDK
 * treats as a retryable step failure. Chain has no cadence, so this single
 * step IS the whole workflow (no sleep loop, unlike the outreach cadence).
 */
export async function runChainOfTitleStep(
  dealId: string,
  organizationId: string,
  actorUserId: string,
): Promise<ChainResult> {
  'use step';

  const deps = buildChainDeps({ organizationId, actorUserId });
  const result = await runChainOfTitle(dealId, deps);

  // PII-safe: ids + counts + status enum only (never party names, amounts, or
  // break detail).
  console.log(
    `chain.step deal=${dealId} status=${result.status} breaks=${result.breaks.length} routes=${result.routes.length}`,
  );

  return result;
}
