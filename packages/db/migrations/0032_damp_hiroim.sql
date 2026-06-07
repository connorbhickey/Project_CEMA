-- Org-integrity for contact_identities: an identity's organization_id MUST match
-- its contact's organization_id. Enforced via a COMPOSITE foreign key onto a new
-- UNIQUE(id, organization_id) on contacts (Postgres cannot CHECK across tables).
-- Replaces the old single-column contact_id FK; cascade preserves delete-with-contact.
--
-- ORDER MATTERS: the UNIQUE target must exist before the composite FK references it,
-- so this is hand-ordered (drizzle-kit emitted the FK before its target).
ALTER TABLE "contact_identities" DROP CONSTRAINT "contact_identities_contact_id_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_id_organization_id_key" UNIQUE("id","organization_id");
--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_org_fk" FOREIGN KEY ("contact_id","organization_id") REFERENCES "public"."contacts"("id","organization_id") ON DELETE cascade ON UPDATE no action;
