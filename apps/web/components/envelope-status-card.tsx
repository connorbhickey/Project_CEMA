import type { docusignEnvelopes } from '@cema/db';

type Envelope = typeof docusignEnvelopes.$inferSelect;

const STATUS_PILL: Record<string, string> = {
  created: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  delivered: 'bg-yellow-100 text-yellow-700',
  signed: 'bg-green-100 text-green-700',
  completed: 'bg-green-200 text-green-800',
  declined: 'bg-red-100 text-red-700',
  voided: 'bg-gray-200 text-gray-500 line-through',
};

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function EnvelopeStatusCard({ envelope }: { envelope: Envelope }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{envelope.subject ?? '(no subject)'}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Sent {formatDate(envelope.sentAt)} · {envelope.recipients?.length ?? 0} recipient(s)
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_PILL[envelope.status] ?? 'bg-gray-100 text-gray-600'}`}
        >
          {envelope.status}
        </span>
      </div>

      <ul className="mt-3 space-y-1">
        {(envelope.recipients ?? []).map((r) => (
          <li key={r.email} className="text-muted-foreground flex justify-between text-xs">
            <span>
              {r.name} ({r.email})
            </span>
            <span className="capitalize">
              {r.status}
              {r.signedAt ? ` · ${formatDate(new Date(r.signedAt))}` : ''}
            </span>
          </li>
        ))}
      </ul>

      {envelope.status === 'voided' && envelope.voidedReason ? (
        <p className="mt-2 text-xs text-red-700">Voided: {envelope.voidedReason}</p>
      ) : null}
    </div>
  );
}
