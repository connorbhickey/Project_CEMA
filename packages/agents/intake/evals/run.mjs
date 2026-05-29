#!/usr/bin/env node
/**
 * Skip-green wrapper for the savings-narrative Braintrust eval.
 *
 * The eval makes a live model call (AI_GATEWAY_API_KEY) AND logs to Braintrust
 * (BRAINTRUST_API_KEY). Neither is provisioned in CI, so this mirrors the repo's
 * isXConfigured() gating: if either key is absent, log why and exit 0 — keeping the
 * non-blocking `llm-eval` job green. The compliance logic the eval grades is verified
 * independently by evals/scorers.test.ts, which runs in the required Unit tests job.
 *
 * A `.mjs` (not `.ts`) so it needs no transpile step and stays off the lint/typecheck
 * graph; it is plumbing, not shipped code.
 */
import { spawnSync } from 'node:child_process';

const REQUIRED_KEYS = ['BRAINTRUST_API_KEY', 'AI_GATEWAY_API_KEY'];
const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.log(
    `[intake eval] skipped — missing ${missing.join(', ')}. ` +
      'Scorers are verified offline by evals/scorers.test.ts; provision both keys to run the live eval.',
  );
  process.exit(0);
}

const result = spawnSync('pnpm exec braintrust eval evals/savings-narrative.eval.ts', {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
