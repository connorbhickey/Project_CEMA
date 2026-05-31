import { spawnSync } from 'node:child_process';

// No LLM in the chain-of-title eval, so the only key the live run needs is
// BRAINTRUST_API_KEY. Absent it, skip-green (the offline scorers.test.ts is the
// real gate that runs in the required Unit-tests job).
const REQUIRED_KEYS = ['BRAINTRUST_API_KEY'];
const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);

if (missing.length > 0) {
  console.log(`[chain-of-title eval] skipped -- missing env: ${missing.join(', ')}`);
  process.exit(0);
}

const result = spawnSync('pnpm', ['exec', 'braintrust', 'eval', 'evals/chain-of-title.eval.ts'], {
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
