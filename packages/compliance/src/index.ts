export { emitAuditEvent, type AuditEventInput } from './audit-log.js';
export { maskSsn, redactPii } from './pii.js';
export {
  AttorneyReviewRequiredError,
  requireAttorneyApproval,
  type DocumentGate,
} from './attorney-review.js';
