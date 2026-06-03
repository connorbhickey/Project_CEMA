import Link from 'next/link';
import type { ComponentProps } from 'react';

type Href = ComponentProps<typeof Link>['href'];

export interface AgentFilterChip {
  readonly key: string;
  readonly label: string;
  readonly href: Href;
  readonly active: boolean;
}

/** Render-only: a row of agent-activity filter chips (links). Each page supplies
 *  type-correct hrefs (dashboard: UrlObject; deal page: cast Route string). */
export function AgentFilterChips({ chips }: { chips: AgentFilterChip[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {chips.map((c) => (
        <Link
          key={c.key}
          href={c.href}
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
