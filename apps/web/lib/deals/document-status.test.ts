import { documentReviewStateEnum, documentStatusEnum } from '@cema/db';
import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_STATUS_LABELS,
  documentStatusLabel,
  REVIEW_STATE_LABELS,
  reviewStateLabel,
} from './document-status';

describe('document-status', () => {
  it('labels known statuses + review states, falls back to the raw token', () => {
    expect(documentStatusLabel('attorney_review')).toBe('In Attorney Review');
    expect(documentStatusLabel('recorded')).toBe('Recorded');
    expect(reviewStateLabel('claimed')).toBe('Claimed');
    expect(documentStatusLabel('mystery')).toBe('mystery');
  });

  it('document status labels stay in lockstep with the pg enum (drift guard)', () => {
    expect(Object.keys(DOCUMENT_STATUS_LABELS).sort()).toEqual(
      [...documentStatusEnum.enumValues].sort(),
    );
  });

  it('review state labels stay in lockstep with the pg enum (drift guard)', () => {
    expect(Object.keys(REVIEW_STATE_LABELS).sort()).toEqual(
      [...documentReviewStateEnum.enumValues].sort(),
    );
  });
});
