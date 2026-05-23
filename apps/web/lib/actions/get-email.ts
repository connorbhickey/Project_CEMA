import { getCurrentOrganizationId } from '@cema/auth';
import { communications, emailThreads, getDb, organizations } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { withReadAudit } from '../audit/with-read-audit';
import { withRls } from '../with-rls';

type Communication = typeof communications.$inferSelect;
type EmailThread = typeof emailThreads.$inferSelect;

export interface EmailDetail {
  communication: Communication;
  emailThread: EmailThread | null;
}

export async function getEmail(
  dealId: string,
  communicationId: string,
): Promise<EmailDetail | null> {
  return withReadAudit(
    { entityType: 'communication', entityId: communicationId, purpose: 'view_detail' },
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
          .from(communications)
          .leftJoin(emailThreads, eq(emailThreads.communicationId, communications.id))
          .where(and(eq(communications.id, communicationId), eq(communications.dealId, dealId)))
          .limit(1),
      );

      const row = rows[0];
      if (!row) return null;

      return {
        communication: row.communications,
        emailThread: row.email_threads,
      };
    },
  );
}
