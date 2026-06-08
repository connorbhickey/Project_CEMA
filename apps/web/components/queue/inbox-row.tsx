import { ChevronRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { routeHref } from '@/lib/routes';

/**
 * Shared command-center inbox row — an icon chip, a title + mono sub-line, a
 * right-aligned badge cluster, and a hover chevron. Used by the attorney review
 * queue, the chain-of-title queue, and the exceptions inbox so all three triage
 * surfaces read identically. An optional left severity stripe draws the eye to
 * the most urgent rows.
 */
interface InboxRowProps {
  href: string;
  icon: LucideIcon;
  /** icon color, e.g. 'text-blue-600 dark:text-blue-400' */
  iconTint?: string;
  /** icon chip background, e.g. 'bg-blue-500/10' */
  iconBg?: string;
  /** optional 3px left stripe, e.g. 'bg-red-500' (severity) */
  stripe?: string;
  title: ReactNode;
  sub?: ReactNode;
  /** right-side badge cluster (state / severity / stage pills) */
  badges?: ReactNode;
}

export function InboxRow({
  href,
  icon: Icon,
  iconTint = 'text-muted-foreground',
  iconBg = 'bg-muted',
  stripe,
  title,
  sub,
  badges,
}: InboxRowProps) {
  return (
    <Link
      href={routeHref(href)}
      role="listitem"
      className="border-border hover:bg-accent/40 group relative flex items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0"
    >
      {stripe ? (
        <span className={`absolute left-0 top-0 h-full w-[3px] ${stripe}`} aria-hidden />
      ) : null}
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        <Icon className={`h-[18px] w-[18px] ${iconTint}`} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate text-[13px] font-semibold leading-snug">
          {title}
        </div>
        {sub ? (
          <div className="text-muted-foreground mt-0.5 truncate text-[11.5px]">{sub}</div>
        ) : null}
      </div>
      {badges ? <div className="flex shrink-0 items-center gap-1.5">{badges}</div> : null}
      <ChevronRight
        className="text-muted-foreground/40 group-hover:text-muted-foreground h-4 w-4 shrink-0 transition-colors"
        strokeWidth={2}
      />
    </Link>
  );
}
