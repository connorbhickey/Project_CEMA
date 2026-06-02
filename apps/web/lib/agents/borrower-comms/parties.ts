import { parties } from '@cema/db';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { withRls } from '../../with-rls';

/** A borrower recipient: opaque id + email. Role is not carried downstream (the
 *  query already filtered to borrower/co_borrower), keeping the surface minimal. */
export interface BorrowerRecipient {
  id: string;
  email: string;
}

/**
 * RLS-read the deal's borrower + co_borrower parties that have an email. Both
 * roles are returned (co-borrowers are a distinct role and must be notified).
 */
export async function loadBorrowerParties(
  organizationId: string,
  dealId: string,
): Promise<BorrowerRecipient[]> {
  const rows = await withRls(organizationId, (tx) =>
    tx
      .select({ id: parties.id, email: parties.email })
      .from(parties)
      .where(
        and(
          eq(parties.dealId, dealId),
          inArray(parties.role, ['borrower', 'co_borrower']),
          isNotNull(parties.email),
        ),
      ),
  );
  // Drop empty-string emails the SQL NULL filter does not catch.
  return rows.filter((r): r is BorrowerRecipient => !!r.email && r.email.trim().length > 0);
}
