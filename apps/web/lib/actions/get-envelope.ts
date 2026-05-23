import { getCurrentOrganizationId } from '@cema/auth';
import { documents, docusignEnvelopes, getDb, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withReadAudit } from '../audit/with-read-audit';
import { withRls } from '../with-rls';

type Document = typeof documents.$inferSelect;
type Envelope = typeof docusignEnvelopes.$inferSelect;

export interface EnvelopeDetail {
  envelope: Envelope;
  document: Document | null;
}

export async function getEnvelope(envelopeId: string): Promise<EnvelopeDetail | null> {
  return withReadAudit(
    { entityType: 'envelope', entityId: envelopeId, purpose: 'view_detail' },
    async () => {
      const clerkOrgId = await getCurrentOrganizationId();
      const db = getDb();

      const org = await db.query.organizations.findFirst({
        where: eq(organizations.clerkOrgId, clerkOrgId),
      });
      if (!org) return null;

      const rows = await withRls(org.id, async (tx) =>
        tx
          .select()
          .from(docusignEnvelopes)
          .leftJoin(documents, eq(documents.id, docusignEnvelopes.documentId))
          .where(eq(docusignEnvelopes.id, envelopeId))
          .limit(1),
      );

      const row = rows[0];
      if (!row) return null;

      return {
        envelope: row.docusign_envelopes,
        document: row.documents,
      };
    },
  );
}
