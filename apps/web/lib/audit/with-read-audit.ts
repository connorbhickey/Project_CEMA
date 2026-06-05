import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { redactPii } from '@cema/compliance';
import { auditEventReads, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';

import { ERROR_IDS } from '../constants/error-ids';
import { reportSwallowedError } from '../observability/report-error';

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
 * The failure is logged PII-safe (redacted + CR/LF-stripped) under the
 * READ_AUDIT_WRITE_FAILED token AND routed through `reportSwallowedError`, which
 * attaches a PII-safe event to the active OpenTelemetry span (Sentry capture is
 * a documented DSN-gated add layered on that one seam).
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
    // Audit logging must not break the request. Redact PII (hard rule #3) +
    // strip every CR/LF (log-injection-safe) INLINE in the dataflow to
    // console.error: the quantifier-free /[\r\n]/g is the form CodeQL
    // recognizes as a js/log-injection sanitizer (it stops recognizing it once
    // the sanitizer is hidden behind a helper). The ERROR_IDS token makes the
    // line greppable and is the seam a future Sentry router keys on.
    const message = redactPii(e instanceof Error ? e.message : String(e));
    // eslint-disable-next-line no-console
    console.error(
      redactPii(
        `[${ERROR_IDS.READ_AUDIT_WRITE_FAILED}] failed to write read-audit row: ${message}`,
      ).replace(/[\r\n]/g, ' '),
    );
    reportSwallowedError(ERROR_IDS.READ_AUDIT_WRITE_FAILED, message, {
      entityType: input.entityType,
      purpose: input.purpose,
    });
  }

  return result;
}
