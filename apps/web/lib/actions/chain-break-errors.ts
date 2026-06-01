// Lives outside the 'use server' action module so Turbopack does not reject a
// non-async-function export from a Server Action file (mirrors review-errors.ts).
export class ChainBreakReviewError extends Error {}
