import { describe, expect, it } from 'vitest';

import { borrowerNotificationForStatus } from './notify';
import { BORROWER_CHANNELS, BORROWER_NOTIFY_STATUSES } from './types';

describe('borrowerNotificationForStatus', () => {
  it('returns an email notification for each borrower touchpoint status', () => {
    for (const status of BORROWER_NOTIFY_STATUSES) {
      const n = borrowerNotificationForStatus(status);
      expect(n).not.toBeNull();
      expect(n).toMatchObject({ status, channel: 'email' });
      expect(n!.subject.length).toBeGreaterThan(0);
      expect(n!.body.length).toBeGreaterThan(0);
    }
  });

  it('returns null for internal-only / non-touchpoint statuses', () => {
    for (const status of [
      'intake',
      'eligibility',
      'collateral_chase',
      'title_work',
      'doc_prep',
      'attorney_review',
      'recording',
      'exception',
      'cancelled',
    ]) {
      expect(borrowerNotificationForStatus(status)).toBeNull();
    }
  });

  it('returns null for an unknown status string', () => {
    expect(borrowerNotificationForStatus('not_a_status')).toBeNull();
  });

  it('subjects + bodies are static PII-free strings (no digits/ids/amounts)', () => {
    for (const status of BORROWER_NOTIFY_STATUSES) {
      const n = borrowerNotificationForStatus(status)!;
      expect(n.subject).not.toMatch(/\d/);
      expect(n.body).not.toMatch(/\d/);
    }
  });

  it('exposes the touchpoint + channel vocabularies', () => {
    expect([...BORROWER_NOTIFY_STATUSES].sort()).toEqual(['authorization', 'closing', 'completed']);
    expect(BORROWER_CHANNELS).toEqual(['email']);
  });
});
