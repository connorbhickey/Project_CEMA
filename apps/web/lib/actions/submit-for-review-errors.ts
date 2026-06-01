// Plain module (NOT 'use server') so the error class can be imported across
// the client boundary. A 'use server' file may only export async functions to
// clients; a class export would poison the module's client-facing exports.

export class DocumentNotReviewableError extends Error {
  constructor(documentId: string, reason: string) {
    super(`Document ${documentId} is not reviewable: ${reason}`);
    this.name = 'DocumentNotReviewableError';
  }
}
