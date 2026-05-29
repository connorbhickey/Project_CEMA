import { SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { withChildSpan } from './span';

describe('withChildSpan', () => {
  const exporter = new InMemorySpanExporter();
  // No context manager: each test starts one self-contained span and reads it
  // back from the exporter. startActiveSpan still creates + activates the span
  // for the callback; we just don't need parent/child nesting here.
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  let tracer: ReturnType<BasicTracerProvider['getTracer']>;

  beforeAll(() => {
    tracer = provider.getTracer('test');
  });

  afterEach(() => {
    exporter.reset();
  });

  it('runs fn inside a named span and returns its value', async () => {
    const result = await withChildSpan(tracer, 'unit.op', () => Promise.resolve(42));
    expect(result).toBe(42);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('unit.op');
    expect(spans[0]?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('passes the live span to fn so it can set attributes', async () => {
    await withChildSpan(tracer, 'unit.attr', (span) => {
      span.setAttribute('unit.flag', true);
      return Promise.resolve();
    });

    const spans = exporter.getFinishedSpans();
    expect(spans[0]?.attributes['unit.flag']).toBe(true);
  });

  it('records the exception, marks ERROR, ends the span, and rethrows', async () => {
    await expect(
      withChildSpan(tracer, 'unit.boom', () => Promise.reject(new Error('kaboom'))),
    ).rejects.toThrow(/kaboom/);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]?.events.some((e) => e.name === 'exception')).toBe(true);
    expect(spans[0]?.ended).toBe(true);
  });
});
