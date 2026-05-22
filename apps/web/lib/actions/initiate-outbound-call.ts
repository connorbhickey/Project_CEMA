'use server';

import { getCurrentOrganizationId, getCurrentUser } from '@cema/auth';
import { emitAuditEvent } from '@cema/compliance';
import { communications, organizations, parties, users, getDb } from '@cema/db';
import { initiateOutboundCall as twilioInitiate } from '@cema/integrations-twilio';
import { eq } from 'drizzle-orm';

import { dncGuard } from '../compliance/dnc-guard';
import { tcpaGuard } from '../compliance/tcpa-guard';
import { withRls } from '../with-rls';

export interface InitiateOutboundCallInput {
  dealId: string;
  partyId: string;
}

export async function initiateOutboundCall(
  input: InitiateOutboundCallInput,
): Promise<{ communicationId: string }> {
  const clerkOrgId = await getCurrentOrganizationId();
  const clerkUser = await getCurrentUser();
  if (!clerkUser) throw new Error('Not authenticated');

  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) throw new Error('Organization not synced yet');

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUser.id),
  });
  if (!user) throw new Error('User not synced yet');

  const fromE164 = process.env.TWILIO_PHONE_NUMBER;
  if (!fromE164) throw new Error('TWILIO_PHONE_NUMBER environment variable is required');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const statusCallbackUrl = `${appUrl}/api/webhooks/twilio`;

  // Phase 1: validate party, run compliance guards, pre-create the communications row
  const { communicationId, toE164 } = await withRls(org.id, async (tx) => {
    const [party] = await tx.select().from(parties).where(eq(parties.id, input.partyId)).limit(1);

    if (!party) throw new Error(`Party ${input.partyId} not found`);
    if (!party.phone) throw new Error(`Party ${input.partyId} has no phone number`);

    // Hard rule #4: TCPA guard — throws TcpaConsentMissingError for borrowers without consent
    tcpaGuard(party);
    // Hard rule: DNC stub (Phase 3 — currently a no-op)
    await dncGuard(party);

    const [comm] = await tx
      .insert(communications)
      .values({
        organizationId: org.id,
        dealId: input.dealId,
        kind: 'call',
        direction: 'outbound',
        medium: 'phone_softphone',
        provider: 'twilio',
        fromE164,
        toE164: party.phone,
        status: 'pending',
      })
      .returning();

    await emitAuditEvent(tx, {
      organizationId: org.id,
      actorUserId: user.id,
      action: 'communication.outbound.initiated',
      entityType: 'communication',
      entityId: comm!.id,
      metadata: { partyId: input.partyId, dealId: input.dealId },
    });

    return { communicationId: comm!.id, toE164: party.phone };
  });

  // Phase 2: place the Twilio call — outside the DB transaction to avoid holding connections
  const twimlUrl = `${appUrl}/api/twiml/outbound/${communicationId}`;
  const { callSid } = await twilioInitiate({
    toE164,
    fromE164,
    twimlUrl,
    statusCallbackUrl,
  });

  // Phase 3: persist the Twilio CallSid and emit the recording-consent audit event
  await withRls(org.id, async (tx) => {
    await tx
      .update(communications)
      .set({ vendorCallId: callSid })
      .where(eq(communications.id, communicationId));

    await emitAuditEvent(tx, {
      organizationId: org.id,
      actorUserId: user.id,
      action: 'compliance.consent.disclosed',
      entityType: 'communication',
      entityId: communicationId,
      metadata: { callSid, disclosureType: 'ny_two_party_recording' },
    });
  });

  return { communicationId };
}
