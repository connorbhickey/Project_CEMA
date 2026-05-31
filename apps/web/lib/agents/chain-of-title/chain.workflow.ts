import type { ChainResult } from '@cema/agents-chain-of-title';

import { runChainOfTitleStep } from './chain.steps';

/**
 * Durable single-pass Chain-of-Title workflow. Chain has no cadence, so unlike
 * the outreach workflow there is no sleep loop -- the workflow is exactly one
 * step. Kept as a workflow (not a bare action) so it inherits WDK durability +
 * step-level retry/replay once a backend is provisioned. Takes three
 * serializable strings (the durable boundary cannot carry deps). DORMANT today.
 */
export async function chainWorkflow(
  dealId: string,
  organizationId: string,
  actorUserId: string,
): Promise<ChainResult> {
  'use workflow';

  return runChainOfTitleStep(dealId, organizationId, actorUserId);
}
