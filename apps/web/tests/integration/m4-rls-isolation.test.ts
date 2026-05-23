/**
 * RLS multi-tenant isolation for M4 tables (M4 Task 30).
 *
 * Eight tables × {Org A sees own (1 positive control), Org B does NOT see
 * Org A's row (8 negatives)} = 9 assertions total.
 *
 * Seed-data note: `documents` has dealId NOT NULL (FK → deals), so this test
 * also seeds a minimal deal row. The deal itself requires organizationId +
 * cemaType + createdById; property and newLoan are nullable and omitted.
 */

import {
  contactIdentities,
  contacts,
  deals,
  documents,
  driveFiles,
  docusignEnvelopes,
  getDb,
  orgDocusignConnections,
  orgDriveConnections,
  orgSlackConnections,
  organizations,
  slackMessages,
  users,
  communications,
} from '@cema/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withRls } from '../../lib/with-rls';

const ORG_A_ID = '00000000-0000-0000-0000-0000000000a4';
const ORG_B_ID = '00000000-0000-0000-0000-0000000000b4';
const USER_ID = '00000000-0000-0000-0000-000000000094';
const DEAL_ID = '00000000-0000-0000-0000-0000000000e4';
const DOC_ID = '00000000-0000-0000-0000-0000000000d4';

const skip = !process.env.DATABASE_URL;

let slackConnId: string;
let driveConnId: string;
let driveFileId: string;
let docusignConnId: string;
let envelopeRowId: string;
let contactRowId: string;
let identityRowId: string;
let slackCommId: string;
let slackMsgId: string;

