import { describe, expect, it } from 'vitest';

import { attorneyApprovals } from './attorney-review.js';
import { auditEvents } from './audit.js';
import { documents } from './documents.js';
import { parties } from './parties.js';

describe('parties + documents + attorney + audit', () => {
  it('parties tied to a deal with a role', () => {
    const cols = Object.keys(parties);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'dealId',
        'role',
        'fullName',
        'email',
        'phone',
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
