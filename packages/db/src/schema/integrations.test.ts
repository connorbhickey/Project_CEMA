import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { orgIntegrationConnections } from './integrations';

describe('org_integration_connections schema', () => {
  it('captures the Nango broker metadata for a per-org integration', () => {
    const cols = Object.keys(orgIntegrationConnections);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'organizationId',
        'provider',
        'nangoConnectionId',
        'nangoProviderConfigKey',
        'externalAccountId',
        'externalAccountLabel',
        'connectionStatus',
        'lastSyncedAt',
        'lastError',
        'createdById',
        'revokedAt',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('has UNIQUE on nango_connection_id (Nango contract: globally unique)', () => {
    const config = getTableConfig(orgIntegrationConnections);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain('org_integration_connections_nango_connection_id_uidx');
  });

  it('has composite UNIQUE on (org_id, provider, external_account_id) to prevent dupes', () => {
    const config = getTableConfig(orgIntegrationConnections);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain('org_integration_connections_org_provider_external_uidx');
  });

  it('has org + status index for filtered list queries (Settings page)', () => {
    const config = getTableConfig(orgIntegrationConnections);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain('org_integration_connections_org_status_idx');
  });

  it('has CHECK that connection_status is one of the documented values', () => {
    const config = getTableConfig(orgIntegrationConnections);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('org_integration_connections_status_valid');
  });

  it('has CHECK that revoked rows have revoked_at set', () => {
    const config = getTableConfig(orgIntegrationConnections);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('org_integration_connections_revoked_at_required');
  });
});
