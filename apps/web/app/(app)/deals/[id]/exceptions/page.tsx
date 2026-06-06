import type { ExceptionSeverity } from '@cema/agents-exception-triage';
import { notFound } from 'next/navigation';

import { getDeal } from '@/lib/actions/get-deal';
import { getDealExceptions } from '@/lib/agents/exception-triage/get-deal-exceptions';

const SEVERITY_CLASS: Record<ExceptionSeverity, string> = {
  blocking: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-gray-100 text-gray-700',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) notFound();

  const exceptions = await getDealExceptions(id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Exceptions</h1>

      {exceptions.length === 0 ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          No open exceptions on this deal.
        </div>
      ) : (
        <ul className="space-y-2" role="list" aria-label="Deal exceptions">
          {exceptions.map((e) => (
            <li key={e.kind} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASS[e.severity]}`}
                >
                  {e.severity}
                </span>
                <span className="font-medium">{e.kind}</span>
                <span className="text-muted-foreground rounded px-2 py-0.5 text-xs">
                  → {e.route}
                </span>
              </div>
              <p className="text-muted-foreground mt-1">{e.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
