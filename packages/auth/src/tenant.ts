import type { ClerkAuthSnapshot } from './types';

export class NotAuthenticatedError extends Error {
  constructor() {
    super('User is not authenticated.');
    this.name = 'NotAuthenticatedError';
  }
}

export class NoActiveOrganizationError extends Error {
  constructor() {
    super('User has no active organization. Select or create one before continuing.');
    this.name = 'NoActiveOrganizationError';
  }
}

export function resolveOrganizationId(snapshot: ClerkAuthSnapshot): string {
  if (!snapshot.userId) {
    throw new NotAuthenticatedError();
  }
  if (!snapshot.orgId) {
    throw new NoActiveOrganizationError();
  }
  return snapshot.orgId;
}
