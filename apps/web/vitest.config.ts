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
    // Only run unit tests — e2e specs are executed by Playwright, and the
    // Neon-gated durable-workflow suite needs the @workflow/vitest runtime, so
    // it runs under vitest.integration.config.ts (pnpm test:workflow), never
    // here in the required-CI "Unit tests" job.
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'tests/e2e/**', 'tests/workflow/**'],
  },
});
