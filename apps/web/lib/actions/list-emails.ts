import { getCurrentOrganizationId } from '@cema/auth';
import { communications, emailThreads, getDb, organizations } from '@cema/db';
import { and, desc, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Communication = typeof communications.$inferSelect;
type EmailThread = typeof emailThreads.$inferSelect;

export interface EmailThreadRow {
  communication: Communication;
  emailThread: EmailThread | null;
}

export async function listEmails(dealId: string): Promise<EmailThreadRow[]> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const rows = await withRls(org.id, async (tx) =>
    tx
      .select()
      .from(communications)
      .leftJoin(emailThreads, eq(emailThreads.communicationId, communications.id))
      .where(and(eq(communications.dealId, dealId), eq(communications.kind, 'email')))
      .orderBy(desc(communications.startedAt)),
  );

  return rows.map((row) => ({
    communication: row.communications,
    emailThread: row.email_threads,
  }));
}
