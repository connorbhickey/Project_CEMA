import { withChildSpan } from '@cema/observability';
import { SpanStatusCode, type Span, trace } from '@opentelemetry/api';

import { checkEligibility } from './eligibility';
import { estimateSavings } from './savings';
import type { IntakeDeps, IntakeResult } from './types';

/**
 * Instrumentation scope for the Intake Agent. The package instruments against the
 * `@opentelemetry/api` (no SDK): every span here is a no-op until the host app
 * registers a provider in its `instrumentation.ts` (ADR 0011), so importing this in
 * tests or other consumers adds no behavior.
 */
const tracer = trace.getTracer('@cema/agents-intake');

/**
 * Runs the Intake Agent end-to-end for one application (spec §9.3).
 *
 * The sequence is deliberately a flat chain of awaited collaborators —
 *   adapter.getApplication → checkEligibility → emitAudit → estimateSavings → createDeal
 * — so each `await` is a natural durability boundary that maps 1:1 onto a future
 * Vercel Workflow DevKit `step.run(...)` when we wrap this (plan Decision 1). The
 * core itself stays orchestration-agnostic: no app, DB, Clerk, or LLM imports —
 * every effect arrives through {@link IntakeDeps}.
 *
 * Tracing follows the same shape: a parent `intake.run` span with one child span per
 * awaited I/O boundary (fetch_application, emit_audit, create_deal) — the same three
 * points that will become `step.run(...)`. The deterministic pure steps run inline and
 * surface as parent-span attributes rather than their own spans. Per CLAUDE.md §10.3 /
 * hard rule #3, spans carry only non-PII signal (ids, classifications, rule codes) —
 * never UPB, fees, tax, or net-savings figures.
 *
 * Eligibility and savings are deterministic (legal correctness over LLM judgment);
 * the LLM narrative is additive and lives downstream, never on this path.
 *
 * Audit ownership is split on purpose: this function emits only `intake.evaluated`
 * (for every run, eligible or not, so the decision is always recorded), while the
 * `deal.created` row is owned by `createDeal`, which writes it atomically with the
 * Deal insert. The audit emit happens BEFORE deal creation, so an evaluated
 * decision survives even if the subsequent insert fails.
 */
export async function runIntake(externalId: string, deps: IntakeDeps): Promise<IntakeResult> {
  return tracer.startActiveSpan('intake.run', async (span: Span) => {
    span.setAttribute('intake.external_id', externalId);
    try {
      const application = await withChildSpan(tracer, 'intake.fetch_application', () =>
        deps.adapter.getApplication(externalId),
      );
      span.setAttributes({
        'intake.cema_type': application.cemaType,
        'intake.state': application.state,
        'intake.county': application.county,
        'intake.property_type': application.propertyType,
        'intake.loan_program': application.loanProgram,
        'intake.lien_position': application.lienPosition,
      });

      const eligibility = checkEligibility(application);
      span.setAttribute('intake.eligible', eligibility.eligible);
      span.setAttribute('intake.reasons', eligibility.reasons);

      await withChildSpan(tracer, 'intake.emit_audit', () =>
        deps.emitAudit({
          action: 'intake.evaluated',
          externalId,
          eligible: eligibility.eligible,
          reasons: eligibility.reasons,
        }),
      );

      if (!eligibility.eligible) {
        span.setStatus({ code: SpanStatusCode.OK });
        return { externalId, eligibility, savings: null, dealId: null };
      }

      const savings = estimateSavings(application, deps.rates);
      span.setAttribute('intake.is_placeholder_rate', savings.isPlaceholderRate);

      const { dealId } = await withChildSpan(tracer, 'intake.create_deal', () =>
        deps.createDeal({ application, savings }),
      );
      span.setAttribute('intake.deal_id', dealId);

      span.setStatus({ code: SpanStatusCode.OK });
      return { externalId, eligibility, savings, dealId };
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
