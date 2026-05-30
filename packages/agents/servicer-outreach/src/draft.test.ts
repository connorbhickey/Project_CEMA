import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  buildOutreachEmailPrompt,
  renderTemplateEmail,
  isLlmConfigured,
  draftOutreachEmail,
} from './draft';
import type { DraftEmailInput } from './draft';

const input: DraftEmailInput = {
  servicerName: 'Acme Servicing LLC',
  touchNumber: 1,
  dealReference: 'deal-abc-123',
};

describe('renderTemplateEmail', () => {
  it('produces a subject + body that name the deal reference', () => {
    const { subject, body } = renderTemplateEmail(input);
    expect(subject).toMatch(/collateral file/i);
    expect(body).toContain('deal-abc-123');
  });

  it('uses a neutral salutation when servicerName is null', () => {
    const { body } = renderTemplateEmail({ ...input, servicerName: null });
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain('null');
  });

  it('escalates wording on later follow-ups', () => {
    const first = renderTemplateEmail({ ...input, touchNumber: 1 }).body;
    const fourth = renderTemplateEmail({ ...input, touchNumber: 4 }).body;
    expect(fourth).not.toBe(first);
  });
});

describe('buildOutreachEmailPrompt', () => {
  it('includes the deal reference and instructs B2B tone, no legal advice', () => {
    const prompt = buildOutreachEmailPrompt(input);
    expect(prompt).toContain('deal-abc-123');
    expect(prompt).toMatch(/do not (give|offer|provide) legal advice/i);
  });
});

describe('isLlmConfigured', () => {
  const original = process.env.AI_GATEWAY_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = original;
  });
  it('is false when AI_GATEWAY_API_KEY is unset', () => {
    delete process.env.AI_GATEWAY_API_KEY;
    expect(isLlmConfigured()).toBe(false);
  });
  it('is true when AI_GATEWAY_API_KEY is set', () => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    expect(isLlmConfigured()).toBe(true);
  });
});

describe('draftOutreachEmail (unconfigured)', () => {
  const original = process.env.AI_GATEWAY_API_KEY;
  beforeEach(() => delete process.env.AI_GATEWAY_API_KEY);
  afterEach(() => {
    if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = original;
  });
  it('returns the template when no key is configured (never null)', async () => {
    const out = await draftOutreachEmail(input);
    const tmpl = renderTemplateEmail(input);
    expect(out).toEqual(tmpl);
  });
});

import { generateText } from 'ai';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { context, trace as otelTrace } from '@opentelemetry/api';

vi.mock('ai', () => ({ generateText: vi.fn() }));

describe('draftOutreachEmail (configured but model fails)', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const cm = new AsyncHooksContextManager();
  const original = process.env.AI_GATEWAY_API_KEY;

  beforeEach(() => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    context.setGlobalContextManager(cm.enable());
    otelTrace.setGlobalTracerProvider(provider);
    exporter.reset();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = original;
    cm.disable();
    vi.clearAllMocks();
  });

  it('falls back to the template and records the exception (never throws, never null)', async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error('gateway 500'));
    const out = await draftOutreachEmail(input);
    expect(out).toEqual(renderTemplateEmail(input));
    const spans = exporter.getFinishedSpans();
    const draftSpan = spans.find((s) => s.name === 'outreach.draft_email');
    expect(draftSpan?.attributes['outreach.draft_fallback']).toBe(true);
    expect(Object.keys(draftSpan?.attributes ?? {})).toEqual(
      expect.arrayContaining([
        'gen_ai.request.model',
        'outreach.touch_number',
        'outreach.draft_fallback',
      ]),
    );
  });
});
