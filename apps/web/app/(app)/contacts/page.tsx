import { Users } from 'lucide-react';

import { ContactCard } from '@/components/contact-card';
import { listContacts } from '@/lib/actions/list-contacts';

export default async function Page() {
  const rows = await listContacts();

  return (
    <div className="bg-muted -m-6 min-h-full p-5">
      {/* Page header */}
      <div className="mb-5">
        <h1 className="text-foreground text-2xl font-extrabold tracking-tight">Contacts</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {rows.length === 0 ? (
            'Contacts are extracted from parties, calls, emails, and Slack messages.'
          ) : (
            <>
              <strong className="text-foreground font-semibold tabular-nums">{rows.length}</strong>{' '}
              {rows.length === 1 ? 'contact' : 'contacts'}
            </>
          )}
        </p>
      </div>

      {/* Inbox card */}
      <div
        role="list"
        aria-label="Contacts"
        className="bg-card border-border overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(16,33,63,.05),0_4px_12px_rgba(16,33,63,.04)]"
      >
        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          rows.map(({ contact, identityCount }) => (
            <ContactCard key={contact.id} contact={contact} identityCount={identityCount} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="bg-muted mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
        <Users className="h-6 w-6 text-teal-600 dark:text-teal-400" strokeWidth={1.5} />
      </div>
      <p className="text-foreground text-sm font-semibold">No contacts yet</p>
      <p className="text-muted-foreground mt-1 text-[12.5px]">
        Contacts are extracted from parties, calls, emails, and Slack messages.
      </p>
    </div>
  );
}
