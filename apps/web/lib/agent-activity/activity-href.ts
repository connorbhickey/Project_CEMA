/** The active (non-default) activity-feed params. Omits null/undefined so the
 *  agent + since filters and the pagination cursor can be composed into one href
 *  and travel together. Used directly as a Next `UrlObject` query (the stat
 *  cards) and serialized for the chip / "load older" hrefs (activityHref). */
export function activityParams(opts: {
  agent?: string | null;
  since?: string | null;
  cursor?: string | null;
}): Record<string, string> {
  const params: Record<string, string> = {};
  if (opts.agent) params.agent = opts.agent;
  if (opts.since) params.since = opts.since;
  if (opts.cursor) params.cursor = opts.cursor;
  return params;
}

/** A ready href string for a filter chip or the "load older" link: base path +
 *  the composed query (or the bare base when nothing is active). Param order is
 *  stable (agent, since, cursor); the agent/since values are safe enum tokens and
 *  the cursor is `<ISO>_<uuid>` — all URL-query-safe, so no encoding is needed. */
export function activityHref(
  base: string,
  opts: { agent?: string | null; since?: string | null; cursor?: string | null },
): string {
  const query = Object.entries(activityParams(opts))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return query ? `${base}?${query}` : base;
}
