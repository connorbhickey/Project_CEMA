import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { attorneyApprovals } from './attorney-review';
import { auditEvents } from './audit';
import { documents } from './documents';
import { parties } from './parties';

describe('parties + documents + attorney + audit', () => {
  it('parties tied to a deal with a role and TCPA opt-in surface', () => {
    const cols = Object.keys(parties);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'dealId',
        'role',
        'fullName',
        'email',
        'phone',
        'tcpaOptIn',
        'tcpaOptInAt',
        'tcpaOptInSource',
        'recordingDisclosureConfirmedAt',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('documents include attorney_review_required gate', () => {
    const cols = Object.keys(documents);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'dealId',
        'kind',
        'status',
        'version',
        'attorneyReviewRequired',
        'blobUrl',
        'checksum',
        'pageCount',
        'extractedData',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('attorney approvals are immutable per document version', () => {
    const cols = Object.keys(attorneyApprovals);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'documentId',
        'documentVersion',
        'approvedById',
        'approvedAt',
        'nmlsId',
        'notes',
      ]),
    );
  });

  it('audit events are append-only', () => {
    const cols = Object.keys(auditEvents);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'organizationId',
        'actorUserId',
        'action',
        'entityType',
        'entityId',
        'metadata',
        'occurredAt',
      ]),
    );
  });
});

describe('compliance constraints', () => {
  it('documents enforces attorney gate on legal-document kinds', () => {
    const config = getTableConfig(documents);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('documents_attorney_gate_required');
  });

  it('attorney_approvals prevents duplicate approvals per document version', () => {
    const config = getTableConfig(attorneyApprovals);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain('attorney_approvals_doc_version_uidx');
  });

  it('parties rejects plaintext SSN format', () => {
    const config = getTableConfig(parties);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('parties_ssn_encrypted_not_plaintext');
  });

  it('parties enforces TCPA opt-in requires timestamp invariant', () => {
    // Hard rule #4: a party cannot be marked tcpa_opt_in=true without a
    // tcpa_opt_in_at timestamp, so the DB rejects the inconsistent state
    // before any application bug can call a borrower without a real consent
    // record. App layer additionally requires tcpa_opt_in_source.
    const config = getTableConfig(parties);
    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain('parties_tcpa_opt_in_requires_timestamp');
  });
});
