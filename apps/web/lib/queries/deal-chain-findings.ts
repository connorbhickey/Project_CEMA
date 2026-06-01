import {
  analyzeChain,
  route,
  type ChainStatus,
  type RouteDecision,
} from '@cema/agents-chain-of-title';
import { getCurrentOrganizationId } from '@cema/auth';
import type { InstrumentRecord } from '@cema/collateral';
import { documents, getDb, organizations } from '@cema/db';
import { eq } from 'drizzle-orm';

import { withRls } from '@/lib/with-rls';

export interface DealChainFindings {
  readonly analyzed: boolean;
  readonly status: ChainStatus | null;
  readonly routes: readonly RouteDecision[];
}

const EMPTY: DealChainFindings = { analyzed: false, status: null, routes: [] };

/**
 * Discriminates a real persisted InstrumentRecord from the jsonb column's
 * empty `{}` default. The column never holds `null` (default is `{}` and
 * NOT NULL), so the presence of a string `instrumentKind` is the signal.
 */
export function isInstrumentRecord(value: unknown): value is InstrumentRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'instrumentKind' in value &&
    typeof value.instrumentKind === 'string'
  );
}

/**
 * Recomputes chain-of-title findings for a deal from the InstrumentRecord[]
 * the IDP persisted into documents.extractedData. Pure (no clock, no LLM, no
 * DB write) — Decision 1 of the slice design.
 */
export async function getDealChainFindings(dealId: string): Promise<DealChainFindings> {
  const clerkOrgId = await getCurrentOrganizationId();
  const db = getDb();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  });
  if (!org) return EMPTY;

  return withRls(org.id, async (tx) => {
    const rows = await tx
      .select({ extractedData: documents.extractedData })
      .from(documents)
      .where(eq(documents.dealId, dealId));

    const instruments = rows.map((r): unknown => r.extractedData).filter(isInstrumentRecord);

    // Do NOT analyze an empty chain — analyzeChain([]) reports phantom breaks.
    if (instruments.length === 0) return EMPTY;

    const analysis = analyzeChain(instruments);
    const routes = route(dealId, analysis.breaks);
    return { analyzed: true, status: analysis.status, routes };
  });
}
