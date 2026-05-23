-- M4 Task 29: Row-Level Security policies on all eight M4 tables.
--
-- Mirrors the patterns from 0011_rls_telephony.sql and 0016_rls_email_calendar.sql:
-- direct organization_id equality for tables that carry the column, EXISTS-via-join
-- for tables that don't. Every policy reads `app.current_organization_id` set by
-- withRls (apps/web/lib/with-rls.ts), which opens a real transaction with
-- `SET LOCAL ROLE cema_app_user` + `SET LOCAL app.current_organization_id`.
--
-- Why this migration is hand-written
--
-- drizzle-kit generate cannot produce these policies safely. The Drizzle snapshot
-- does not track pgPolicy declarations from the TS schema, so db:generate would
-- attempt to DISABLE RLS and DROP policies. The deeper fix is the spawned
-- follow-up "Declare RLS policies in TS via Drizzle pgPolicy API" — until that
-- lands, RLS-mutating migrations are hand-crafted.
--
-- Default privileges
--
-- ALTER DEFAULT PRIVILEGES from 0002_app_role.sql already grants cema_app_user
-- SELECT, INSERT, UPDATE, DELETE on every table created by neondb_owner (the
-- role that runs migrations) in schema public. No explicit GRANTs are needed here.

-- Direct org-scoped tables (7 tables) -----------------------------------

ALTER TABLE org_slack_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_slack_connections_org_isolation ON org_slack_connections
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE org_drive_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_drive_connections_org_isolation ON org_drive_connections
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE drive_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY drive_files_org_isolation ON drive_files
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE org_docusign_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_docusign_connections_org_isolation ON org_docusign_connections
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE docusign_envelopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY docusign_envelopes_org_isolation ON docusign_envelopes
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_org_isolation ON contacts
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE contact_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_identities_org_isolation ON contact_identities
  USING (organization_id::text = current_setting('app.current_organization_id', true));

-- Indirectly scoped via communications (1 table) -------------------------

ALTER TABLE slack_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY slack_messages_org_isolation ON slack_messages
  USING (
    EXISTS (
      SELECT 1 FROM communications c
      WHERE c.id = slack_messages.communication_id
        AND c.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );
