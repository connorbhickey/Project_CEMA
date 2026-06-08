import type { ExceptionSeverity } from '@cema/agents-exception-triage';

/**
 * Exception severity pill + a matching left-stripe color, on the risk ramp
 * red → orange → amber → slate. (No purple — banned.)
 */
const SEVERITY: Record<
  ExceptionSeverity,
  { dot: string; badge: string; stripe: string; label: string }
> = {
  blocking: {
    dot: 'bg-red-500',
    badge: 'bg-red-500/10 text-red-700 dark:text-red-400',
    stripe: 'bg-red-500',
    label: 'Blocking',
  },
  high: {
    dot: 'bg-orange-500',
    badge: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
    stripe: 'bg-orange-500',
    label: 'High',
  },
  medium: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    stripe: 'bg-amber-500',
    label: 'Medium',
  },
  low: {
    dot: 'bg-slate-400',
    badge: 'bg-slate-400/10 text-slate-600 dark:text-slate-400',
    stripe: 'bg-slate-300',
    label: 'Low',
  },
};

export function severityStripe(severity: ExceptionSeverity): string {
  return SEVERITY[severity].stripe;
}

export function SeverityBadge({ severity }: { severity: ExceptionSeverity }) {
  const s = SEVERITY[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.badge}`}
    >
      <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
