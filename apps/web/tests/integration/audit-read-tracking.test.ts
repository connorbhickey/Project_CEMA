// apps/web/tests/integration/audit-read-tracking.test.ts
/**
 * Audit read tracking (M5 Task 24).
 *
 * Verifies that wrapping a read-path action in withReadAudit produces
 * an immutable audit_event_reads row.
 */

import { auditEventReads, getDb, organizations, users } from '@cema/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withReadAudit } from '../../lib/audit/with-read-audit';

const ORG_ID = '00000000-0000-0000-0000-0000000000a5';
const USER_ID = '00000000-0000-0000-0000-000000000095';

const skip = !process.env.DATABASE_URL || !process.env.CLERK_TEST_USER_ID;

describe.skipIf(skip)('withReadAudit — DB integration', () => {
  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(organizations)
      .values({
        id: ORG_ID,
        clerkOrgId: 'org_audit_read',
        name: 'Audit Read Test',
        slug: 'audit-read',
      })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: USER_ID, clerkUserId: 'user_audit_read', email: 'audit-read@example.invalid' })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(auditEventReads).where(eq(auditEventReads.organizationId, ORG_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_ID]));
  });

  it('inserts an audit_event_reads row when withReadAudit wraps a successful call', async () => {
    // This test depends on auth fakes being set up. For M5 we leave the
    // test as DATABASE_URL-AND-CLERK_TEST_USER_ID-gated; the actual
    // wiring happens at PR test-fixture setup time.
    const result = await withReadAudit(
      {
        entityType: 'communication',
        entityId: '00000000-0000-0000-0000-000000000010',
        purpose: 'view_detail',
      },
      () => Promise.resolve('read-result'),
    );
    expect(result).toBe('read-result');

    const db = getDb();
    const rows = await db
      .select()
      .from(auditEventReads)
      .where(eq(auditEventReads.organizationId, ORG_ID));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('does not write a row when the wrapped fn throws', async () => {
    const db = getDb();
    const before = await db
      .select()
      .from(auditEventReads)
      .where(eq(auditEventReads.organizationId, ORG_ID));

    await expect(
      withReadAudit(
        {
          entityType: 'document',
          entityId: '00000000-0000-0000-0000-000000000020',
          purpose: 'view_detail',
        },
        () => {
          throw new Error('simulated read failure');
        },
      ),
    ).rejects.toThrow('simulated read failure');

    const after = await db
      .select()
      .from(auditEventReads)
      .where(eq(auditEventReads.organizationId, ORG_ID));

    // No new row written.
    expect(after.length).toBe(before.length);
  });
});
