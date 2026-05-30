import {
  FixtureChannelAdapter,
  runOutreach,
  type OutreachResult,
} from '@cema/agents-servicer-outreach';

import { buildOutreachDeps } from './deps';

/**
 * The one-and-only outreach `'use step'`: a full-Node boundary that rebuilds
 * deps internally (the durable boundary is not serializable -- WDK's codec does
 * not carry functions or class instances) and runs the whole `runOutreach` core.
 *
 * Unlike the intake wrap (ADR 0013), there is no orchestration duplication: the
 * evaluator is re-entrant, so calling the core once per iteration IS the step.
 * PII-safe logs: ids + the action enum + a boolean only -- never servicer names,
 * email bodies, or addresses (hard rule section 3).
 */
export async function runOutreachStep(
  dealId: string,
  organizationId: string,
  actorUserId: string,
): Promise<OutreachResult> {
  'use step';

  const deps = buildOutreachDeps({
    organizationId,
    actorUserId,
    channel: new FixtureChannelAdapter(),
  });

  const result = await runOutreach(dealId, deps);

  console.log('[outreach.step] ran', {
    dealId,
    action: result.action.kind,
    touchSent: result.touchSent !== null,
  });

  // A 'send' the channel rejected leaves touchSent null. Throw so WDK durably
  // RETRIES the whole step (re-load, re-evaluate, re-send) rather than silently
  // advancing the cadence past a touch that never went out.
  if (result.action.kind === 'send' && result.touchSent === null) {
    throw new Error(`outreach send rejected for deal ${dealId}; retrying step`);
  }

  return result;
}
