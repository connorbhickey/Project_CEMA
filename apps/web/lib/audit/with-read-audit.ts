import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { auditEventReads, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';

export type AuditReadEntityType =
  | 'communication'
  | 'document'
  | 'recording'
  | 'pii_field'
  | 'contact'
  | 'deal'
  | 'envelope';

export type AuditReadPurpose = 'view_detail' | 'list' | 'export' | 'agent' | 'admin';

export interface ReadAuditInput {
  entityType: AuditReadEntityType;
  entityId: string;
  purpose: AuditReadPurpose;
}

/**
 * Runs `fn`, then — fire-and-forget style — appends a row to
 * `audit_event_reads` so every sensitive entity access is recorded for SOC 2.
 *
 * The audit write always happens AFTER the data fetch succeeds, so a DB
 * failure in the audit path can never block the caller. If the audit insert
 * itself fails (e.g. DB down, unauthenticated context, org not yet synced),
 * the error is logged to stderr and the original result is still returned.
 *
 * Phase 1 will route the catch to Sentry / OpenTelemetry instead of stderr.
 */
export async function withReadAudit<T>(input: ReadAuditInput, fn: () => Promise<T>): Promise<T> {
  const result = await fn();

  try {
    const clerkOrgId = await getCurrentOrganizationId();
    const currentUserResult = await getCurrentUser();
    const clerkUserId =
      typeof currentUserResult === 'string' ? currentUserResult : (currentUserResult?.id ?? null);
    if (!clerkOrgId || !clerkUserId) return result;

    const db = getDb();
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.clerkOrgId, clerkOrgId),
    });
    if (!org) return result;

    const user = await db.query.users.findFirst({
      where: eq(users.clerkUserId, clerkUserId),
    });
    if (!user) return result;

    await db.insert(auditEventReads).values({
      organizationId: org.id,
      actorUserId: user.id,
      entityType: input.entityType,
      entityId: input.entityId,
      purpose: input.purpose,
    });
  } catch (e) {
    // Audit logging must not break the request. Log to stderr; Phase 1
    // will plumb Sentry/observability.
    // eslint-disable-next-line no-console
    console.error('withReadAudit: failed to write audit row', e);
  }

  return result;
}
