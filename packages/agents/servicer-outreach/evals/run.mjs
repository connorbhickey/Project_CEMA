#!/usr/bin/env node
/**
 * Skip-green wrapper for the outreach-email Braintrust eval. If either key is
 * absent, log why and exit 0 -- keeping CI green. Compliance logic is verified
 * independently by evals/scorers.test.ts in the Unit tests job.
 */
import { spawnSync } from 'node:child_process';

const REQUIRED_KEYS = ['BRAINTRUST_API_KEY', 'AI_GATEWAY_API_KEY'];
const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.log(
    `[outreach eval] skipped -- missing ${missing.join(', ')}. ` +
      'Scorers are verified offline by evals/scorers.test.ts; provision both keys to run the live eval.',
  );
  process.exit(0);
}

const result = spawnSync('pnpm exec braintrust eval evals/outreach-email.eval.ts', {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
