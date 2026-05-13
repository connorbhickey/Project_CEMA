import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Load .env.local so integration tests (e.g. rls-isolation.test.ts) can reach
// the Neon dev branch. Tests that require DATABASE_URL use `describe.skipIf`
// to skip gracefully in CI where the secret is absent.
config({ path: '.env.local' });

export default defineConfig({
  test: {
    // Only run unit tests — e2e specs are executed by Playwright, not Vitest.
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'tests/e2e/**'],
  },
});
