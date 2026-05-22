import { getCurrentOrganizationId } from '@cema/auth';
import { calendarEvents, communications, getDb, organizations } from '@cema/db';
import { and, eq } from 'drizzle-orm';

import { withRls } from '../with-rls';

type Communication = typeof communications.$inferSelect;
type CalendarEvent = typeof calendarEvents.$inferSelect;

export interface CalendarEventDetail {
  communication: Communication;
  calendarEvent: CalendarEvent | null;
}

export async function getCalendarEvent(
  dealId: string,
  communicationId: string,
): Promise<CalendarEventDetail | null> {
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
      .leftJoin(calendarEvents, eq(calendarEvents.communicationId, communications.id))
      .where(and(eq(communications.id, communicationId), eq(communications.dealId, dealId)))
      .limit(1),
  );

  const row = rows[0];
  if (!row) return null;

  return {
    communication: row.communications,
    calendarEvent: row.calendar_events,
  };
}
