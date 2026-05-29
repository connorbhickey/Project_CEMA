import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { generateObject } from 'ai';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { classifyQueryIntent } from './classifier';

vi.mock('ai', () => ({ generateObject: vi.fn() }));

describe('classifyQueryIntent tracing', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  beforeAll(() => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(() => {
    exporter.reset();
    vi.mocked(generateObject).mockReset();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    delete process.env.AI_GATEWAY_API_KEY;
  });

  it('emits search.classify_query with only non-PII attributes', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        intent: 'action',
        confidence: 0.92,
        entities: [{ value: 'Acme Holdings LLC', type: 'org' }],
      },
    } as never);

    const query = 'call the borrower at Acme Holdings LLC tomorrow';
    const result = await classifyQueryIntent(query);
    expect(result.intent).toBe('action');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span?.name).toBe('search.classify_query');
    expect(span?.attributes['gen_ai.request.model']).toBe('anthropic/claude-sonnet-4.6');
    expect(span?.attributes['search.intent']).toBe('action');
    expect(span?.attributes['search.confidence']).toBe(0.92);

    // Exactly the three vetted keys — nothing else.
    expect(new Set(Object.keys(span?.attributes ?? {}))).toEqual(
      new Set(['gen_ai.request.model', 'search.intent', 'search.confidence']),
    );

    // PII guard: neither the raw query nor any extracted entity value may appear
    // as an attribute value (spans are logs — hard rule #3).
    for (const value of Object.values(span?.attributes ?? {}).map(String)) {
      expect(value.includes(query)).toBe(false);
      expect(value.includes('Acme Holdings LLC')).toBe(false);
    }
  });

  it('short-circuits an empty query without opening a span', async () => {
    const result = await classifyQueryIntent('   ');
    expect(result).toEqual({ intent: 'search', confidence: 1, entities: [] });
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    expect(vi.mocked(generateObject)).not.toHaveBeenCalled();
  });
});
