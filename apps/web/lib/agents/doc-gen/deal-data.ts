import { type DealDocGenInput } from '@cema/agents-doc-gen';
import { deals, existingLoans, newLoans, parties, properties } from '@cema/db';
import { and, eq, inArray } from 'drizzle-orm';

import { withRls } from '../../with-rls';

/**
 * RLS-read the data planDocuments needs: the deal (cemaType), its new-loan
 * principal, property county, existing-loan UPBs, and borrower/co_borrower names.
 * Returns null if the deal or its required relations are missing. A mockable seam
 * so the dispatcher test never touches the Drizzle chain.
 */
export async function loadDocGenInput(
  organizationId: string,
  dealId: string,
): Promise<DealDocGenInput | null> {
  return withRls(organizationId, async (tx) => {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    if (!deal || !deal.newLoanId || !deal.propertyId) return null;

    const [newLoan] = await tx
      .select({ principal: newLoans.principal })
      .from(newLoans)
      .where(eq(newLoans.id, deal.newLoanId))
      .limit(1);
    const [property] = await tx
      .select({ county: properties.county })
      .from(properties)
      .where(eq(properties.id, deal.propertyId))
      .limit(1);
    if (!newLoan || !property) return null;

    const loans = await tx
      .select({ id: existingLoans.id, upb: existingLoans.upb })
      .from(existingLoans)
      .where(eq(existingLoans.dealId, dealId));

    const borrowerRows = await tx
      .select({ fullName: parties.fullName })
      .from(parties)
      .where(and(eq(parties.dealId, dealId), inArray(parties.role, ['borrower', 'co_borrower'])));

    return {
      dealId,
      cemaType: deal.cemaType,
      newPrincipal: Number(newLoan.principal),
      existingLoans: loans.map((l) => ({ id: l.id, upb: Number(l.upb) })),
      county: property.county,
      borrowerNames: borrowerRows
        .map((b) => b.fullName)
        .filter((n): n is string => !!n && n.trim().length > 0),
    };
  });
}
