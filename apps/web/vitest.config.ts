import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Load .env.local so integration tests (e.g. rls-isolation.test.ts) can reach
// the Neon dev branch. Tests that require DATABASE_URL use `describe.skipIf`
// to skip gracefully in CI where the secret is absent.
config({ path: '.env.local' });

export default defineConfig({
  test: {
    // Only run unit tests — e2e specs are executed by Playwright, and the
    // Neon-gated durable-workflow suite needs the @workflow/vitest runtime, so
    // it runs under vitest.integration.config.ts (pnpm test:workflow), never
    // here in the required-CI "Unit tests" job.
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'tests/e2e/**', 'tests/workflow/**'],
  },
});
