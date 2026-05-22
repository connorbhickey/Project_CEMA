import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { telephonyProviderEnum } from './enums';
import { organizations, users } from './tenants';

// ---------------------------------------------------------------------------
// org_integration_connections — one row per (org, vendor) Nango connection.
//
// Token material (OAuth access + refresh) lives in Nango's vault, not our DB:
// CLAUDE.md hard rule #1 (no secrets) is thus structurally enforced. This
// table stores only the Nango `connection_id` (Nango's join key into the
// vault) plus enough surface metadata to render the Settings UI.
//
// Provider enum is the same `telephony_provider` enum that `communications`
// uses. M3 (email + calendar) will likely promote this to a shared
// `integration_provider` enum or split into multiple kind-specific enums --
// decision deferred to that month per M2 plan section 9 open question 3.
// ---------------------------------------------------------------------------
export const orgIntegrationConnections = pgTable(
  'org_integration_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    provider: telephonyProviderEnum('provider').notNull(),
    // Nango's globally-unique connection key. Used as the lookup from
    // inbound vendor webhook payloads to resolve organization_id.
    nangoConnectionId: varchar('nango_connection_id', { length: 128 }).notNull(),
    // The Nango "provider config key" identifies WHICH OAuth app config
    // in Nango's dashboard handled this connection. Today values are:
    // 'ringcentral', 'dialpad', 'zoom-phone'. Stored separately from
    // `provider` because Nango's slug uses hyphens and we want one source
    // of truth for the wire-format key when calling Nango APIs.
    nangoProviderConfigKey: varchar('nango_provider_config_key', { length: 64 }).notNull(),
    // The vendor's own account/extension id, populated after the OAuth
    // dance completes and we call the vendor's "whoami" endpoint. Nullable
    // because pre-handshake rows exist briefly. Used for the composite
    // UNIQUE below so a single org can't accidentally re-link the same
    // external account twice.
    externalAccountId: varchar('external_account_id', { length: 128 }),
    // Human-readable label rendered in the Settings UI (e.g. "RingCentral
    // — Main NY office"). Free text; processor sets via UI.
    externalAccountLabel: text('external_account_label'),
    // Lifecycle: 'pending' (row created, OAuth in progress) -> 'active'
    // (post-handshake, accepting webhooks) -> 'error' (auth failure /
    // vendor outage) -> 'revoked' (processor disconnected). CHECK below
    // restricts to this set so an app bug can't write a bogus status.
    connectionStatus: varchar('connection_status', { length: 32 }).notNull().default('pending'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // Set when status flips to 'revoked'. Paired with the CHECK below
    // (revoked rows must have a timestamp) so the audit trail of "when
    // was this disconnected" is unambiguous.
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    // Nango contract: connection_ids are globally unique across all
    // tenants/providers, so a UNIQUE here lets webhook handlers do an
    // efficient single-column lookup to resolve organization_id.
    uniqueIndex('org_integration_connections_nango_connection_id_uidx').on(t.nangoConnectionId),
    // Prevent the same org from connecting the same external account
    // twice (a UI bug or double-click could otherwise create stale
    // duplicates). NULL external_account_id is allowed multiple times
    // because Postgres UNIQUE permits multiple NULLs by default.
    uniqueIndex('org_integration_connections_org_provider_external_uidx').on(
      t.organizationId,
      t.provider,
      t.externalAccountId,
    ),
    // Settings page lists active connections per org; this composite
    // index covers the WHERE org_id = ? AND status = ? query path.
    index('org_integration_connections_org_status_idx').on(t.organizationId, t.connectionStatus),
    // FK indexes -- Postgres does NOT auto-create.
    index('org_integration_connections_organization_id_idx').on(t.organizationId),
    index('org_integration_connections_created_by_id_idx').on(t.createdById),
    // Defense in depth: an application bug could try to set a status
    // outside the documented set. The DB rejects.
    check(
      'org_integration_connections_status_valid',
      sql`${t.connectionStatus} IN ('pending', 'active', 'error', 'revoked')`,
    ),
    // Audit-trail invariant: if a connection is revoked, the moment of
    // revocation must be recorded. Conversely, non-revoked rows must
    // have NULL revoked_at (so the timestamp is unambiguous evidence
    // and not "from a prior lifecycle").
    check(
      'org_integration_connections_revoked_at_required',
      sql`(${t.connectionStatus} = 'revoked' AND ${t.revokedAt} IS NOT NULL) OR (${t.connectionStatus} <> 'revoked' AND ${t.revokedAt} IS NULL)`,
    ),
  ],
);
