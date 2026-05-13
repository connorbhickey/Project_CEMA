import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// In CI, DATABASE_URL is injected as an env var. Locally (where no shell
// export is done), load it from apps/web/.env.local. The dotenv config()
// call is a no-op when the var is already set.
if (!process.env.DATABASE_URL) {
  config({ path: '../../apps/web/.env.local' });
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required (set env var or add to apps/web/.env.local)');
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
