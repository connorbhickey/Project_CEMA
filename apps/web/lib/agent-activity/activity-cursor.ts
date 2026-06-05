/** A keyset-pagination cursor for the activity feeds: the (occurredAt, id) of the
 *  last row on a page. The next page is everything strictly older, ordered the
 *  same way. occurredAt is compared at millisecond precision in the loaders
 *  (date_trunc) so this ms-precision Date matches exactly. */
export interface ActivityCursor {
  readonly occurredAt: Date;
  readonly id: string;
}

/** One page of an activity feed: the rows, plus the cursor for the next (older)
 *  page — null when this is the last page. The loader fetches LIMIT+1 to decide. */
export interface ActivityPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** Encode a cursor as `<ISO occurredAt>_<id>` for the `?cursor=` searchParam. An
 *  ISO-8601 timestamp contains no `_`, so the FIRST `_` cleanly separates the
 *  two halves. ISO + UUID chars are URL-query-safe, so no escaping is needed
 *  (consistent with activityHref's other enum/token params). */
export function encodeActivityCursor(cursor: ActivityCursor): string {
  return `${cursor.occurredAt.toISOString()}_${cursor.id}`;
}

/** Parse an untrusted `?cursor=` searchParam. Returns null for absent or
 *  malformed input (mirrors parseSinceFilter — a bad cursor degrades to the
 *  first page, never throws). Splits on the FIRST `_` so an id that itself
 *  contains `_` survives intact. */
export function parseActivityCursor(raw: string | undefined | null): ActivityCursor | null {
  if (raw == null) return null;
  const sep = raw.indexOf('_');
  // require a non-empty ISO part before the separator AND a non-empty id after
  if (sep <= 0 || sep === raw.length - 1) return null;
  const iso = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return { occurredAt: new Date(ms), id };
}
