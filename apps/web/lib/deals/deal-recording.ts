export interface DealRecording {
  readonly venue: string | null;
  readonly reelPage: string | null;
  readonly crfn: string | null;
  readonly recordedAt: string | null;
}

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v : null;

/**
 * Safely read the recording coordinates the Recording Prep Agent writes to
 * `deals.metadata.recording` on acceptance (`{ venue, reelPage|crfn (XOR),
 * recordedAt }`). Returns null until a recording exists — defined as having at
 * least one of reel/page (upstate) or CRFN (NYC), per hard rule #6 (a deal is only
 * `recorded` with a reel/page or CRFN). Pure + defensive against arbitrary jsonb.
 */
export function parseDealRecording(metadata: unknown): DealRecording | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const rec = (metadata as Record<string, unknown>).recording;
  if (typeof rec !== 'object' || rec === null) return null;

  const r = rec as Record<string, unknown>;
  const reelPage = asString(r.reelPage);
  const crfn = asString(r.crfn);
  if (!reelPage && !crfn) return null;

  return { venue: asString(r.venue), reelPage, crfn, recordedAt: asString(r.recordedAt) };
}
