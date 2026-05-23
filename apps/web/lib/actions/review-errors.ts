export class ReviewDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewDecisionError';
  }
}

export class ReviewClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewClaimError';
  }
}
