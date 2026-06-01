'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { dealStatusEnum, deals, getDb, organizations, users } from '@cema/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { notifyInternal } from '../agents/internal-comms/notify-internal';
import { onDealStatusChanged } from '../agents/on-deal-status-changed';
import { withRls } from '../with-rls';

// ---------------------------------------------------------------------------
// transitionDealStatus — the single write path for a Deal's lifecycle status.
//
// The Deal is the central entity; its `status` drives the pipeline kanban and
// is the trigger surface for the Layer-3 agents (M14). There is deliberately
// NO transition state-machine here: the spec does not define a legal
// deal_status edge set, and inventing one risks blocking legitimate flows.
// The action simply records the change, audits it, and — only after the write
// commits — fans out to the agent dispatcher (best-effort; see
// onDealStatusChanged). A future guard can be layered on once the spec settles
// the lifecycle graph.
//
// PII-safe by construction: the only audit metadata is the {from, to} pair of
// deal_status enum values (hard rule #3) — never party names or amounts.
// ---------------------------------------------------------------------------

export type DealStatus = (typeof dealStatusEnum.enumValues)[number];

export interface TransitionDealStatusResult {
  dealId: string;
  from: DealStatus;
  to: DealStatus;
  /** false when from === to (no write and no audit were performed). */
  changed: boolean;
}

export async function transitionDealStatus(
  dealId: string,
  toStatus: DealStatus,
): Promise<TransitionDealStatusResult> {
  // System-boundary guard: a 'use server' action is an RPC endpoint reachable
  // with arbitrary client-supplied arguments, so validate the enum at runtime
  // rather than trusting the compile-time type.
  if (!dealStatusEnum.enumValues.includes(toStatus)) {
    throw new Error(`Invalid deal status: ${String(toStatus)}`);
  }

  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new Error('Not authenticated');

  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not found');

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUser.id),
  });
  if (!user) throw new Error('User not synced yet');

  const result = await withRls(org.id, async (tx) => {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    if (!deal) throw new Error('Deal not found');

    const from = deal.status;

    // No-op: nothing to write or audit when the status is unchanged. Returning
    // early keeps the audit log free of zero-delta events.
    if (from === toStatus) {
      return { dealId, from, to: toStatus, changed: false };
    }

    // deals_completed_at_required CHECK: completedAt must be non-null once the
    // deal reaches 'completed'. Set it in the same UPDATE so the write does not
    // violate the constraint.
    const patch =
      toStatus === 'completed'
        ? { status: toStatus, completedAt: new Date(), updatedAt: new Date() }
        : { status: toStatus, updatedAt: new Date() };

    await tx.update(deals).set(patch).where(eq(deals.id, dealId));

    await emitAuditEvent(tx, {
      organizationId: org.id,
      actorUserId: user.id,
      action: 'deal.status_changed',
      entityType: 'deal',
      entityId: dealId,
      metadata: { from, to: toStatus },
    });

    return { dealId, from, to: toStatus, changed: true };
  });

  if (result.changed) {
    revalidatePath('/deals');
    // Post-commit agent dispatch. onDealStatusChanged swallows its own errors,
    // so a failed agent run can never undo the (already-committed) status
    // change. Awaited in-request because the agent actions are session-backed
    // (cron/queue have no request session, and there is no durable backend
    // yet); at durable activation this becomes fire-and-forget. The org + actor
    // are threaded in so the dispatcher can record a PII-safe
    // deal.agent_dispatch_failed audit if an agent run fails.
    await onDealStatusChanged(dealId, result.to, {
      organizationId: org.id,
      actorUserId: user.id,
    });
    // Second post-commit fan-out: internal-comms notification (spec §9.10).
    // Independent of and after the agent dispatch; itself best-effort (it
    // swallows its own errors), so it can never undo the committed status write.
    await notifyInternal(dealId, result.to, {
      organizationId: org.id,
      actorUserId: user.id,
    });
  }

  return result;
}