describe.skipIf(skip)('RLS — M4 tables cross-org isolation', () => {
  beforeAll(async () => {
    const db = getDb();

    await db
      .insert(organizations)
      .values([
        { id: ORG_A_ID, clerkOrgId: 'org_m4_rls_a', name: 'Org A (M4)', slug: 'm4-rls-org-a' },
        { id: ORG_B_ID, clerkOrgId: 'org_m4_rls_b', name: 'Org B (M4)', slug: 'm4-rls-org-b' },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({ id: USER_ID, clerkUserId: 'user_m4_rls', email: 'm4-rls@example.invalid' })
      .onConflictDoNothing();

    // deals is required because documents.deal_id is NOT NULL.
    await db
      .insert(deals)
      .values({
        id: DEAL_ID,
        organizationId: ORG_A_ID,
        cemaType: 'refi_cema',
        status: 'intake',
        createdById: USER_ID,
      })
      .onConflictDoNothing();

    await db
      .insert(documents)
      .values({
        id: DOC_ID,
        dealId: DEAL_ID,
        kind: 'cema_3172',
        status: 'draft',
        attorneyReviewRequired: true,
        version: 1,
      })
      .onConflictDoNothing();

    const [slackConn] = await db
      .insert(orgSlackConnections)
      .values({
        organizationId: ORG_A_ID,
        slackTeamId: 'T-rls-test',
        slackBotToken: 'xoxb-fake-bot',
        connectionStatus: 'active',
        createdById: USER_ID,
      })
      .returning();
    slackConnId = slackConn!.id;

    const [driveConn] = await db
      .insert(orgDriveConnections)
      .values({
        organizationId: ORG_A_ID,
        googleAccountEmail: 'drive@org-a.example.invalid',
        oauthRefreshToken: 'rt',
        driveChannelId: 'ch-rls',
        driveChannelToken: 'tok-rls',
        createdById: USER_ID,
      })
      .returning();
    driveConnId = driveConn!.id;

    const [driveFile] = await db
      .insert(driveFiles)
      .values({
        organizationId: ORG_A_ID,
        driveConnectionId: driveConnId,
        driveFileId: 'file-rls-001',
        fileName: 'rls.pdf',
        mimeType: 'application/pdf',
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
      })
      .returning();
    driveFileId = driveFile!.id;

    const [docusignConn] = await db
      .insert(orgDocusignConnections)
      .values({
        organizationId: ORG_A_ID,
        docusignAccountId: 'ACCT-RLS',
        docusignBaseUrl: 'https://demo.docusign.net/restapi',
        docusignUserId: 'U-RLS',
        integrationKey: 'IK',
        rsaPrivateKey: 'KEY',
        connectSecret: 'SECRET',
        createdById: USER_ID,
      })
      .returning();
    docusignConnId = docusignConn!.id;

    const [env] = await db
      .insert(docusignEnvelopes)
      .values({
        organizationId: ORG_A_ID,
        docusignConnectionId: docusignConnId,
        documentId: DOC_ID,
        docusignEnvelopeId: 'env-rls-001',
        status: 'sent',
        sentAt: new Date(),
        createdById: USER_ID,
      })
      .returning();
    envelopeRowId = env!.id;

    const [contact] = await db
      .insert(contacts)
      .values({
        organizationId: ORG_A_ID,
        primaryName: 'RLS Test Person',
        primaryEmail: 'rls@example.invalid',
      })
      .returning();
    contactRowId = contact!.id;

    const [identity] = await db
      .insert(contactIdentities)
      .values({
        contactId: contactRowId,
        organizationId: ORG_A_ID,
        kind: 'email',
        normalizedValue: 'rls@example.invalid',
        rawValue: 'rls@example.invalid',
        source: 'manual',
        confidence: 1.0,
      })
      .returning();
    identityRowId = identity!.id;

    const [comm] = await db
      .insert(communications)
      .values({
        organizationId: ORG_A_ID,
        kind: 'slack',
        direction: 'inbound',
        medium: 'slack',
        status: 'ready',
        vendorEventId: 'T-rls-test:C-rls:1.0',
      })
      .returning();
    slackCommId = comm!.id;

    const [msg] = await db
      .insert(slackMessages)
      .values({
        communicationId: slackCommId,
        slackTeamId: 'T-rls-test',
        slackChannelId: 'C-rls',
        slackMessageTs: '1.0',
        text: 'rls test',
      })
      .returning();
    slackMsgId = msg!.id;
  });

  afterAll(async () => {
    const db = getDb();
    // Reverse dependency order: children before parents.
    await db.delete(slackMessages).where(eq(slackMessages.id, slackMsgId));
    await db.delete(communications).where(eq(communications.id, slackCommId));
    await db.delete(contactIdentities).where(eq(contactIdentities.id, identityRowId));
    await db.delete(contacts).where(eq(contacts.id, contactRowId));
    await db.delete(docusignEnvelopes).where(eq(docusignEnvelopes.id, envelopeRowId));
    await db.delete(orgDocusignConnections).where(eq(orgDocusignConnections.id, docusignConnId));
    await db.delete(driveFiles).where(eq(driveFiles.id, driveFileId));
    await db.delete(orgDriveConnections).where(eq(orgDriveConnections.id, driveConnId));
    await db.delete(orgSlackConnections).where(eq(orgSlackConnections.id, slackConnId));
    await db.delete(documents).where(eq(documents.id, DOC_ID));
    await db.delete(deals).where(eq(deals.id, DEAL_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.delete(organizations).where(inArray(organizations.id, [ORG_A_ID, ORG_B_ID]));
  });

  it('Org B cannot SELECT Org A slack connections', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: orgSlackConnections.id })
        .from(orgSlackConnections)
        .where(eq(orgSlackConnections.id, slackConnId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A slack messages (EXISTS-join policy)', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: slackMessages.id })
        .from(slackMessages)
        .where(eq(slackMessages.id, slackMsgId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A drive connections', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: orgDriveConnections.id })
        .from(orgDriveConnections)
        .where(eq(orgDriveConnections.id, driveConnId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A drive files', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx.select({ id: driveFiles.id }).from(driveFiles).where(eq(driveFiles.id, driveFileId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A docusign connections', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: orgDocusignConnections.id })
        .from(orgDocusignConnections)
        .where(eq(orgDocusignConnections.id, docusignConnId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A docusign envelopes', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: docusignEnvelopes.id })
        .from(docusignEnvelopes)
        .where(eq(docusignEnvelopes.id, envelopeRowId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A contacts', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactRowId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org B cannot SELECT Org A contact identities', async () => {
    const rows = await withRls(ORG_B_ID, (tx) =>
      tx
        .select({ id: contactIdentities.id })
        .from(contactIdentities)
        .where(eq(contactIdentities.id, identityRowId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('Org A sees its own slack messages via withRls (positive control)', async () => {
    const rows = await withRls(ORG_A_ID, (tx) =>
      tx
        .select({ id: slackMessages.id })
        .from(slackMessages)
        .where(eq(slackMessages.id, slackMsgId)),
    );
    expect(rows).toHaveLength(1);
  });
});
