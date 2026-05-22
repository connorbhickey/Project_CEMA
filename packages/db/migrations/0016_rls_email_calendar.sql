-- M3 Task 4: Row-Level Security policies on email + calendar tables.
--
-- Same pattern as 0011_rls_telephony.sql: direct organization_id equality
-- for tables that carry the column, EXISTS-via-join through communications
-- for tables that don't. Default privileges from 0002_app_role.sql already
-- grant cema_app_user SELECT/INSERT/UPDATE/DELETE on every public.* table
-- created by neondb_owner, so no explicit GRANTs are needed here.
--
-- Hand-written for the same reason 0011 was: drizzle-kit generate cannot
-- safely produce RLS DDL because the Drizzle snapshot does not track
-- pgPolicy declarations from the TS schema. RLS-mutating migrations stay
-- hand-crafted until the "declare RLS in TS" follow-up lands.

-- Direct org-scoped table --------------------------------------------

ALTER TABLE org_nylas_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_nylas_connections_org_isolation ON org_nylas_connections
  USING (organization_id::text = current_setting('app.current_organization_id', true));

-- Indirectly scoped via communications -------------------------------

ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_threads_org_isolation ON email_threads
  USING (
    EXISTS (
      SELECT 1 FROM communications c
      WHERE c.id = email_threads.communication_id
        AND c.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_events_org_isolation ON calendar_events
  USING (
    EXISTS (
      SELECT 1 FROM communications c
      WHERE c.id = calendar_events.communication_id
        AND c.organization_id::text = current_setting('app.current_organization_id', true)
    )
  );
