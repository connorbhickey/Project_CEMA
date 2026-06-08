import type { UrlObject } from 'url';

/**
 * Build a Next `<Link>` href for a *computed* path string.
 *
 * Returns a `UrlObject` (its `pathname` is a plain `string`) rather than casting
 * to the branded `Route` type — which deliberately sidesteps the Next
 * typed-routes flip-flop: local `tsc` demands `` `/x/${id}` as Route `` (string is
 * not assignable to the branded `Route`), while CI's post-`next typegen` eslint
 * resolves `Route` loosely and flags that exact cast as *unnecessary*, then
 * strips it. A `UrlObject` never touches `Route`, so BOTH type-checkers agree —
 * no `as Route`, no eslint-disable. `<Link>` accepts `Route | UrlObject`.
 */
export function routeHref(path: string): UrlObject {
  return { pathname: path };
}
