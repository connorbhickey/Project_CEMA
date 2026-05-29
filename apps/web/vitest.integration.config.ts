import { workflow } from '@workflow/vitest';
import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Durable-workflow integration config (ADR 0013). Separate from vitest.config.ts
// because the @workflow/vitest plugin must compile the `'use workflow'`/`'use step'`
// directives and run the workflow in-process via a fresh Local World — machinery
// the plain unit suite neither needs nor should pay for. Kept out of required CI:
// the only spec under tests/workflow/** drives the real RLS write path, so it is
// Neon-gated (describe.skipIf) and excluded from the default `pnpm test`.
config({ path: '.env.local' });

export default defineConfig({
  plugins: [workflow()],
  test: {
    include: ['tests/workflow/**/*.test.ts'],
    // Workflows run through the durable runtime (build + Local World) — slower
    // than a unit test, so give them a generous ceiling (per WDK testing docs).
    testTimeout: 60_000,
  },
});
