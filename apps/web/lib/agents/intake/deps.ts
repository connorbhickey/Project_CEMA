import type {
  IntakeAuditEvent,
  IntakeDealInput,
  IntakeDeps,
  LosAdapter,
  RecordingTaxRateTable,
} from '@cema/agents-intake';
import { emitAuditEvent } from '@cema/compliance';
import { deals, existingLoans } from '@cema/db';

import { withRls } from '../../with-rls';

/**
 * Wires the orchestration-agnostic Intake Agent core (`@cema/agents-intake`) to
 * this app's real persistence layer. The agent package carries no DB/Clerk/LLM
 * import (plan Decision 1); this is the seam where its injected collaborators
 * acquire concrete behaviour.
 *
 * Deliberately request-agnostic: it takes already-resolved internal UUIDs, never
 * Clerk handles, and never calls revalidatePath. Those request-context concerns
 * live one layer up in the Server Action, which keeps this factory unit-testable
 * with plain UUIDs against a real Neon branch (see intake-agent-rls.test.ts).
 *
 * Each org-scoped write opens its OWN `withRls` transaction, which preserves the
 * orchestrator's durability boundaries: `emitAudit` commits the `intake.evaluated`
 * decision independently, then `createDeal` opens a separate atomic transaction
 * for the Deal + existing-loan + `deal.created` row. A failure in the second
 * leaves the first durably recorded (the audit-split posture from the core).
 */
export interface BuildIntakeDepsArgs {
  /** Internal organization UUID (already resolved from the Clerk org). */
  organizationId: string;
  /** Internal UUID of the processor who triggered intake — the deal's creator + audit actor. */
  actorUserId: string;
  /** Loan-data surface (FixtureLosAdapter today; Encompass etc. later). */
  adapter: LosAdapter;
  /** Confirmed recording-tax table; omitted → core falls back to PLACEHOLDER_RATES. */
  rates?: RecordingTaxRateTable;
}

export function buildIntakeDeps(args: BuildIntakeDepsArgs): IntakeDeps {
  const { organizationId, actorUserId, adapter, rates } = args;

  const deps: IntakeDeps = {
    adapter,

    // intake.evaluated — emitted for every run (eligible or not). entityId stays
    // null: the column is UUID-typed and no Deal exists yet (and never will for
    // ineligible apps); the LOS externalId is carried in metadata instead.
    emitAudit: (event: IntakeAuditEvent) =>
      withRls(organizationId, (tx) =>
        emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: event.action,
          entityType: 'application',
          metadata: {
            source: 'intake-agent',
            externalId: event.externalId,
            eligible: event.eligible,
            reasons: event.reasons,
          },
        }),
      ),

    // Creates the minimal intake Deal. propertyId/newLoanId are intentionally
    // left null (nullable by schema) — address + funding details are enriched
    // downstream, so the agent never invents them. Owns the atomic deal.created
    // audit row, written inside the same transaction as the inserts.
    createDeal: ({ application, savings }: IntakeDealInput) =>
      withRls(organizationId, async (tx) => {
        const [deal] = await tx
          .insert(deals)
          .values({
            organizationId,
            cemaType: application.cemaType,
            createdById: actorUserId,
            metadata: {
              source: 'intake-agent',
              externalId: application.externalId,
              county: application.county,
              propertyType: application.propertyType,
              loanProgram: application.loanProgram,
              savings: {
                assignedUpb: savings.assignedUpb,
                appliedRate: savings.appliedRate,
                taxSaved: savings.taxSaved,
                fees: savings.fees,
                netSavings: savings.netSavings,
                isPlaceholderRate: savings.isPlaceholderRate,
              },
            },
          })
          .returning();

        // decimal column → string; eligibility guarantees existingUpb > 0.
        await tx.insert(existingLoans).values({
          dealId: deal!.id,
          upb: String(application.existingUpb),
          chainPosition: 0,
        });

        await emitAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: 'deal.created',
          entityType: 'deal',
          entityId: deal!.id,
          metadata: {
            source: 'intake-agent',
            externalId: application.externalId,
            cemaType: application.cemaType,
            netSavings: savings.netSavings,
            isPlaceholderRate: savings.isPlaceholderRate,
          },
        });

        return { dealId: deal!.id };
      }),
  };

  // Conditional assign (not `rates: rates`) to satisfy exactOptionalPropertyTypes,
  // matching the orchestrator test harness.
  if (rates) {
    deps.rates = rates;
  }

  return deps;
}
