/**
 * Review-queue state pill, covering BOTH the document review queue
 * (pending | claimed | approved | rejected) and the chain-break review queue
 * (pending | claimed | resolved | dismissed). Emerald = success terminal;
 * red = rejected; slate = dismissed/unknown. (No purple — banned.)
 */
const STATE: Record<string, { dot: string; badge: string; label: string }> = {
  pending: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    label: 'Pending',
  },
  claimed: {
    dot: 'bg-blue-500',
    badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
    label: 'Claimed',
  },
  approved: {
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    label: 'Approved',
  },
  resolved: {
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    label: 'Resolved',
  },
  rejected: {
    dot: 'bg-red-500',
    badge: 'bg-red-500/10 text-red-700 dark:text-red-400',
    label: 'Rejected',
  },
  dismissed: {
    dot: 'bg-slate-400',
    badge: 'bg-slate-400/10 text-slate-600 dark:text-slate-400',
    label: 'Dismissed',
  },
};

export function QueueStateBadge({ state }: { state: string }) {
  const s = STATE[state] ?? {
    dot: 'bg-slate-400',
    badge: 'bg-slate-400/10 text-slate-600 dark:text-slate-400',
    label: state,
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.badge}`}
    >
      <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
