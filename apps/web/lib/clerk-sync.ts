import type { Database } from '@cema/db';
import { organizations, users } from '@cema/db';
import type { WebhookEvent } from '@clerk/nextjs/server';

export async function handleClerkWebhook(db: Database, event: WebhookEvent): Promise<void> {
  switch (event.type) {
    case 'organization.created':
    case 'organization.updated': {
      const { id, name, slug } = event.data;
      if (!id || !name || !slug) return;
      await db.insert(organizations).values({ clerkOrgId: id, name, slug }).onConflictDoUpdate({
        target: organizations.clerkOrgId,
        set: { name, slug },
      });
      break;
    }
    case 'user.created':
    case 'user.updated': {
      const { id, email_addresses, first_name, last_name } = event.data;
      const email = email_addresses?.[0]?.email_address;
      if (!id || !email) return;
      const fullName = [first_name, last_name].filter(Boolean).join(' ') || null;
      await db.insert(users).values({ clerkUserId: id, email, fullName }).onConflictDoUpdate({
        target: users.clerkUserId,
        set: { email, fullName },
      });
      break;
    }
    default:
      return;
  }
}
