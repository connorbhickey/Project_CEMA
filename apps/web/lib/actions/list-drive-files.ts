import { getCurrentOrganizationId } from '@cema/auth';
import { driveFiles, getDb, organizations } from '@cema/db';
import { and, desc, eq, isNull, or } from 'drizzle-orm';

import { withRls } from '../with-rls';

type DriveFile = typeof driveFiles.$inferSelect;

export async function listDriveFiles(
  dealId: string,
  options: { includeInbox?: boolean } = {},
): Promise<DriveFile[]> {
  const { includeInbox = true } = options;
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return [];

  const filter = includeInbox
    ? or(eq(driveFiles.dealId, dealId), isNull(driveFiles.dealId))
    : eq(driveFiles.dealId, dealId);

  return withRls(org.id, async (tx) =>
    tx
      .select()
      .from(driveFiles)
      .where(and(filter, eq(driveFiles.syncStatus, 'synced')))
      .orderBy(desc(driveFiles.lastSyncedAt)),
  );
}
