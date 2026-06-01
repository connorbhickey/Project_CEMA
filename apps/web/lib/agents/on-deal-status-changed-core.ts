import type { DealStatus } from '../actions/transition-deal-status';

/**
 * Which agent (if any) a freshly-entered deal status should fire.
 *
 * - `collateral_pipeline` runs IDP -> Chain-of-Title (-> Outreach on a
 *   re_chase break); fired when the collateral file has arrived and title work
 *   begins.
 * - `outreach` runs the Servicer Outreach Agent; fired while chasing the prior
 *   servicer for that file.
 */
export type AgentTrigger = 'collateral_pipeline' | 'outreach';

/**
 * Pure status -> trigger mapping. The deal_status lifecycle is the trigger
 * surface for the Layer-3 agents (M14); only two statuses are wired today.
 * Kept pure and table-driven so the mapping is unit-testable without mocking
 * any Server Action, and so it can live outside the agent dispatcher's
 * effectful boundary.
 */
export function triggerForStatus(status: DealStatus): AgentTrigger | null {
  switch (status) {
    case 'title_work':
      return 'collateral_pipeline';
    case 'collateral_chase':
      return 'outreach';
    default:
      return null;
  }
}
