import { getCurrentOrganizationId } from '@cema/auth';
import { documents, docusignEnvelopes, getDb, organizations } from '@cema/db';
import { desc, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Document = typeof documents.$inferSelect;
type Envelope = typeof docusignEnvelopes.$inferSelect;

export interface EnvelopeRow {
  envelope: Envelope;
  document: Document | null;
}

export async function listEnvelopes(dealId: string): Promise<EnvelopeRow[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const rows = await withRls(org.id, async (tx) =>
    tx
      .select()
      .from(docusignEnvelopes)
      .leftJoin(documents, eq(documents.id, docusignEnvelopes.documentId))
      .where(eq(documents.dealId, dealId))
      .orderBy(desc(docusignEnvelopes.createdAt)),
  );

  return rows.map((row) => ({
    envelope: row.docusign_envelopes,
    document: row.documents,
  }));
}
