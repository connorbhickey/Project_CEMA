export interface ExistingLoanFormInput {
  upb: string;
  chainPosition: string;
  originalPrincipal?: string;
  investor?: string;
  recordedReelPage?: string;
  recordedCrfn?: string;
}

export interface ParsedExistingLoan {
  upb: string; // numeric string for the drizzle decimal column (scale 2)
  chainPosition: number;
  originalPrincipal: string | null;
  investor: string | null;
  recordedReelPage: string | null;
  recordedCrfn: string | null;
}

function trimOrNull(value: string | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

/**
 * Validate + normalize an existing-loan editor submission against the
 * `existing_loans` invariants (mirrors the DB CHECKs, so the editor rejects bad
 * input before the insert): `upb >= 0`, `chain_position` a non-negative integer,
 * `original_principal > 0` if present, and the reel/page (upstate) vs. CRFN (NYC)
 * recording coordinates are **mutually exclusive** (the `existing_loans_recording_xor`
 * CHECK). Decimal fields are rounded to scale 2. Throws a descriptive error on a
 * violation; pure (no IO) so it is node-testable.
 */
export function parseExistingLoanInput(input: ExistingLoanFormInput): ParsedExistingLoan {
  const upbNum = Number(input.upb);
  if (!Number.isFinite(upbNum) || upbNum < 0) {
    throw new Error('UPB must be a non-negative number');
  }

  const chainPosition = Number(input.chainPosition);
  if (!Number.isInteger(chainPosition) || chainPosition < 0) {
    throw new Error('Chain position must be a non-negative whole number');
  }

  let originalPrincipal: string | null = null;
  const op = trimOrNull(input.originalPrincipal);
  if (op !== null) {
    const opNum = Number(op);
    if (!Number.isFinite(opNum) || opNum <= 0) {
      throw new Error('Original principal must be a positive number');
    }
    originalPrincipal = opNum.toFixed(2);
  }

  const recordedReelPage = trimOrNull(input.recordedReelPage);
  const recordedCrfn = trimOrNull(input.recordedCrfn);
  if (recordedReelPage !== null && recordedCrfn !== null) {
    throw new Error('Provide either a reel/page (upstate) or a CRFN (NYC), not both');
  }

  return {
    upb: upbNum.toFixed(2),
    chainPosition,
    originalPrincipal,
    investor: trimOrNull(input.investor),
    recordedReelPage,
    recordedCrfn,
  };
}
