-- Phase 0 Month 1 Task 10: Row-Level Security policies
-- Scopes every tenant-scoped table by `app.current_organization_id` session var.
-- The TS helper `withRlsContext(orgId)` in `packages/db/src/rls.ts` sets this
-- via `SET LOCAL app.current_organization_id = '<uuid>'` at the start of every
-- request transaction.

-- Direct org-scoped tables -----------------------------------------------

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY deals_org_isolation ON deals
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE new_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY new_loans_org_isolation ON new_loans
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_events_org_isolation ON audit_events
  USING (organization_id::text = current_setting('app.current_organization_id', true));

-- Indirectly scoped via deals -------------------------------------------

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY properties_org_isolation ON properties
  USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.property_id = properties.id
        AND d.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );

ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
CREATE POLICY parties_org_isolation ON parties
  USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = parties.deal_id
        AND d.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_org_isolation ON documents
  USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = documents.deal_id
        AND d.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );

ALTER TABLE existing_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY existing_loans_org_isolation ON existing_loans
  USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = existing_loans.deal_id
        AND d.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );

ALTER TABLE attorney_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY attorney_approvals_org_isolation ON attorney_approvals
  USING (
    EXISTS (
      SELECT 1
      FROM documents doc
      JOIN deals d ON doc.deal_id = d.id
      WHERE doc.id = attorney_approvals.document_id
        AND d.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );

-- organizations, users, memberships are intentionally NOT row-level isolated.
-- These are managed by Clerk webhooks and accessed only via authenticated sessions.
-- Defense remains the application-layer Clerk org check.
--
-- servicers, servicer_cema_departments are global playbook entities, not per-tenant.
