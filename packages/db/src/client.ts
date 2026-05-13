import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from './schema/index.js';

let _db: ReturnType<typeof createDb> | null = null;

function createDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  const sql = neon(process.env.DATABASE_URL);
  return drizzle({ client: sql, schema });
}

export function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

export type Database = ReturnType<typeof createDb>;
