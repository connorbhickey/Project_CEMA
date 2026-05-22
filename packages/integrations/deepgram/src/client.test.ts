import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { submitBatch } from './client';

const VALID_INPUT = {
  audioUrl: 'https://storage.example.com/recordings/call-abc.wav',
  model: 'nova-3-general' as const,
  callbackUrl: 'https://app.example.com/api/webhooks/deepgram',
  options: {
    punctuate: true,
    diarize: true,
    smart_format: true,
    paragraphs: true,
  },
};

describe('submitBatch', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    process.env.DEEPGRAM_API_KEY = 'test-dg-key';
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DEEPGRAM_API_KEY;
  });

  it('returns the requestId from the Deepgram response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ request_id: 'dg-req-xyz' }), { status: 200 }),
    );

    const result = await submitBatch(VALID_INPUT);

    expect(result).toEqual({ requestId: 'dg-req-xyz' });
  });

  it('calls the Deepgram listen endpoint with the audio URL in the body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ request_id: 'dg-req-xyz' }), { status: 200 }),
    );

    await submitBatch(VALID_INPUT);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://api.deepgram.com/v1/listen');
    const body = JSON.parse(init.body as string) as { url: string };
    expect(body.url).toBe(VALID_INPUT.audioUrl);
  });

  it('passes the callback URL as a query parameter', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ request_id: 'dg-req-xyz' }), { status: 200 }),
    );

    await submitBatch(VALID_INPUT);

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('callback')).toBe(VALID_INPUT.callbackUrl);
  });

  it('passes model and feature flags as query parameters', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ request_id: 'dg-req-xyz' }), { status: 200 }),
    );

    await submitBatch(VALID_INPUT);

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('model')).toBe('nova-3-general');
    expect(parsed.searchParams.get('punctuate')).toBe('true');
    expect(parsed.searchParams.get('diarize')).toBe('true');
    expect(parsed.searchParams.get('smart_format')).toBe('true');
    expect(parsed.searchParams.get('paragraphs')).toBe('true');
  });

  it('sends Authorization header with the API key', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ request_id: 'dg-req-xyz' }), { status: 200 }),
    );

    await submitBatch(VALID_INPUT);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Token test-dg-key');
  });

  it('throws when DEEPGRAM_API_KEY is missing', async () => {
    delete process.env.DEEPGRAM_API_KEY;

    await expect(submitBatch(VALID_INPUT)).rejects.toThrow('DEEPGRAM_API_KEY');
  });

  it('throws on non-2xx response from Deepgram', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    await expect(submitBatch(VALID_INPUT)).rejects.toThrow('Deepgram API error: 401');
  });
});
