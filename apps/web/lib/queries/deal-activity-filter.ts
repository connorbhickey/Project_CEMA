/** The deal activity-feed type filter. The feed merges two sources (communications
 *  + documents); a `?type=` searchParam narrows to one. Mirrors the agent-filter /
 *  since-filter boundary-guard pattern: parse untrusted input to a known token or
 *  null (a bad value degrades to the unfiltered feed, never throws). */
export type DealActivityType = 'communication' | 'document';

/** Chips for the activity-feed type filter (the `All` chip is rendered by the
 *  page from a null filter, mirroring the agent-activity page). */
export const DEAL_ACTIVITY_TYPE_FILTERS: ReadonlyArray<{
  readonly key: DealActivityType;
  readonly label: string;
}> = [
  { key: 'communication', label: 'Communications' },
  { key: 'document', label: 'Documents' },
];

/** Parse an untrusted `?type=` searchParam to a known activity type or null.
 *  The literal-union check narrows without a cast (TS flows `raw` to the type). */
export function parseDealActivityType(raw: string | undefined | null): DealActivityType | null {
  if (raw === 'communication' || raw === 'document') return raw;
  return null;
}
