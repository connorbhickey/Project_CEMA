-- M2 Task 6: Row-Level Security policies on telephony tables.
--
-- Mirrors the 0001_rls.sql pattern from M1: direct organization_id equality
-- for tables that carry the column, EXISTS-via-join for tables that don't.
-- Every policy reads `app.current_organization_id` set by withRls (see
-- apps/web/lib/with-rls.ts -- the M1 carry-over from PR #30 made this real
-- by swapping the driver to neon-serverless and downgrading to
-- cema_app_user inside a transaction so RLS actually applies).
--
-- Why this migration is hand-written ------------------------------------
--
-- drizzle-kit generate cannot produce these policies safely. The Drizzle
-- snapshot is frozen at 0001 (subsequent migrations 0002-0005 + my
-- M2-task-2-onward additions never declared RLS in the TS schema), so
-- db:generate would attempt to DISABLE RLS on the M1 tables and DROP all
-- their policies. The deeper fix is the spawned follow-up "Declare RLS
-- policies + roles in TS via Drizzle pgPolicy/pgRole APIs" -- until that
-- lands, RLS-mutating migrations are hand-crafted.
--
-- Default privileges -----------------------------------------------------
--
-- ALTER DEFAULT PRIVILEGES from 0002_app_role.sql already grants
-- cema_app_user SELECT, INSERT, UPDATE, DELETE on every table created by
-- neondb_owner (the role that runs migrations) in schema public, so the
-- communications, recordings, and org_integration_connections tables
-- already have the right grants without an explicit GRANT statement here.
-- If Task 25's cross-org isolation integration test ever surfaces a
-- permission-denied error against cema_app_user, this is the file to add
-- explicit GRANTs in.

-- Direct org-scoped tables --------------------------------------------

ALTER TABLE communications ENABLE ROW LEVEL SECURITY;
CREATE POLICY communications_org_isolation ON communications
  USING (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE org_integration_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_integration_connections_org_isolation ON org_integration_connections
  USING (organization_id::text = current_setting('app.current_organization_id', true));

-- Indirectly scoped via communications --------------------------------

ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
CREATE POLICY recordings_org_isolation ON recordings
  USING (
    EXISTS (
      SELECT 1 FROM communications c
      WHERE c.id = recordings.communication_id
        AND c.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );
