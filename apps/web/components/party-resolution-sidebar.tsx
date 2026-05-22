import type { contacts } from '@cema/db';
import type { Route } from 'next';
import Link from 'next/link';

type Contact = typeof contacts.$inferSelect;

interface PartyResolutionSidebarProps {
  matches: Contact[];
  rawEmails: string[];
  rawPhones: string[];
}

export function PartyResolutionSidebar({
  matches,
  rawEmails,
  rawPhones,
}: PartyResolutionSidebarProps) {
  return (
    <aside className="rounded-lg border bg-white p-4 shadow-sm">
      <h3 className="text-sm font-medium">Linked contacts</h3>

      {matches.length > 0 ? (
        <ul className="mt-3 space-y-2" role="list">
          {matches.map((c) => (
            <li key={c.id}>
              <Link
                href={`/contacts/${c.id}` as Route}
                className="hover:bg-muted/50 block rounded-md border p-2 text-sm"
              >
                <p className="font-medium">{c.primaryName ?? '(unnamed)'}</p>
                <p className="text-muted-foreground text-xs">
                  {c.primaryEmail ?? c.primaryPhone ?? '—'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-2 text-xs">
          No matching contacts. Run the backfill (Task 25) to populate from parties.
        </p>
      )}

      <details className="mt-3">
        <summary className="text-muted-foreground cursor-pointer text-xs">Matched on…</summary>
        <ul className="mt-1 space-y-0.5 text-xs">
          {rawEmails.map((e) => (
            <li key={e} className="text-muted-foreground">
              ✉ {e}
            </li>
          ))}
          {rawPhones.map((p) => (
            <li key={p} className="text-muted-foreground">
              ☎ {p}
            </li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
