import type { Route } from 'next';
import Link from 'next/link';

/**
 * Render-only "Load older →" pagination link. Takes a plain string href and casts
 * to Route at the single render point — `string as Route` is a NECESSARY
 * narrowing on an opaque prop, so it typechecks + lints identically in CI and
 * local regardless of `.next/types` freshness. (The typed-routes flip-flop only
 * bites when the cast sits on a traceable `activityHref(...)` expression, where
 * `no-unnecessary-type-assertion` can see through to the string type.) Mirrors
 * AgentFilterChips' href handling.
 */
export function LoadOlderLink({ href }: { href: string }) {
  return (
    <div className="mt-6">
      <Link href={href as Route} className="text-primary text-sm font-medium hover:underline">
        Load older →
      </Link>
    </div>
  );
}
