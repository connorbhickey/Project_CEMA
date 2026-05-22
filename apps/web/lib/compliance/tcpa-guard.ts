// Hard rule #4: TCPA opt-in is mandatory for any outbound voice/SMS to borrowers.
// Servicer/processor/attorney roles are B2B — TCPA does not apply to them.
const BORROWER_ROLES = new Set(['borrower', 'co_borrower']);

export class TcpaConsentMissingError extends Error {
  readonly partyId: string;

  constructor(partyId: string) {
    super(
      `TCPA consent required for party ${partyId} — record opt-in before dialing. ` +
        'Hard rule #4.',
    );
    this.name = 'TcpaConsentMissingError';
    this.partyId = partyId;
  }
}

export interface PartyForTcpaGuard {
  id: string;
  role: string;
  tcpaOptIn: boolean;
  tcpaOptInAt: Date | null;
}

export function tcpaGuard(party: PartyForTcpaGuard): void {
  if (!BORROWER_ROLES.has(party.role)) return;
  if (!party.tcpaOptIn || !party.tcpaOptInAt) {
    throw new TcpaConsentMissingError(party.id);
  }
}
