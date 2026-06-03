/** The active (non-default) activity-feed filter params. Omits null/undefined so
 *  the agent + since filters can be composed into one href and travel together.
 *  Used directly as a Next `UrlObject` query (the stat cards) and serialized for
 *  the chip hrefs (activityHref). */
export function activityParams(opts: {
  agent?: string | null;
  since?: string | null;
}): Record<string, string> {
  const params: Record<string, string> = {};
  if (opts.agent) params.agent = opts.agent;
  if (opts.since) params.since = opts.since;
  return params;
}

/** A ready href string for a filter chip: base path + the composed query (or the
 *  bare base when no filter is active). Param order is stable (agent, then since);
 *  values are safe enum tokens, so no encoding is needed. */
export function activityHref(
  base: string,
  opts: { agent?: string | null; since?: string | null },
): string {
  const query = Object.entries(activityParams(opts))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return query ? `${base}?${query}` : base;
}
