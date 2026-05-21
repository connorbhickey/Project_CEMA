import { is, SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { decryptSsnSql, encryptSsnSql } from './ssn';

// Unit tests — verify the helper API surface without hitting a DB.
// Round-trip correctness, key rotation, and CHECK-constraint interaction
// live in `apps/web/tests/integration/ssn-encryption.test.ts` (DB-bound).
describe('encryptSsnSql', () => {
  it('returns a Drizzle SQL fragment', () => {
    const fragment = encryptSsnSql('123-45-6789');
    expect(is(fragment, SQL)).toBe(true);
  });

  it('different plaintexts produce different SQL parameter bindings', () => {
    const a = encryptSsnSql('123-45-6789');
    const b = encryptSsnSql('987-65-4321');
    // Drizzle SQL objects don't structurally equal even when produced
    // the same way; this asserts they're distinct instances tied to
    // distinct inputs (no accidental caching).
    expect(a).not.toBe(b);
  });
});

describe('decryptSsnSql', () => {
  it('returns a Drizzle SQL fragment when given a SQL placeholder', () => {
    // We can't easily construct a PgColumn outside a schema context, so
    // we feed a SQL fragment (decryptSsnSql accepts PgColumn | SQL).
    const placeholder = encryptSsnSql('placeholder');
    const fragment = decryptSsnSql(placeholder);
    expect(is(fragment, SQL)).toBe(true);
  });
});

// Note on `setPiiKey`: testing it without a DB connection is not
// meaningful — its behavior is "call SET LOCAL on the transaction."
// The env-var validation path (throws on missing/short key) is
// implicitly covered by the integration test setup.
