import { describe, expect, it } from 'vitest';

import { notificationForStatus } from './notify';
import { INTERNAL_CHANNELS, NOTIFY_STATUSES } from './types';

describe('notificationForStatus', () => {
  it('returns a pipeline notification for each notify-worthy status', () => {
    for (const status of NOTIFY_STATUSES) {
      const n = notificationForStatus(status);
      expect(n).not.toBeNull();
      expect(n).toMatchObject({ status, channel: 'pipeline' });
      expect(n!.message.length).toBeGreaterThan(0);
    }
  });

  it('returns null for routine/terminal statuses', () => {
    for (const status of [
      'intake',
      'eligibility',
      'title_work',
      'doc_prep',
      'closing',
      'recording',
      'completed',
      'cancelled',
    ]) {
      expect(notificationForStatus(status)).toBeNull();
    }
  });

  it('returns null for an unknown status string', () => {
    expect(notificationForStatus('not_a_status')).toBeNull();
  });

  it('messages are static PII-free strings (no interpolated ids/counts/names)', () => {
    for (const status of NOTIFY_STATUSES) {
      const message = notificationForStatus(status)!.message;
      expect(message).not.toMatch(/\d/); // no count/id/amount leaks
    }
  });

  it('exposes the notify-status and channel vocabularies', () => {
    expect([...NOTIFY_STATUSES].sort()).toEqual([
      'attorney_review',
      'authorization',
      'collateral_chase',
      'exception',
    ]);
    expect(INTERNAL_CHANNELS).toEqual(['pipeline']);
  });
});
