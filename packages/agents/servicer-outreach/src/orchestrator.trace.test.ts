import { context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, it, vi } from 'vitest';

import { runOutreach } from './orchestrator';
import type { OutreachContext, OutreachDeps, OutreachPacket } from './types';

const ALLOWED_ATTR_KEYS = new Set<string>([
  'outreach.deal_id',
  'outreach.touches_sent',
  'outreach.servicer_identified',
  'outreach.channel',
  'outreach.action',
  'outreach.send_accepted',
]);
const ORCHESTRATOR_SPANS = new Set([
  'outreach.run',
  'outreach.load_context',
  'outreach.emit_planned',
  'outreach.send_touch',
  'outreach.record_touch',
]);

const DEAL = '11111111-1111-1111-1111-111111111111';
const TRIGGER = new Date('2026-06-01T14:00:00.000Z');

function buildContext(): OutreachContext {
  return {
    dealId: DEAL,
    organizationId: '22222222-2222-2222-2222-222222222222',
    servicerName: 'Acme Servicing', // a name -- must NOT land on any span
    departmentEmail: 'cema@acme.example', // an address -- must NOT land on any span
    acceptedSubmissionMethods: ['email'],
    triggeredAt: TRIGGER,
    touchesSent: 0,
    response: null,
  };
}

function buildDeps(ctx: OutreachContext): OutreachDeps {
  return {
    channel: {
      send: vi.fn((_p: OutreachPacket) =>
        Promise.resolve({ accepted: true, channelMessageId: 'fixture:msg' }),
      ),
    },
    loadContext: vi.fn(() => Promise.resolve(ctx)),
    recordTouch: vi.fn(() => Promise.resolve()),
    emitAudit: vi.fn(() => Promise.resolve()),
    now: () => TRIGGER,
  };
}

describe('runOutreach tracing', () => {
  it('opens outreach.run + child spans, carrying only allowlisted, PII-free attributes', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const ctxManager = new AsyncHooksContextManager().enable();
    context.setGlobalContextManager(ctxManager);
    trace.setGlobalTracerProvider(provider);
    try {
      await runOutreach(DEAL, buildDeps(buildContext()));
      const spans = exporter.getFinishedSpans();

      const names = spans.map((s) => s.name);
      expect(names).toContain('outreach.run');
      expect(names).toContain('outreach.load_context');
      expect(names).toContain('outreach.emit_planned');
      expect(names).toContain('outreach.send_touch');
      expect(names).toContain('outreach.record_touch');

      for (const span of spans) {
        // PII-VALUE guarantee applies to EVERY span attribute, no exceptions.
        for (const value of Object.values(span.attributes)) {
          const serialized = JSON.stringify(value);
          expect(serialized).not.toContain('Acme Servicing');
          expect(serialized).not.toContain('cema@acme.example');
        }
        // KEY allowlist applies to the orchestrator's own spans.
        if (ORCHESTRATOR_SPANS.has(span.name)) {
          for (const key of Object.keys(span.attributes)) {
            expect(ALLOWED_ATTR_KEYS.has(key)).toBe(true);
          }
        }
      }

      const run = spans.find((s) => s.name === 'outreach.run')!;
      expect(run.attributes['outreach.deal_id']).toBe(DEAL);
      expect(run.attributes['outreach.action']).toBe('send');
      expect(run.attributes['outreach.send_accepted']).toBe(true);
      expect(run.attributes['outreach.servicer_identified']).toBe(true);
    } finally {
      await provider.shutdown();
      ctxManager.disable();
      context.disable();
    }
  });
});
