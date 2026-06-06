import { documentKindEnum } from '@cema/db';
import { describe, expect, it } from 'vitest';

import { DOCUMENT_KIND_LABELS, documentKindLabel } from './document-kind';

describe('document-kind', () => {
  it('labels known kinds', () => {
    expect(documentKindLabel('aom')).toBe('Assignment of Mortgage');
    expect(documentKindLabel('cema_3172')).toBe('CEMA (NY Form 3172)');
    expect(documentKindLabel('county_cover_sheet')).toBe('County Recording Cover Sheet');
  });

  it('falls back to the raw token for an unknown kind', () => {
    expect(documentKindLabel('mystery_doc')).toBe('mystery_doc');
  });

  it('labels every document_kind enum value (drift guard)', () => {
    for (const kind of documentKindEnum.enumValues) {
      expect(kind in DOCUMENT_KIND_LABELS).toBe(true);
    }
    // no extra labels beyond the enum
    expect(Object.keys(DOCUMENT_KIND_LABELS).sort()).toEqual(
      [...documentKindEnum.enumValues].sort(),
    );
  });
});
