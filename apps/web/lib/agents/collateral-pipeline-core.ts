import type { ChainResult } from '@cema/agents-chain-of-title';
import type { IdpResult } from '@cema/agents-collateral-idp';
import type { OutreachResult } from '@cema/agents-servicer-outreach';

/**
 * The composed result of the collateral pipeline. `chain` is null when IDP
 * classified zero documents (nothing to validate); `outreach` is null unless
 * Chain-of-Title routed a `re_chase` break (the only condition that hands off
 * to the Servicer Outreach Agent).
 */
export interface CollateralPipelineResult {
  readonly dealId: string;
  readonly idp: IdpResult;
  readonly chain: ChainResult | null;
  readonly outreach: OutreachResult | null;
}

/**
 * True when the chain analysis routed at least one `re_chase` remedy — the
 * branch decision that triggers the Servicer Outreach Agent. Kept pure (no
 * I/O, no clock) so it is durable-replay safe and unit-testable in isolation,
 * and so it can live outside the `'use server'` boundary.
 */
export function hasReChase(chain: ChainResult): boolean {
  return chain.routes.some((route) => route.kind === 're_chase');
}
