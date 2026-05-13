import { getDb, type Database } from '@cema/db';
import { sql } from 'drizzle-orm';

/**
 * The transaction handle passed to a withRls callback. Drizzle's
 * neon-serverless adapter exposes its transaction type via
 * Parameters<Database['transaction']>; extracting it that way keeps
 * us aligned with the driver instead of hand-rolling a shape.
 */
type RlsTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * UUID v1–v8 shape. Matches the canonical 8-4-4-4-12 hex layout.
 * Validated before opening the transaction so a bad input never
 * reaches `set_config` (defense-in-depth — drizzle's `${value}`
 * parameter binding already prevents injection, but a typo in
 * caller code shouldn't open a tx and burn a connection).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Drizzle's tx.execute() returns a result object whose runtime shape varies
 * by driver. For neon-serverless it has a `rows` array of plain objects.
 * We dig out the first row's `rolbypassrls` column to assert the SET LOCAL
 * ROLE actually downgraded us.
 */
interface PgRolesProbeRow {
  rolbypassrls?: boolean;
}
function extractBypassRls(result: unknown): boolean {
  // Neon-serverless: result has shape { rows: Array<{ rolbypassrls: boolean }>, ... }
  if (
    result &&
    typeof result === 'object' &&
    'rows' in result &&
    Array.isArray((result as { rows: unknown[] }).rows)
  ) {
    const rows = (result as { rows: PgRolesProbeRow[] }).rows;
    if (rows.length > 0) {
      return rows[0]!.rolbypassrls === true;
    }
  }
  return false;
}

/**
 * Wraps a callback in an RLS-enforcing transaction.
 *
 * What this does, in order:
 *   1. Validates the organizationId as a UUID (cheap fail before TX overhead).
 *   2. Opens a real Postgres transaction via Drizzle's neon-serverless adapter.
 *      Every `tx.<query>()` inside the callback runs in this single TX, so
 *      SET LOCAL settings persist for the full duration.
 *   3. Issues `SET LOCAL ROLE cema_app_user` — downgrades from neondb_owner
 *      (BYPASSRLS=true) to cema_app_user (BYPASSRLS=false) so RLS policies
 *      actually evaluate. SET LOCAL auto-resets at TX end, so other code
 *      paths (Clerk webhooks, audit log) that need owner privileges are
 *      unaffected.
 *   4. Issues `SELECT set_config('app.current_organization_id', $1, true)`
 *      to bind the org context. The `true` third arg makes it transaction-
 *      local — also auto-resets at TX end.
 *   5. Asserts that CURRENT_USER no longer bypasses RLS. If someone strips
 *      step 3, this guard fires and aborts the TX before the callback's
 *      queries run. Defense-in-depth against well-meaning refactors.
 *   6. Runs the user callback with `tx` as the only handle to the DB. The
 *      caller MUST use `tx` — calling `getDb()` inside the callback would
 *      reach for a fresh non-RLS connection and bypass everything.
 *
 * On any thrown error the transaction rolls back; both SET LOCAL settings
 * reset automatically.
 */
export async function withRls<T>(
  organizationId: string,
  fn: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(organizationId)) {
    throw new Error(`Invalid organization id (must be UUID): ${organizationId}`);
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    // Order matters: downgrade the role first so any side effect of
    // set_config (which is a no-op as far as privileges go) and the
    // subsequent guard query both see the downgraded role.
    await tx.execute(sql`SET LOCAL ROLE cema_app_user`);
    await tx.execute(
      sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`,
    );

    // Defense-in-depth guard. If a future refactor removes the SET LOCAL
    // ROLE line above, CURRENT_USER stays as neondb_owner and the test
    // suite would silently regress. This check fires immediately and
    // surfaces the regression as a thrown error before any user query.
    const guard = await tx.execute(
      sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = CURRENT_USER`,
    );
    if (extractBypassRls(guard)) {
      throw new Error(
        'RLS guard failed: current Postgres role bypasses RLS. ' +
          'SET LOCAL ROLE cema_app_user must run before any tenant-scoped query.',
      );
    }

    return fn(tx);
  });
}
