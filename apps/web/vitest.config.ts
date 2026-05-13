import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only run unit tests — e2e specs are executed by Playwright, not Vitest.
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'tests/e2e/**'],
  },
});
