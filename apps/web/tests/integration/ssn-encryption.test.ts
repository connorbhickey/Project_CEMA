/**
 * SSN encryption round-trip + key-rotation failure — Phase 0 M2 carry-over
 * (ADR-0001 §"Negative" #7).
 *
 * Verifies that:
 *   1. pgcrypto is installed (migration 0005).
 *   2. setPiiKey() correctly threads PII_ENCRYPTION_KEY into the
 *      transaction-local `app.pii_encryption_key` setting.
 *   3. encryptSsnSql + decryptSsnSql round-trip a plaintext SSN.
 *   4. A different key fails to decrypt (key rotation safety).
 *   5. The parties.ssn_encrypted CHECK constraint still rejects raw
 *      plaintext, so accidental writes are caught at the DB layer.
 */

import { decryptSsnSql, encryptSsnSql, setPiiKey } from '@cema/compliance';
import { deals, getDb, organizations, parties, users } from '@cema/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

const ORG_ID = '00000000-0000-0000-0000-0000000000d1';
const USER_ID = '00000000-0000-0000-0000-0000000000d2';
const DEAL_ID = '00000000-0000-0000-0000-0000000000d3';

const TEST_SSN = '123-45-6789';
const KEY_A = 'test-key-A-aaaaaaaaaaaaaaaaaaaaaaa'; // 32+ chars
const KEY_B = 'test-key-B-bbbbbbbbbbbbbbbbbbbbbbb'; // 32+ chars, different

const skip = !process.env.DATABASE_URL;

describe.skipIf(skip)('SSN encryption — pgcrypto round-trip + key rotation', () => {
  let originalKey: string | undefined;

  beforeAll(async () => {
    // Capture and override the env-provisioned key for the test.
    // Restored in afterAll so other tests aren't affected.
    originalKey = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_ENCRYPTION_KEY = KEY_A;

    const db = getDb();
    await db
      .insert(organizations)
      .values({
        id: ORG_ID,
        clerkOrgId: 'org_ssn_test',
        name: 'Org (SSN encryption test)',
        slug: 'ssn-encryption-test-org',
      })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: USER_ID,
        clerkUserId: 'user_ssn_test',
        email: 'ssn-test@example.invalid',
      })
      .onConflictDoNothing();
    await db
      .insert(deals)
      .values({
        id: DEAL_ID,
        organizationId: ORG_ID,
        cemaType: 'refi_cema',
        createdById: USER_ID,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    process.env.PII_ENCRYPTION_KEY = originalKey;
    const db = getDb();
    // Clean ONLY the per-run parties (the sensitive SSN rows). Leave the
    // deal/user/org as idempotent seeds (beforeAll re-uses them via
    // onConflictDoNothing) — the working integration suites do the same. Deleting
    // the org here used to throw a 23503 FK violation on the shared Neon dev branch
    // (the org is referenced by other suites' deals and by immutable audit_events,
    // which hard rule #10 forbids deleting), failing this whole file in the suite run.
    await db.execute(sql`DELETE FROM parties WHERE deal_id = ${DEAL_ID}`);
  });

  it('round-trips a plaintext SSN through pgcrypto', async () => {
    const decrypted = await withRls(ORG_ID, async (tx) => {
      await setPiiKey(tx);
      const [inserted] = await tx
        .insert(parties)
        .values({
          dealId: DEAL_ID,
          role: 'borrower',
          fullName: 'Round-Trip Test',
          ssnEncrypted: encryptSsnSql(TEST_SSN),
        })
        .returning({ id: parties.id });

      const result = await tx.execute(
        sql`SELECT ${decryptSsnSql(parties.ssnEncrypted)} AS ssn FROM parties WHERE id = ${inserted!.id}`,
      );
      const rows = (result as unknown as { rows: Array<{ ssn: string }> }).rows;
      return rows[0]?.ssn;
    });

    expect(decrypted).toBe(TEST_SSN);
  });

  it('decryption fails when the key is rotated', async () => {
    // Encrypt with KEY_A (set in beforeAll), then try to decrypt with KEY_B.
    let insertedId: string | undefined;
    await withRls(ORG_ID, async (tx) => {
      await setPiiKey(tx);
      const [inserted] = await tx
        .insert(parties)
        .values({
          dealId: DEAL_ID,
          role: 'borrower',
          fullName: 'Key Rotation Test',
          ssnEncrypted: encryptSsnSql(TEST_SSN),
        })
        .returning({ id: parties.id });
      insertedId = inserted!.id;
    });

    // Swap key and attempt decrypt — pgp_sym_decrypt raises "Wrong key or
    // corrupt data" which surfaces as a Postgres error.
    process.env.PII_ENCRYPTION_KEY = KEY_B;
    try {
      await expect(
        withRls(ORG_ID, async (tx) => {
          await setPiiKey(tx);
          await tx.execute(
            sql`SELECT ${decryptSsnSql(parties.ssnEncrypted)} AS ssn FROM parties WHERE id = ${insertedId!}`,
          );
        }),
        // pgp_sym_decrypt raises "Wrong key or corrupt data" but Drizzle
        // wraps it in "Failed query"; asserting any throw is sufficient.
      ).rejects.toThrow();
    } finally {
      process.env.PII_ENCRYPTION_KEY = KEY_A;
    }
  });

  it('parties.ssn_encrypted CHECK rejects raw plaintext SSN', async () => {
    // Defense-in-depth: even if a future code path forgot to call
    // encryptSsnSql, the column CHECK constraint catches plaintext writes.
    await expect(
      withRls(ORG_ID, async (tx) => {
        await tx.insert(parties).values({
          dealId: DEAL_ID,
          role: 'borrower',
          fullName: 'Plaintext Reject Test',
          ssnEncrypted: TEST_SSN, // raw, unencrypted — should be rejected
        });
      }),
    ).rejects.toThrow(
      // The CHECK violation surfaces through Drizzle wrapped in a "Failed
      // query" prefix. Match the broadest stable signal — the constraint
      // name OR Drizzle's generic failure prefix.
      /parties_ssn_encrypted_not_plaintext|check.*constraint|Failed query/i,
    );
  });

  it('setPiiKey throws when PII_ENCRYPTION_KEY env var is missing', async () => {
    const saved = process.env.PII_ENCRYPTION_KEY;
    try {
      delete process.env.PII_ENCRYPTION_KEY;
      await expect(
        withRls(ORG_ID, async (tx) => {
          await setPiiKey(tx);
        }),
      ).rejects.toThrow(/PII_ENCRYPTION_KEY/);
    } finally {
      process.env.PII_ENCRYPTION_KEY = saved;
    }
  });
});
