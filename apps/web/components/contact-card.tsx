import type { contacts } from '@cema/db';
import { User } from 'lucide-react';

import { InboxRow } from '@/components/queue/inbox-row';

type Contact = typeof contacts.$inferSelect;

interface ContactCardProps {
  contact: Contact;
  identityCount: number;
}

export function ContactCard({ contact, identityCount }: ContactCardProps) {
  const sub =
    [contact.primaryEmail, contact.primaryPhone, contact.employer].filter(Boolean).join(' · ') ||
    '—';

  const badge = (
    <span className="rounded-full bg-slate-400/10 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
      {identityCount} {identityCount === 1 ? 'identity' : 'identities'}
    </span>
  );

  return (
    <InboxRow
      href={`/contacts/${contact.id}`}
      icon={User}
      iconTint="text-sky-600 dark:text-sky-400"
      iconBg="bg-sky-500/10"
      title={contact.primaryName ?? '(unnamed)'}
      sub={sub}
      badges={badge}
    />
  );
}
