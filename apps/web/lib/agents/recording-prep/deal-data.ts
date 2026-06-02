import { type DealRecordingInput } from '@cema/agents-recording-prep';
import { deals, properties } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '../../with-rls';

/**
 * RLS-read the data planRecording needs: the deal (cemaType) + its property
 * (county, acrisBbl). Returns null if the deal or property is missing. A mockable
 * seam (the dispatcher test never touches the Drizzle chain). pageCount is left
 * undefined -- the core applies ESTIMATED_CEMA_PAGE_COUNT.
 */
export async function loadRecordingInput(
  organizationId: string,
  dealId: string,
): Promise<DealRecordingInput | null> {
  return withRls(organizationId, async (tx) => {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    if (!deal || !deal.propertyId) return null;

    const [property] = await tx
      .select({ county: properties.county, acrisBbl: properties.acrisBbl })
      .from(properties)
      .where(eq(properties.id, deal.propertyId))
      .limit(1);
    if (!property) return null;

    return {
      dealId,
      cemaType: deal.cemaType,
      county: property.county,
      acrisBbl: property.acrisBbl,
    };
  });
}
