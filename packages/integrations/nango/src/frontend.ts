import { getNango } from './client';
import type { ConnectSessionInput } from './types';

interface ConnectSessionResponse {
  data: { token: string };
}

/**
 * Creates a Nango Connect Session and returns a short-lived token.
 *
 * Call this server-side (RSC or Server Action) and pass the token to the
 * client component that opens the OAuth popup via @nangohq/frontend.
 *
 * Why server-side: the session is minted with the NANGO_SECRET_KEY, which
 * must never reach the browser. The session token itself is safe to expose —
 * it's scoped to a single end-user, single org, and expires in minutes.
 */
export async function createConnectSession(input: ConnectSessionInput): Promise<string> {
  const nango = getNango();
  const response = (await nango.createConnectSession({
    end_user: { id: input.organizationId, display_name: input.organizationName },
    organization: { id: input.organizationId, display_name: input.organizationName },
    allowed_integrations: input.allowedIntegrations,
  })) as ConnectSessionResponse;
  return response.data.token;
}
