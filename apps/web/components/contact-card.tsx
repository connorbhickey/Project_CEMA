import type { contacts } from '@cema/db';
import type { Route } from 'next';
import Link from 'next/link';

type Contact = typeof contacts.$inferSelect;

interface ContactCardProps {
  contact: Contact;
  identityCount: number;
}

export function ContactCard({ contact, identityCount }: ContactCardProps) {
  return (
    <Link
      href={`/contacts/${contact.id}` as Route}
      className="hover:bg-muted/50 block rounded-lg border bg-white p-4 shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{contact.primaryName ?? '(unnamed)'}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {[contact.primaryEmail, contact.primaryPhone].filter(Boolean).join(' · ') || '—'}
          </p>
          {contact.employer ? (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">{contact.employer}</p>
          ) : null}
        </div>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          {identityCount} {identityCount === 1 ? 'identity' : 'identities'}
        </span>
      </div>
    </Link>
  );
}
