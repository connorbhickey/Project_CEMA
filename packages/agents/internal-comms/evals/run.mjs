import { spawnSync } from 'node:child_process';

// Internal Comms makes no model call, so the only key the live eval needs is Braintrust.
const REQUIRED_KEYS = ['BRAINTRUST_API_KEY'];
const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);

if (missing.length > 0) {
  console.log(`[internal-comms eval] skipped -- missing env: ${missing.join(', ')}`);
  process.exit(0);
}

const result = spawnSync('pnpm', ['exec', 'braintrust', 'eval', 'evals/internal-comms.eval.ts'], {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
