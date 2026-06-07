import { cemaTypeEnum, loanProgramEnum, propertyTypeEnum } from '@cema/db';
import { describe, expect, it } from 'vitest';

import {
  CEMA_TYPE_LABELS,
  cemaTypeLabel,
  LOAN_PROGRAM_LABELS,
  loanProgramLabel,
  PROPERTY_TYPE_LABELS,
  propertyTypeLabel,
} from './enum-labels';

describe('enum-labels', () => {
  it('labels known values and falls back to the raw token', () => {
    expect(propertyTypeLabel('three_family')).toBe('3-Family');
    expect(loanProgramLabel('conventional_fannie')).toBe('Conventional (Fannie Mae)');
    expect(cemaTypeLabel('purchase_cema')).toBe('Purchase CEMA');
    expect(propertyTypeLabel('unknown')).toBe('unknown');
  });

  it('property type labels stay in lockstep with the pg enum (drift guard)', () => {
    expect(Object.keys(PROPERTY_TYPE_LABELS).sort()).toEqual(
      [...propertyTypeEnum.enumValues].sort(),
    );
  });

  it('loan program labels stay in lockstep with the pg enum (drift guard)', () => {
    expect(Object.keys(LOAN_PROGRAM_LABELS).sort()).toEqual([...loanProgramEnum.enumValues].sort());
  });

  it('cema type labels stay in lockstep with the pg enum (drift guard)', () => {
    expect(Object.keys(CEMA_TYPE_LABELS).sort()).toEqual([...cemaTypeEnum.enumValues].sort());
  });
});
