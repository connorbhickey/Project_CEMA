import { auth, currentUser } from '@clerk/nextjs/server';

import { resolveOrganizationId } from './tenant.js';

export async function getCurrentUser() {
  return await currentUser();
}

export async function getCurrentOrganizationId(): Promise<string> {
  const { userId, orgId } = await auth();
  return resolveOrganizationId({ userId: userId ?? undefined, orgId: orgId ?? undefined });
}

export { auth };
