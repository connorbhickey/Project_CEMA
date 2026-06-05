import type { DocumentKind, InstrumentRecord, RawExtraction, RecordingRef } from './types';

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function toAmount(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// CRFN (NYC ACRIS) and reel/page (upstate) are mutually exclusive recording
// identifiers; the DB enforces this via documents_recording_xor. CRFN wins.
function toRecordingRef(fields: Readonly<Record<string, string | null>>): RecordingRef {
  const crfn = fields.crfn ?? null;
  const reelPage = crfn ? null : (fields.reelPage ?? null);
  return { reelPage, crfn };
}

export function extract(
  documentId: string,
  raw: RawExtraction,
  classification: { kind: DocumentKind },
): InstrumentRecord {
  const f = raw.fields;
  return {
    documentId,
    instrumentKind: classification.kind,
    assignor: f.assignor ?? null,
    assignee: f.assignee ?? null,
    executedAt: toIsoDate(f.executedAt),
    recordedAt: toIsoDate(f.recordedAt),
    amount: toAmount(f.amount),
    recordingRef: toRecordingRef(f),
    county: f.county ?? null,
    references: f.references ?? null,
    originator: f.originator ?? null,
  };
}
