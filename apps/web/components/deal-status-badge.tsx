/**
 * Shared deal status badge — a colored dot + human label pill.
 * Extracted from deal-row.tsx so the deals table and the deal overview
 * both pull from one source of truth.
 *
 * On-brand palette: teal / blue / cyan / sky / amber / slate / emerald.
 * No violet / indigo / purple. No raw hex — design tokens only.
 */

import { dealStatusLabel, type DealStatus } from '@/lib/deals/deal-status';

export const STATUS_BADGE: Record<DealStatus, { dot: string; badge: string }> = {
  intake: {
    dot: 'bg-teal-500',
    badge: 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
  },
  eligibility: {
    dot: 'bg-cyan-500',
    badge: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
  },
  authorization: {
    dot: 'bg-blue-500',
    badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  },
  collateral_chase: {
    dot: 'bg-sky-500',
    badge: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  },
  title_work: {
    dot: 'bg-teal-600',
    badge: 'bg-teal-600/10 text-teal-700 dark:text-teal-400',
  },
  doc_prep: {
    dot: 'bg-cyan-600',
    badge: 'bg-cyan-600/10 text-cyan-700 dark:text-cyan-400',
  },
  attorney_review: {
    dot: 'bg-blue-600',
    badge: 'bg-blue-600/10 text-blue-700 dark:text-blue-400',
  },
  closing: {
    dot: 'bg-blue-600',
    badge: 'bg-blue-600/10 text-blue-700 dark:text-blue-400',
  },
  recording: {
    dot: 'bg-teal-600',
    badge: 'bg-teal-600/10 text-teal-700 dark:text-teal-400',
  },
  completed: {
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  exception: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  cancelled: {
    dot: 'bg-slate-400',
    badge: 'bg-slate-400/10 text-slate-500 dark:text-slate-400',
  },
};

const FALLBACK_BADGE = {
  dot: 'bg-slate-400',
  badge: 'bg-slate-400/10 text-slate-500 dark:text-slate-400',
};

interface DealStatusBadgeProps {
  status: string;
  /** Pass `'lg'` on the deal overview header; defaults to the compact row size. */
  size?: 'sm' | 'lg';
}

export function DealStatusBadge({ status, size = 'sm' }: DealStatusBadgeProps) {
  const style = STATUS_BADGE[status as DealStatus] ?? FALLBACK_BADGE;
  const textSize = size === 'lg' ? 'text-[13px]' : 'text-[11.5px]';
  const padding = size === 'lg' ? 'px-2.5 py-1' : 'px-2 py-0.5';
  const dotSize = size === 'lg' ? 'h-2 w-2' : 'h-[6px] w-[6px]';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${textSize} ${padding} ${style.badge}`}
    >
      <span className={`shrink-0 rounded-full ${dotSize} ${style.dot}`} />
      {dealStatusLabel(status)}
    </span>
  );
}
