import {
  draftSavingsNarrative,
  isLlmConfigured,
  type NormalizedApplication,
  type SavingsEstimate,
} from '@cema/agents-intake';
import { redactPii } from '@cema/compliance';
import { deals } from '@cema/db';
import { eq } from 'drizzle-orm';

import { ERROR_IDS } from '../../constants/error-ids';
import { reportSwallowedError } from '../../observability/report-error';
import { withRls } from '../../with-rls';

export interface DraftNarrativeArgs {
  readonly dealId: string;
  readonly organizationId: string;
  readonly application: NormalizedApplication;
  readonly savings: SavingsEstimate;
  /** Passed in (not computed) so the helper stays deterministic + testable. */
  readonly generatedAt: string;
}

/**
 * Best-effort: draft the borrower-facing CEMA savings narrative (the Intake
 * Agent's ONLY LLM surface) and persist it onto `deals.metadata.savingsNarrative`.
 *
 * The deterministic intake Deal is ALREADY created and complete before this runs,
 * and the narrative is an additive enhancement (plan Decision 3 — never a hard
 * dependency). So this resolves the ADR-0010 #7 decision: a configured-but-failed
 * model call is best-effort (swallowed + routed to Sentry), NOT surfaced to the
 * processor — a model outage must never fail an otherwise-complete intake.
 *
 *  - LLM unconfigured  -> returns false (no narrative; `draftSavingsNarrative`
 *    returns null, which is "off", not "broken").
 *  - configured + threw -> swallow: redacted console line + `reportSwallowedError`
 *    (Sentry + errored span), returns false.
 *  - success            -> persists + returns true.
 *
 * PII (hard rule #3): the narrative text (which contains dollar figures) lives
 * ONLY in `deals.metadata` — the deal's own derived content, like the recording
 * coordinates or a document's extracted field-map — never in a log/audit/span.
 * The swallow path logs only the redacted MODEL error (an API/network failure),
 * never the narrative or any figure.
 */
export async function draftAndStoreSavingsNarrative(args: DraftNarrativeArgs): Promise<boolean> {
  if (!isLlmConfigured()) return false;

  try {
    const text = await draftSavingsNarrative(args.application, args.savings);
    if (!text) return false;

    await withRls(args.organizationId, async (tx) => {
      const [deal] = await tx
        .select({ metadata: deals.metadata })
        .from(deals)
        .where(eq(deals.id, args.dealId))
        .limit(1);
      if (!deal) return;
      await tx
        .update(deals)
        .set({
          metadata: {
            ...deal.metadata,
            savingsNarrative: { text, generatedAt: args.generatedAt },
          },
        })
        .where(eq(deals.id, args.dealId));
    });
    return true;
  } catch (err) {
    const message = redactPii(err instanceof Error ? err.message : String(err));
    // PII-safe + log-injection-safe: redact the WHOLE emitted line (hard rule #3)
    // and strip every CR/LF so an untrusted value cannot forge a second log entry.
    // The redact+replace MUST stay INLINE at the console.error sink — the
    // quantifier-free /[\r\n]/g is the form CodeQL recognizes as a js/log-injection
    // sanitizer (mirrors notify-internal.ts).
    // eslint-disable-next-line no-console
    console.error(
      redactPii(
        `[${ERROR_IDS.INTAKE_NARRATIVE_FAILED}] intake savings narrative draft failed for deal ${args.dealId}: ${message}`,
      ).replace(/[\r\n]/g, ' '),
    );
    reportSwallowedError(ERROR_IDS.INTAKE_NARRATIVE_FAILED, message, { dealId: args.dealId });
    return false;
  }
}
