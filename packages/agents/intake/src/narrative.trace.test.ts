import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { generateText } from 'ai';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { draftSavingsNarrative, isLlmConfigured } from './narrative';
import type { NormalizedApplication, SavingsEstimate } from './types';

// Mock the model call (no network) and the prompt builder (no fixture needed —
// the prompt never reaches the span, so its contents are irrelevant to this test).
vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('./prompts/savings-narrative', () => ({
  buildSavingsNarrativePrompt: () => 'PROMPT (carries borrower figures; never reaches a span)',
}));

/** Dollar-field substrings that must never appear as a span attribute key (hard rule #3). */
const FORBIDDEN_KEY_SUBSTRINGS = [
  'existingUpb',
  'existing_upb',
  'newLoanAmount',
  'new_loan_amount',
  'assignedUpb',
  'assigned_upb',
  'appliedRate',
  'applied_rate',
  'taxSaved',
  'tax_saved',
  'fees',
  'netSavings',
  'net_savings',
];

describe('draftSavingsNarrative tracing', () => {
  const exporter = new InMemorySpanExporter();
  // No context manager: a single, self-contained span per call — startActiveSpan
  // still hands the live span to the callback (which is what we assert on).
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  beforeAll(() => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(() => {
    exporter.reset();
    vi.mocked(generateText).mockReset();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    delete process.env.AI_GATEWAY_API_KEY;
  });

  it('reads the gate from AI_GATEWAY_API_KEY', () => {
    expect(isLlmConfigured()).toBe(true);
  });

  it('emits intake.draft_narrative with model + token attributes only', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '  Your CEMA could save you on recording tax.  ',
      usage: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
    } as never);

    const out = await draftSavingsNarrative({} as NormalizedApplication, {} as SavingsEstimate);
    expect(out).toBe('Your CEMA could save you on recording tax.');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span?.name).toBe('intake.draft_narrative');
    expect(span?.attributes['gen_ai.request.model']).toBe('anthropic/claude-sonnet-4.6');
    expect(span?.attributes['gen_ai.usage.input_tokens']).toBe(120);
    expect(span?.attributes['gen_ai.usage.output_tokens']).toBe(60);

    // Key allowlist + dollar-figure denylist.
    const allowed = new Set([
      'gen_ai.request.model',
      'gen_ai.usage.input_tokens',
      'gen_ai.usage.output_tokens',
    ]);
    for (const key of Object.keys(span?.attributes ?? {})) {
      expect(allowed.has(key), `unexpected attribute "${key}"`).toBe(true);
      for (const forbidden of FORBIDDEN_KEY_SUBSTRINGS) {
        expect(key.includes(forbidden), `PII key "${key}"`).toBe(false);
      }
    }
    // The model's output text must never be attached as an attribute value.
    for (const value of Object.values(span?.attributes ?? {}).map(String)) {
      expect(value.includes('save you on recording tax')).toBe(false);
    }
  });

  it('returns null and opens no span when the gate is off', async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const out = await draftSavingsNarrative({} as NormalizedApplication, {} as SavingsEstimate);
    expect(out).toBeNull();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();
    process.env.AI_GATEWAY_API_KEY = 'test-key'; // restore for afterAll symmetry
  });
});
