export { emitAuditEvent, type AuditEventInput } from './audit-log';
export { maskSsn, redactPii } from './pii';
export {
  AttorneyReviewRequiredError,
  requireAttorneyApproval,
  type DocumentGate,
} from './attorney-review';
