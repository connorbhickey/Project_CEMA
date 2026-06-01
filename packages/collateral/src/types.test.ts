import { documentKindEnum } from '@cema/db';
import { describe, expect, it } from 'vitest';

import { DOCUMENT_KINDS, GATE_REQUIRED_KINDS } from './types';

describe('document-kind drift guard', () => {
  it('DOCUMENT_KINDS matches the DB document_kind enum exactly', () => {
    expect([...DOCUMENT_KINDS].sort()).toEqual([...documentKindEnum.enumValues].sort());
  });

  it('GATE_REQUIRED_KINDS matches the 14 attorney-gated kinds', () => {
    expect([...GATE_REQUIRED_KINDS].sort()).toEqual(
      [
        'aff_255',
        'aff_275',
        'allonge',
        'aom',
        'cema_3172',
        'consolidated_note',
        'county_cover_sheet',
        'exhibit_a',
        'exhibit_b',
        'exhibit_c',
        'exhibit_d',
        'gap_mortgage',
        'gap_note',
        'mt_15',
      ].sort(),
    );
  });
});
