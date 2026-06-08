/**
 * Shared command-center bento primitives for the deal hub — extracted from the
 * deal overview so every sub-view (parties, loans, documents, graph, …) composes
 * cards from one source of truth. On-brand: teal / blue / cyan / sky / amber /
 * slate / emerald. No violet / indigo / purple. No raw hex (the box-shadow is the
 * single sanctioned literal, matching the /deals + dashboard surfaces).
 */

import type { UrlObject } from 'url';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

// ─── Card shell ───────────────────────────────────────────────────────────────

export function BentoCard({
  icon,
  iconTile,
  title,
  linkHref,
  linkLabel,
  children,
}: {
  icon: ReactNode;
  iconTile: string;
  title: string;
  linkHref?: UrlObject;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-card border-border rounded-2xl border p-4 shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${iconTile}`}
          >
            {icon}
          </div>
          <h3 className="text-foreground text-[13px] font-bold">{title}</h3>
        </div>
        {linkHref && linkLabel ? (
          <Link
            href={linkHref}
            className="flex items-center gap-1 text-[12px] font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400"
          >
            {linkLabel}
            <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
          </Link>
        ) : null}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

// ─── Data row ─────────────────────────────────────────────────────────────────

export function DataRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground shrink-0 text-[12.5px]">{label}</dt>
      <dd
        className={`text-foreground text-right text-[13px] font-medium ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

export function CardEmptyState({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-[12.5px]">{children}</p>;
}
