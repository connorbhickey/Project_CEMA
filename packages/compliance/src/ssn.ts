import type { Transaction } from '@cema/db';
import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * SSN encryption — Phase 0 M2 carry-over (ADR-0001 §"Negative" #7).
 *
 * Posture:
 *   • Symmetric encryption via pgcrypto's pgp_sym_encrypt / pgp_sym_decrypt.
 *     pgcrypto is enabled by migration 0005_pgcrypto.sql.
 *   • One env-provisioned key (PII_ENCRYPTION_KEY) for Phase 0 & 1.
 *     Customer-managed keys (per-tenant, KMS-backed) remain Phase 2 per
 *     spec §12.1.
 *   • Key threading mirrors withRls: `setPiiKey(tx)` issues
 *     `SET LOCAL app.pii_encryption_key = …` inside a transaction so the
 *     setting auto-resets at COMMIT/ROLLBACK and can't leak across requests.
 *
 * Caller contract:
 *   await withRls(orgId, async (tx) => {
 *     await setPiiKey(tx);
 *     await tx.insert(parties).values({
 *       …,
 *       ssnEncrypted: encryptSsnSql('123-45-6789'),
 *     });
 *     const rows = await tx.execute(sql`
 *       SELECT id, ${decryptSsnSql(parties.ssnEncrypted)} AS ssn
 *       FROM parties WHERE id = ${partyId}
 *     `);
 *   });
 *
 * If `setPiiKey` is not called before encrypt/decrypt SQL runs, Postgres
 * raises "unrecognized configuration parameter" — fail-loud, not silent
 * data corruption. The CHECK constraint on parties.ssn_encrypted continues
 * to reject any value matching the SSN regex, so pgcrypto's base64
 * ciphertext (no `\d{3}-?\d{2}-?\d{4}$` match) passes the check while
 * accidental plaintext writes are still rejected.
 */

const MIN_KEY_LENGTH = 32;

/**
 * Sets the per-transaction PII encryption key from `process.env.PII_ENCRYPTION_KEY`.
 * Must be called inside an open Postgres transaction (the SET LOCAL only
 * applies inside one); calling it from a non-transactional context is a
 * silent no-op and any subsequent encrypt/decrypt will raise on missing
 * config — that's the intended fail-loud behavior.
 *
 * Throws synchronously (before opening a tx side-effect) if the env var
 * is unset or shorter than 32 chars. pgp_sym_encrypt accepts shorter
 * keys but 32 chars is the floor for credible AES-derived strength.
 */
export async function setPiiKey(tx: Transaction): Promise<void> {
  const key = process.env.PII_ENCRYPTION_KEY;
  if (!key || key.length < MIN_KEY_LENGTH) {
    throw new Error(
      `PII_ENCRYPTION_KEY env var must be set and at least ${MIN_KEY_LENGTH} chars. ` +
        'Configure in Vercel env (per-environment) or apps/web/.env.local for dev.',
    );
  }
  await tx.execute(sql`SELECT set_config('app.pii_encryption_key', ${key}, true)`);
}

/**
 * Returns a Drizzle SQL fragment that encrypts the given plaintext SSN
 * using pgp_sym_encrypt and base64-encodes the result. The output is
 * text-storable and bypasses the parties.ssn_encrypted CHECK constraint
 * (which rejects SSN-shaped plaintext).
 *
 * The key is pulled from `current_setting('app.pii_encryption_key')` —
 * if `setPiiKey(tx)` hasn't run, Postgres raises immediately rather
 * than encrypting with an empty key (which would silently corrupt data).
 *
 * Use in INSERT/UPDATE statements:
 *   tx.insert(parties).values({ …, ssnEncrypted: encryptSsnSql(ssn) })
 */
export function encryptSsnSql(plaintext: string): SQL {
  return sql`encode(pgp_sym_encrypt(${plaintext}, current_setting('app.pii_encryption_key')), 'base64')`;
}

/**
 * Returns a Drizzle SQL fragment that decrypts a base64-encoded
 * pgcrypto-encrypted SSN column. Pairs with `encryptSsnSql`.
 *
 * Use in SELECT lists:
 *   tx.execute(sql`SELECT ${decryptSsnSql(parties.ssnEncrypted)} AS ssn FROM …`)
 *
 * If the key in the current transaction differs from the one used at
 * encrypt time, pgp_sym_decrypt raises "Wrong key or corrupt data" —
 * the test suite asserts this key-rotation failure mode explicitly.
 */
export function decryptSsnSql(column: PgColumn | SQL): SQL {
  return sql`pgp_sym_decrypt(decode(${column}, 'base64'), current_setting('app.pii_encryption_key'))`;
}
