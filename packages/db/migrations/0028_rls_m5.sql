-- Migration 0028 — M5 Task 30: RLS policies for new M5 tables.
--
-- Hand-written for the same reason 0011, 0016, 0023 were: Drizzle's
-- built-in policy generator does not support our dynamic
-- current_setting('app.current_organization_id') pattern. The RLS
-- policies here match the established convention across the codebase.
--
-- Tables covered:
--   document_review_queue  (M5 task 13 — added in migration 0026)
--   audit_event_reads      (M5 task 20 — added in migration 0027)

ALTER TABLE document_review_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_review_queue_org_isolation ON document_review_queue
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE audit_event_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_event_reads_org_isolation ON audit_event_reads
  USING (organization_id::text = current_setting('app.current_organization_id', true));
