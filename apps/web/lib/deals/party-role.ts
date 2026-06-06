/**
 * Canonical party_role display labels + validation. Single source of truth for
 * party-role labels in the deal-parties editor. The drift-guard test asserts these
 * keys stay in lockstep with the party_role pg enum (so a future role can't
 * silently lose a label).
 */
export const PARTY_ROLE_LABELS = {
  borrower: 'Borrower',
  co_borrower: 'Co-Borrower',
  seller: 'Seller',
  loan_officer: 'Loan Officer',
  processor: 'Processor',
  closing_attorney: 'Closing Attorney',
  title_agent: 'Title Agent',
  seller_attorney: 'Seller Attorney',
  doc_custodian: 'Document Custodian',
} as const;

export type PartyRole = keyof typeof PARTY_ROLE_LABELS;

/** All roles in canonical order — for the editor's role dropdown. */
export const PARTY_ROLES = Object.keys(PARTY_ROLE_LABELS) as PartyRole[];

/** Display label for a role, or the raw value if unknown. */
export function partyRoleLabel(role: string): string {
  return (PARTY_ROLE_LABELS as Record<string, string>)[role] ?? role;
}

/**
 * Validate an untrusted role (from the editor form / a Server Action arg) against
 * the known roles. Returns the role if valid, else null — the boundary guard that
 * keeps a bad role out of the parties insert (an RPC arg is untrusted).
 */
export function parsePartyRole(raw: string | undefined | null): PartyRole | null {
  return raw != null && raw in PARTY_ROLE_LABELS ? (raw as PartyRole) : null;
}
