-- Migration 0003 — Audit-log immutability triggers
--
-- Background: ADR-0001 §"Negative / accepted trade-offs" #2 documented that
-- `audit_events` and `attorney_approvals` are append-only by convention only.
-- CLAUDE.md hard rule §10.5 elevates immutability to a non-negotiable —
-- tampering with the audit log is an automatic incident. Without DB-level
-- enforcement, a bug or direct DB query could silently UPDATE or DELETE rows.
--
-- This migration adds BEFORE-row triggers that RAISE EXCEPTION on any
-- UPDATE or DELETE attempt against either table. The triggers fire before
-- the row is touched, so no partial mutation is possible.
--
-- Note: even `neondb_owner` (BYPASSRLS=true) is blocked by these triggers —
-- only explicit DROP TRIGGER (or ALTER TABLE … DISABLE TRIGGER) would
-- re-enable mutation. That's intentional: there is no legitimate
-- application path that needs to mutate these tables.

CREATE OR REPLACE FUNCTION reject_mutation_on_immutable_table()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; UPDATE/DELETE blocked', TG_TABLE_NAME
    USING
      HINT = 'This is an immutable audit table. Create a new row instead of mutating an existing one.',
      ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation_on_immutable_table();

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation_on_immutable_table();

CREATE TRIGGER attorney_approvals_no_update
  BEFORE UPDATE ON attorney_approvals
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation_on_immutable_table();

CREATE TRIGGER attorney_approvals_no_delete
  BEFORE DELETE ON attorney_approvals
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation_on_immutable_table();
