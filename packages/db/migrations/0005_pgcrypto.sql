-- Migration 0005 — Enable pgcrypto for SSN encryption
--
-- Background: ADR-0001 §"Negative / accepted trade-offs" #7 documented that
-- the `parties.ssn_encrypted` column exists with a CHECK constraint
-- rejecting plaintext SSN patterns, but no actual encrypt/decrypt path was
-- implemented. CLAUDE.md hard rule #3 (PII at rest) and spec §12.1 require
-- pgcrypto-based encryption.
--
-- This migration is the DB-side prerequisite for `packages/compliance/src/ssn.ts`
-- helpers which wrap pgp_sym_encrypt / pgp_sym_decrypt. The encryption key
-- is provisioned per-transaction via `setPiiKey(tx)` reading from the
-- PII_ENCRYPTION_KEY env var — see `apps/web/tests/integration/ssn-encryption.test.ts`
-- for the round-trip proof.
--
-- pgcrypto ships with Postgres core; CREATE EXTENSION is a metadata op.
-- It's idempotent (IF NOT EXISTS) so re-running this migration is safe.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
