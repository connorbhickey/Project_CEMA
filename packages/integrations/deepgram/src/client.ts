import type { SubmitBatchInput, SubmitBatchResult } from './types';

export async function submitBatch(input: SubmitBatchInput): Promise<SubmitBatchResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY environment variable is required');

  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('callback', input.callbackUrl);
  url.searchParams.set('model', input.model);
  if (input.options?.punctuate !== undefined)
    url.searchParams.set('punctuate', String(input.options.punctuate));
  if (input.options?.diarize !== undefined)
    url.searchParams.set('diarize', String(input.options.diarize));
  if (input.options?.smart_format !== undefined)
    url.searchParams.set('smart_format', String(input.options.smart_format));
  if (input.options?.paragraphs !== undefined)
    url.searchParams.set('paragraphs', String(input.options.paragraphs));

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: input.audioUrl }),
  });

  if (!res.ok) throw new Error(`Deepgram API error: ${res.status}`);

  const data = (await res.json()) as { request_id: string };
  return { requestId: data.request_id };
}
