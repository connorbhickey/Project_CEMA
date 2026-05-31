import { context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCollateralIdp } from './orchestrator';
import type { IdpAdapter, IdpContext } from './types';

const ALLOWED_ATTR_KEYS = new Set([
  'idp.deal_id',
  'idp.document_count',
  'idp.unreadable_count',
  'idp.gate_required_count',
]);

const ORCHESTRATOR_SPANS = new Set([
  'idp.run',
  'idp.load_context',
  'idp.extract_documents',
  'idp.emit_evaluated',
  'idp.persist_documents',
]);

// PII that must never appear in any span attribute value.
const PII_ASSIGNOR = 'Old Servicer LLC';
const PII_ASSIGNEE = 'New Bank NA';

describe('runCollateralIdp tracing', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let ctxManager: AsyncHooksContextManager;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    ctxManager = new AsyncHooksContextManager().enable();
    context.setGlobalContextManager(ctxManager);
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(async () => {
    await provider.shutdown();
    ctxManager.disable();
    context.disable();
  });

  it('emits only allowlisted, PII-free attributes on orchestrator spans', async () => {
    const idp: IdpAdapter = {
      extractDocuments: () =>
        Promise.resolve([
          {
            text: null,
            fields: {
              documentType: 'Assignment of Mortgage',
              assignor: PII_ASSIGNOR,
              assignee: PII_ASSIGNEE,
            },
            confidence: 0.9,
          },
        ]),
    };
    const ctx: IdpContext = {
      dealId: 'deal-1',
      documents: [{ documentId: 'doc-1', blobUrl: 'blob://aom' }],
    };
    const deps = {
      idp,
      loadContext: () => Promise.resolve(ctx),
      persistDocuments: () => Promise.resolve(),
      emitAudit: () => Promise.resolve(),
    };

    await runCollateralIdp('deal-1', deps);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);

    for (const span of spans) {
      if (!ORCHESTRATOR_SPANS.has(span.name)) continue;
      for (const [key, value] of Object.entries(span.attributes)) {
        expect(ALLOWED_ATTR_KEYS.has(key)).toBe(true);
        const serialized = JSON.stringify(value);
        expect(serialized).not.toContain(PII_ASSIGNOR);
        expect(serialized).not.toContain(PII_ASSIGNEE);
      }
    }
  });
});
