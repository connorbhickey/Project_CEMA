import type { Route } from 'next';

/**
 * Cast a computed path string to a typed `Route` at a single, opaque-`string`
 * boundary.
 *
 * Next's typed-routes lint (`@typescript-eslint/no-unnecessary-type-assertion`,
 * which only runs in CI *after* `next typegen` regenerates the route table)
 * flags an inline `` `/deals/${id}/loans` as Route `` because, post-typegen, the
 * template literal is already a *known* `Route` — so the auto-format strips the
 * cast and the `Route` import becomes unused (`no-unused-vars`). Locally, without
 * typegen, `tsc` instead *demands* the cast. Funnelling every computed href
 * through this helper keeps the cast source a plain `string`, so the
 * `string → Route` narrowing is genuinely necessary from BOTH perspectives —
 * ending the flip-flop. Pass a string built from any interpolation; get a Route.
 */
export function routeHref(path: string): Route {
  return path as Route;
}
