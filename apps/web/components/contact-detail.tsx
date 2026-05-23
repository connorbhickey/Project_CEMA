import type { contactIdentities, contacts } from '@cema/db';

type Contact = typeof contacts.$inferSelect;
type ContactIdentity = typeof contactIdentities.$inferSelect;

interface ContactDetailProps {
  contact: Contact;
  identities: ContactIdentity[];
}

const KIND_LABEL: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  slack_user: 'Slack user',
  crm_id: 'CRM ID',
};

const SOURCE_LABEL: Record<string, string> = {
  party: 'Party record',
  comm_from: 'Inbound communication',
  comm_to: 'Outbound communication',
  slack_message: 'Slack message',
  manual: 'Manual entry',
};

export function ContactDetail({ contact, identities }: ContactDetailProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{contact.primaryName ?? '(unnamed)'}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {[contact.primaryEmail, contact.primaryPhone].filter(Boolean).join(' · ')}
        </p>
        {contact.employer ? (
          <p className="text-muted-foreground mt-1 text-sm">{contact.employer}</p>
        ) : null}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium">Identities ({identities.length})</h2>
        <ul className="space-y-2" role="list">
          {identities.map((ident) => (
            <li
              key={ident.id}
              className="flex items-center justify-between rounded-lg border bg-white p-3 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {KIND_LABEL[ident.kind] ?? ident.kind}: {ident.rawValue ?? ident.normalizedValue}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  From {SOURCE_LABEL[ident.source] ?? ident.source}
                  {ident.confidence < 1 ? ` · confidence ${ident.confidence.toFixed(2)}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
