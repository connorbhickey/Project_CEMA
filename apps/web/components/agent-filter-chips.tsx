import type { Route } from 'next';
import Link from 'next/link';

export interface AgentFilterChip {
  readonly key: string;
  readonly label: string;
  /** A ready-to-use href string (e.g. '/dashboard?agent=idp'). */
  readonly href: string;
  readonly active: boolean;
}

/**
 * Render-only: a row of agent-activity filter chips (links). hrefs are plain
 * strings cast to Route at the single render point — `string as Route` is always
 * a necessary narrowing, so it typechecks and lints identically in CI and local
 * regardless of `.next/types` freshness (avoids the typed-routes flip-flop on
 * dynamic-path hrefs).
 */
export function AgentFilterChips({ chips }: { chips: AgentFilterChip[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {chips.map((c) => (
        <Link
          key={c.key}
          href={c.href as Route}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            c.active
              ? 'bg-foreground text-background border-foreground'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}
