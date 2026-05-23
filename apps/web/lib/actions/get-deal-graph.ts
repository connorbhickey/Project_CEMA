'use server';

import { getCurrentOrganizationId } from '@cema/auth';
import { getDb } from '@cema/db';
import { traverse, type TraversalNode } from '@cema/kg';

import { withRls } from '../with-rls';

export interface DealGraphResult {
  dealId: string;
  nodes: TraversalNode[];
}

export async function getDealGraph(dealId: string): Promise<DealGraphResult> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not found');

  const nodes = await withRls(org.id, (tx) =>
    traverse(tx as never, {
      organizationId: org.id,
      startId: dealId,
      startType: 'deal',
      maxDepth: 4,
    }),
  );

  return { dealId, nodes };
}
