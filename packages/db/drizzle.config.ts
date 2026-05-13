import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '../../apps/web/.env.local' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required (load from apps/web/.env.local)');
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
