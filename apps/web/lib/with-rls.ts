import { getDb } from '@cema/db';
import { sql } from 'drizzle-orm';

type Db = ReturnType<typeof getDb>;

/**
 * Wraps a callback in an RLS context: sets `app.current_organization_id`
 * for the current Postgres session via `set_config(..., true)`, then runs
 * the callback. Note: Neon HTTP driver does not support transactional
 * SET LOCAL; `set_config(..., true)` is the session-local equivalent.
 * For Phase 0 with one HTTP request = one connection, this is safe.
 */
export async function withRls<T>(organizationId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  const db = getDb();
  await db.execute(sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`);
  return fn(db);
}
