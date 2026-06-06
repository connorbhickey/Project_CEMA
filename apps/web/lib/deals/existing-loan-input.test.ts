import { describe, expect, it } from 'vitest';

import { parseExistingLoanInput } from './existing-loan-input';

describe('parseExistingLoanInput', () => {
  it('normalizes a valid loan (decimals to scale 2, optional fields)', () => {
    expect(
      parseExistingLoanInput({
        upb: '300000',
        chainPosition: '0',
        originalPrincipal: '325000.5',
        investor: ' Fannie Mae ',
        recordedCrfn: ' 2020000123456 ',
      }),
    ).toEqual({
      upb: '300000.00',
      chainPosition: 0,
      originalPrincipal: '325000.50',
      investor: 'Fannie Mae',
      recordedReelPage: null,
      recordedCrfn: '2020000123456',
    });
  });

  it('allows a reel/page alone (upstate)', () => {
    const r = parseExistingLoanInput({
      upb: '1',
      chainPosition: '1',
      recordedReelPage: 'R123/P45',
    });
    expect(r.recordedReelPage).toBe('R123/P45');
    expect(r.recordedCrfn).toBeNull();
  });

  it('rejects both reel/page AND crfn (the recording XOR invariant)', () => {
    expect(() =>
      parseExistingLoanInput({
        upb: '1',
        chainPosition: '0',
        recordedReelPage: 'R1/P1',
        recordedCrfn: '2020000000001',
      }),
    ).toThrow(/either a reel\/page .* or a CRFN/i);
  });

  it('rejects a negative UPB', () => {
    expect(() => parseExistingLoanInput({ upb: '-5', chainPosition: '0' })).toThrow(/UPB/i);
  });

  it('rejects a non-numeric UPB', () => {
    expect(() => parseExistingLoanInput({ upb: 'abc', chainPosition: '0' })).toThrow(/UPB/i);
  });

  it('rejects a negative / non-integer chain position', () => {
    expect(() => parseExistingLoanInput({ upb: '1', chainPosition: '-1' })).toThrow(
      /chain position/i,
    );
    expect(() => parseExistingLoanInput({ upb: '1', chainPosition: '1.5' })).toThrow(
      /chain position/i,
    );
  });

  it('rejects a non-positive original principal', () => {
    expect(() =>
      parseExistingLoanInput({ upb: '1', chainPosition: '0', originalPrincipal: '0' }),
    ).toThrow(/original principal/i);
  });

  it('treats blank optional fields as null', () => {
    const r = parseExistingLoanInput({
      upb: '100000',
      chainPosition: '0',
      originalPrincipal: '  ',
      investor: '',
      recordedReelPage: '',
      recordedCrfn: '',
    });
    expect(r.originalPrincipal).toBeNull();
    expect(r.investor).toBeNull();
    expect(r.recordedReelPage).toBeNull();
    expect(r.recordedCrfn).toBeNull();
  });
});
