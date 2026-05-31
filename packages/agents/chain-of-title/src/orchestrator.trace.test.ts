import { context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runChainOfTitle } from './orchestrator';
import type { ChainDeps, InstrumentRecord } from './types';

const ALLOWED_ATTR_KEYS = new Set([
  'chain.deal_id',
  'chain.status',
  'chain.edge_count',
  'chain.break_count',
  'chain.re_chase_count',
  'chain.attorney_review_count',
]);

const ORCHESTRATOR_SPANS = new Set([
  'chain.run',
  'chain.load_instruments',
  'chain.emit_analyzed',
  'chain.route',
]);

// PII that must never appear in any span attribute value.
const PII_ASSIGNOR = 'Old Servicer LLC';
const PII_ASSIGNEE = 'New Bank NA';

const REC = (crfn: string) => ({ reelPage: null, crfn });
const baseInst = {
  assignor: null,
  assignee: null,
  executedAt: null,
  recordedAt: null,
  amount: null,
  county: null,
  references: null,
};

describe('runChainOfTitle tracing', () => {
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
    // A fork sharing a PII assignor forces the chain.route span to run.
    const instruments: InstrumentRecord[] = [
      { ...baseInst, documentId: 'm1', instrumentKind: 'mortgage', recordingRef: REC('c-m1') },
      {
        ...baseInst,
        documentId: 'a1',
        instrumentKind: 'aom',
        assignor: PII_ASSIGNOR,
        assignee: PII_ASSIGNEE,
        recordedAt: '2026-01-01',
        recordingRef: REC('c-a1'),
      },
      {
        ...baseInst,
        documentId: 'a2',
        instrumentKind: 'aom',
        assignor: PII_ASSIGNOR,
        assignee: 'Third Bank',
        recordedAt: '2026-02-01',
        recordingRef: REC('c-a2'),
      },
    ];
    const deps: ChainDeps = {
      loadInstruments: () => Promise.resolve(instruments),
      routeReChase: () => Promise.resolve(),
      openAttorneyReview: () => Promise.resolve(),
      emitAudit: () => Promise.resolve(),
    };

    await runChainOfTitle('deal-1', deps);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.some((s) => s.name === 'chain.route')).toBe(true);

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
