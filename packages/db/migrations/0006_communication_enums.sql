-- M2 Task 2: Communication entity enums (spec §6.5)
--
-- Created in this migration so subsequent M2 schema migrations (0007 communications,
-- 0008 integration_connections) can reference these types without a snapshot-drift
-- workaround. See `packages/db/src/schema/enums.ts` for the corresponding TypeScript
-- pgEnum declarations.
--
-- IMPORTANT: drizzle-kit's auto-generated SQL for this migration also included
-- destructive operations (ALTER TABLE … DISABLE ROW LEVEL SECURITY on every
-- tenant-scoped table, DROP POLICY for every RLS policy, and a duplicate
-- doc-version FK ADD) because the Drizzle snapshot is frozen at migration 0001
-- and has no record of the hand-written migrations 0002-0005 (cema_app_user role,
-- audit immutability triggers, doc_version composite FK, pgcrypto). Those
-- destructive statements were stripped manually; this file contains only the
-- five safe CREATE TYPE statements. A follow-up task will regenerate the
-- Drizzle snapshot via `drizzle-kit introspect` so future db:generate runs are
-- clean.

CREATE TYPE "public"."communication_kind" AS ENUM('call', 'email', 'sms', 'slack', 'teams', 'meeting', 'letter', 'fax');--> statement-breakpoint
CREATE TYPE "public"."communication_direction" AS ENUM('inbound', 'outbound', 'internal');--> statement-breakpoint
CREATE TYPE "public"."communication_medium" AS ENUM('phone_landline', 'phone_softphone', 'gmail', 'm365', 'slack', 'teams', 'sms_twilio', 'webrtc', 'other');--> statement-breakpoint
CREATE TYPE "public"."telephony_provider" AS ENUM('ringcentral', 'dialpad', 'zoom_phone', 'twilio', 'manual_upload');--> statement-breakpoint
CREATE TYPE "public"."communication_status" AS ENUM('pending', 'ingested', 'transcribing', 'ready', 'failed');
