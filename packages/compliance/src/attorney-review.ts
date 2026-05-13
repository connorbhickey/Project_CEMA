export class AttorneyReviewRequiredError extends Error {
  constructor(public readonly documentKind: string) {
    super(
      `Attorney review required for document of kind '${documentKind}' before this action is permitted.`,
    );
    this.name = 'AttorneyReviewRequiredError';
  }
}

export interface DocumentGate {
  kind: string;
  status: string;
  attorneyReviewRequired: boolean;
}

const TERMINAL_OK_STATES = new Set(['approved', 'executed', 'recorded']);

export function requireAttorneyApproval(doc: DocumentGate): void {
  if (!doc.attorneyReviewRequired) {
    return;
  }
  if (!TERMINAL_OK_STATES.has(doc.status)) {
    throw new AttorneyReviewRequiredError(doc.kind);
  }
}
