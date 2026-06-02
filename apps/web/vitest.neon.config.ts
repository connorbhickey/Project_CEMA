import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Neon-gated DB integration config (tests/integration/**). Separate from the
// default vitest.config.ts — and excluded from it — so these run with FILE
// PARALLELISM DISABLED. They execute against the shared Neon dev branch, so running
// multiple suites concurrently races on shared tenant/audit state (the documented
// shared-dev-branch hazard): a positive-control row another suite is mid-write on
// vanishes, etc. Serialized here, every suite passes deterministically. In CI they
// skip-green (describe.skipIf(!DATABASE_URL)), so this config is never required.
//
// Run with: pnpm --filter web test:integration
config({ path: '.env.local' });

// Mirror the tsconfig "@/*" mapping (the loaders the integration tests import
// transitively reach '@/lib/with-rls') — same as vitest.config.ts.
const appRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');

export default defineConfig({
  resolve: {
    alias: { '@': appRoot },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    // Serialize: one suite at a time against the shared Neon branch.
    fileParallelism: false,
  },
});
