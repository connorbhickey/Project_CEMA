const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RlsContext {
  currentOrganizationId: string;
}

/**
 * Returns the SET LOCAL statement that scopes the current transaction
 * to the given organization. The org id is validated as a strict UUID
 * to prevent SQL injection — never interpolate a non-UUID into this.
 *
 * Usage (within a Drizzle transaction or neon tagged-template sql call):
 *   await sql(withRlsContext(orgId));
 *   const deals = await db.select().from(schema.deals);
 */
export function withRlsContext(organizationId: string): string {
  if (!UUID_RE.test(organizationId)) {
    throw new Error(`Invalid organization id (must be UUID): ${organizationId}`);
  }
  return `SET LOCAL app.current_organization_id = '${organizationId}'`;
}

/**
 * Extracts the org id from a typed context envelope (e.g., the Clerk session
 * object or a middleware-built request context).
 */
export function getRlsContext(ctx: RlsContext): { orgId: string } {
  return { orgId: ctx.currentOrganizationId };
}
