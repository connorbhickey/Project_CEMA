import type { OutreachResult } from '@cema/agents-servicer-outreach';
import { sleep } from 'workflow';


import { runOutreachStep } from './outreach.steps';

// Inlined, NOT imported from the @cema/* barrel: a `'use workflow'` fn runs in
// a sandbox VM with no Node.js, and the barrel pulls the AI SDK (via draft.ts).
// A bare numeric const is sandbox-safe; importing the package is not.
const MAX_ITERATIONS = 12;

/**
 * Durable outreach workflow. Takes three serializable strings (the durable
 * boundary cannot carry deps), and loops:
 *   step -> { stop|unsupported_channel: return ; wait: sleep(until) ; send: re-evaluate }
 * Each `wait` is a durable `sleep` to the next touch's absolute dueAt, so a
 * weeks-long cadence survives restarts and resumes exactly where it slept.
 * Replay idempotency is free: WDK caches completed step results, and recordTouch
 * is vendorEventId-keyed, so a resumed run never double-sends.
 *
 * MAX_ITERATIONS bounds the loop: 5 sends + 4 interleaved waits + 1 terminal
 * stop = ~10 iterations for a full cadence; 12 gives headroom while guaranteeing
 * a misconfigured evaluator can never spin forever.
 */
export async function outreachWorkflow(
  dealId: string,
  organizationId: string,
  actorUserId: string,
): Promise<OutreachResult> {
  'use workflow';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const result = await runOutreachStep(dealId, organizationId, actorUserId);
    const action = result.action;

    if (action.kind === 'stop' || action.kind === 'unsupported_channel') {
      return result;
    }

    if (action.kind === 'wait') {
      await sleep(action.until);
      continue;
    }

    // action.kind === 'send': the touch was just recorded. Loop immediately to
    // re-load context (touchesSent now incremented) and compute the next action.
  }

  throw new Error(`outreach workflow for deal ${dealId} exceeded ${MAX_ITERATIONS} iterations`);
}
