-- Phase 0 Month 2 Carry-over: provision the cema_app_user role used by withRls.
--
-- Why this exists ---------------------------------------------------------
-- The production app's DATABASE_URL authenticates as `neondb_owner`, which
-- Neon provisions with BYPASSRLS=true. That means RLS policies defined in
-- 0001_rls.sql never actually applied at runtime, regardless of whether
-- `app.current_organization_id` was set.
--
-- We do NOT change the connection role itself (Neon manages neondb_owner
-- as the project owner). Instead, every transaction that needs to enforce
-- RLS issues `SET LOCAL ROLE cema_app_user`, downgrading the session to a
-- non-BYPASSRLS role for the duration of that transaction. SET LOCAL
-- automatically resets at transaction end (COMMIT / ROLLBACK), so other
-- code paths (Clerk webhook sync, audit log, migrations) that legitimately
-- need owner privileges remain unaffected.
--
-- See apps/web/lib/with-rls.ts for the runtime wrapper.

-- 1. The role itself ------------------------------------------------------
--
-- NOLOGIN: this role is reached only via `SET LOCAL ROLE`, never via direct
-- connection. Removing the login attribute closes a class of misuse where a
-- forgotten password ends up in an env var. Postgres defaults new roles to
-- NOBYPASSRLS, which is exactly what we want.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cema_app_user') THEN
    CREATE ROLE cema_app_user NOLOGIN;
  END IF;
END $$;

-- 2. Table / sequence privileges -----------------------------------------
--
-- The app role needs CRUD on tenant tables (RLS does the row filtering)
-- and USAGE on sequences for default-random UUID columns and any future
-- bigserial columns. GRANT is idempotent — re-running this migration on
-- preview branches is a no-op after the first time.
GRANT USAGE ON SCHEMA public TO cema_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cema_app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO cema_app_user;

-- 3. Future-proofing ------------------------------------------------------
--
-- Any new table or sequence added by a future migration must auto-inherit
-- the same grants, or we'll silently break when an unrelated schema change
-- ships. ALTER DEFAULT PRIVILEGES is idempotent for the same grantee.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cema_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO cema_app_user;

-- 4. Membership -----------------------------------------------------------
--
-- neondb_owner must be a member of cema_app_user to be allowed to
-- `SET LOCAL ROLE cema_app_user` — Postgres requires either superuser status
-- or membership of the target role for SET ROLE. Without this GRANT we'd
-- get "permission denied to set role" at runtime.
GRANT cema_app_user TO neondb_owner;
