import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

import * as schema from './schema/index';

/**
 * Builds the Drizzle client on first use. We use the WebSocket-backed Pool
 * (not neon-http) because RLS enforcement in `apps/web/lib/with-rls.ts`
 * needs real Postgres transactions that persist `SET LOCAL ROLE` and
 * `SET LOCAL app.current_organization_id` across multiple queries inside
 * one callback. The neon-http driver makes each query its own implicit
 * transaction, which discards SET LOCAL settings between queries.
 *
 * Node 22+ ships WebSocket globally, so neonConfig.webSocketConstructor is
 * not required (verified against @neondatabase/serverless 0.10 docs).
 *
 * No edge-runtime routes exist in apps/web today (`runtime = 'edge'` greps
 * empty). If any are added later, that route MUST stay on neon-http or
 * implement an edge-compatible WebSocket polyfill — the Pool driver
 * relies on global WebSocket which behaves differently in the Edge runtime.
 */
function createDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle({ client: pool, schema });
}

let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

export type Database = ReturnType<typeof createDb>;

/**
 * The transaction handle Drizzle's neon-serverless adapter hands to a
 * `db.transaction()` callback. We surface it as a public type because
 * helpers like `emitAuditEvent` need to accept *either* the top-level
 * `Database` (outside any transaction) or a `Transaction` (inside `withRls`).
 *
 * Extracted via `Parameters<...>` so it stays in lockstep with the driver
 * version without manually importing internal Drizzle paths.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Either the top-level Database or a transaction handle from db.transaction(). */
export type DbOrTx = Database | Transaction;
