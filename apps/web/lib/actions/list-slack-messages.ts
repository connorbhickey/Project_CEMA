import { getCurrentOrganizationId } from '@cema/auth';
import { communications, getDb, organizations, slackMessages } from '@cema/db';
import { and, desc, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Communication = typeof communications.$inferSelect;
type SlackMessage = typeof slackMessages.$inferSelect;

export interface SlackMessageRow {
  communication: Communication;
  slackMessage: SlackMessage | null;
}

export async function listSlackMessages(dealId: string): Promise<SlackMessageRow[]> {
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
      .leftJoin(slackMessages, eq(slackMessages.communicationId, communications.id))
      .where(and(eq(communications.dealId, dealId), eq(communications.kind, 'slack')))
      .orderBy(desc(communications.startedAt)),
  );

  return rows.map((row) => ({
    communication: row.communications,
    slackMessage: row.slack_messages,
  }));
}
