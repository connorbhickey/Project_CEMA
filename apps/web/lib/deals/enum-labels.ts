/**
 * Human labels for the small deal enums shown on the deal overview (property type,
 * loan program, CEMA type). One file so the "humanize the deal tokens" helpers live
 * together; each has a drift-guard test keeping it in lockstep with its pg enum.
 */

export const PROPERTY_TYPE_LABELS = {
  one_family: '1-Family',
  two_family: '2-Family',
  three_family: '3-Family',
  condo: 'Condominium',
  pud: 'PUD',
} as const;

export const LOAN_PROGRAM_LABELS = {
  conventional_fannie: 'Conventional (Fannie Mae)',
  conventional_freddie: 'Conventional (Freddie Mac)',
  conventional_private: 'Conventional (Private)',
  jumbo: 'Jumbo',
} as const;

export const CEMA_TYPE_LABELS = {
  refi_cema: 'Refi CEMA',
  purchase_cema: 'Purchase CEMA',
} as const;

/** Display label for a property type, or the raw token if unknown. */
export function propertyTypeLabel(value: string): string {
  return (PROPERTY_TYPE_LABELS as Record<string, string>)[value] ?? value;
}

/** Display label for a loan program, or the raw token if unknown. */
export function loanProgramLabel(value: string): string {
  return (LOAN_PROGRAM_LABELS as Record<string, string>)[value] ?? value;
}

/** Display label for a CEMA type, or the raw token if unknown. */
export function cemaTypeLabel(value: string): string {
  return (CEMA_TYPE_LABELS as Record<string, string>)[value] ?? value;
}
