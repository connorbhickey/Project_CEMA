import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Load .env.local so integration tests (e.g. rls-isolation.test.ts) can reach
// the Neon dev branch. Tests that require DATABASE_URL use `describe.skipIf`
// to skip gracefully in CI where the secret is absent.
config({ path: '.env.local' });

// Mirror the tsconfig "@/*": ["./*"] path mapping for vitest. tsc and Turbopack
// honor it, but vitest's resolver does not read tsconfig paths, so integration
// tests that load the real loaders (which import '@/lib/with-rls') fail without
// this. A plain '@' string alias matches only '@/…' (the char after '@' must be
// '/'), so it never captures '@cema/*' workspace imports.
const appRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');

export default defineConfig({
  resolve: {
    alias: { '@': appRoot },
  },
  test: {
    // Only run unit tests here. Three suites run elsewhere:
    //   - e2e specs (tests/e2e/**) execute under Playwright;
    //   - the durable-workflow suite (tests/workflow/**) needs the
    //     @workflow/vitest runtime, via vitest.integration.config.ts (test:workflow);
    //   - the Neon-gated DB integration suite (tests/integration/**) runs
    //     SERIALLY against the shared dev branch, via vitest.neon.config.ts
    //     (test:integration) — running it in this parallel pool races on shared
    //     tenant/audit state and flakes. All three are Neon-/runtime-gated and are
    //     skip-green in CI, so excluding them keeps the required "Unit tests" job
    //     fast + deterministic.
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'tests/e2e/**', 'tests/workflow/**', 'tests/integration/**'],
  },
});
