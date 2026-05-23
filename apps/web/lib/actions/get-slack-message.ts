import { getCurrentOrganizationId } from '@cema/auth';
import { communications, getDb, organizations, slackMessages } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Communication = typeof communications.$inferSelect;
type SlackMessage = typeof slackMessages.$inferSelect;

export interface SlackMessageDetail {
  communication: Communication;
  slackMessage: SlackMessage | null;
}

export async function getSlackMessage(
  dealId: string,
  communicationId: string,
): Promise<SlackMessageDetail | null> {
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
      .leftJoin(slackMessages, eq(slackMessages.communicationId, communications.id))
      .where(and(eq(communications.id, communicationId), eq(communications.dealId, dealId)))
      .limit(1),
  );

  const row = rows[0];
  if (!row) return null;

  return { communication: row.communications, slackMessage: row.slack_messages };
}
