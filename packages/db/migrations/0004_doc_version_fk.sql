-- Migration 0004 — Composite FK attorney_approvals → documents(id, version)
--
-- Background: ADR-0001 §"Negative / accepted trade-offs" #3 documented that
-- `attorney_approvals.document_version` snapshots the document version at
-- approval time but had no FK guaranteeing that version actually exists on
-- the document. An approval pointing to version 3 of a document that only
-- has versions 1–2 would be caught only at the application layer.
--
-- This migration:
--   1. Adds UNIQUE (id, version) on `documents`. The existing PRIMARY KEY
--      is unique on (id) alone — composite FKs require a unique constraint
--      on the targeted column set.
--   2. Adds a composite FK from attorney_approvals (document_id,
--      document_version) → documents (id, version).
--
-- ON DELETE CASCADE matches the existing single-column FK on document_id.
-- ON UPDATE CASCADE so approvals follow if a document version is renumbered
-- during a data backfill (rare, but the cascade is cheap).
--
-- Pre-migration invariant: any existing attorney_approvals rows must point
-- to existing (document_id, document_version) pairs in documents. If a
-- stray approval exists with an invalid pair, this migration will fail
-- — that is intentional, the failure surfaces a real data-integrity bug
-- rather than silently dropping the constraint.

ALTER TABLE documents
  ADD CONSTRAINT documents_id_version_unique
  UNIQUE (id, version);

ALTER TABLE attorney_approvals
  ADD CONSTRAINT attorney_approvals_doc_version_fkey
  FOREIGN KEY (document_id, document_version)
  REFERENCES documents (id, version)
  ON DELETE CASCADE
  ON UPDATE CASCADE;
