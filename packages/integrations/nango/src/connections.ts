import { type DbOrTx, orgIntegrationConnections } from '@cema/db';
import { eq } from 'drizzle-orm';

import type {
  CreateConnectionInput,
  ListConnectionsInput,
  NangoConnection,
  RevokeConnectionInput,
} from './types';

export async function createConnection(
  db: DbOrTx,
  input: CreateConnectionInput,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(orgIntegrationConnections)
    .values({
      organizationId: input.organizationId,
      provider: input.provider,
      nangoConnectionId: input.nangoConnectionId,
      nangoProviderConfigKey: input.nangoProviderConfigKey,
      createdById: input.createdById,
      externalAccountId: input.externalAccountId,
      externalAccountLabel: input.externalAccountLabel,
      connectionStatus: 'pending',
    })
    .returning({ id: orgIntegrationConnections.id });

  if (!row) throw new Error('createConnection: insert returned no rows');
  return { id: row.id };
}

export async function listConnections(
  db: DbOrTx,
  input: ListConnectionsInput,
): Promise<NangoConnection[]> {
  return db
    .select()
    .from(orgIntegrationConnections)
    .where(eq(orgIntegrationConnections.organizationId, input.organizationId));
}

export async function revokeConnection(db: DbOrTx, input: RevokeConnectionInput): Promise<void> {
  await db
    .update(orgIntegrationConnections)
    .set({ connectionStatus: 'revoked', revokedAt: new Date() })
    .where(eq(orgIntegrationConnections.id, input.connectionId));
}
