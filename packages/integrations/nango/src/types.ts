import type { orgIntegrationConnections } from '@cema/db';
import type { InferSelectModel } from 'drizzle-orm';

export type NangoConnection = InferSelectModel<typeof orgIntegrationConnections>;

export type TelephonyProvider = NangoConnection['provider'];
export type ConnectionStatus = NangoConnection['connectionStatus'];

export interface CreateConnectionInput {
  organizationId: string;
  provider: TelephonyProvider;
  nangoConnectionId: string;
  nangoProviderConfigKey: string;
  createdById: string;
  externalAccountId?: string;
  externalAccountLabel?: string;
}

export interface ListConnectionsInput {
  organizationId: string;
}

export interface RevokeConnectionInput {
  connectionId: string;
}

export interface ConnectSessionInput {
  /** The org UUID — used as Nango's end-user ID so sessions are org-scoped. */
  organizationId: string;
  /** Human label shown in Nango dashboard (optional). */
  organizationName?: string;
  /** Which Nango provider config keys the end-user may connect. */
  allowedIntegrations: string[];
}
