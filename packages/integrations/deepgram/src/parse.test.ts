import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseTranscriptResponse } from './parse';

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'fixtures', 'nova3-sample.json'), 'utf-8'),
) as unknown;

describe('parseTranscriptResponse', () => {
  it('returns correct confidence from the first alternative', () => {
    const result = parseTranscriptResponse(fixture);
    expect(result.confidence).toBeCloseTo(0.9871, 3);
  });

  it('normalizes words with text, start, end, speaker fields', () => {
    const result = parseTranscriptResponse(fixture);
    expect(result.words).toHaveLength(17);
    expect(result.words[0]).toEqual({ text: 'Hi', start: 0.08, end: 0.24, speaker: 0 });
    expect(result.words[14]).toEqual({ text: 'Sure,', start: 4.64, end: 4.88, speaker: 1 });
  });

  it('uses punctuated_word as text when available', () => {
    const result = parseTranscriptResponse(fixture);
    // "bank" has punctuated_word "bank."
    const bankWord = result.words.find((w) => w.text === 'bank.');
    expect(bankWord).toBeDefined();
  });

  it('normalizes paragraphs with text, start, end, speaker fields', () => {
    const result = parseTranscriptResponse(fixture);
    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphs[0]).toMatchObject({ start: 0.08, end: 4.0, speaker: 0 });
    expect(result.paragraphs[1]).toMatchObject({ start: 4.64, end: 5.36, speaker: 1 });
  });

  it('derives paragraph text from its sentences', () => {
    const result = parseTranscriptResponse(fixture);
    expect(result.paragraphs[0]!.text).toContain('Hi this is Sarah');
    expect(result.paragraphs[1]!.text).toContain('Sure, go ahead.');
  });

  it('returns empty language string when not present in metadata', () => {
    const result = parseTranscriptResponse(fixture);
    // nova3-sample fixture has no detected_language field → default to empty string
    expect(result.language).toBe('');
  });

  it('throws on malformed input missing results', () => {
    expect(() => parseTranscriptResponse({})).toThrow();
  });

  it('throws on input missing channels', () => {
    expect(() => parseTranscriptResponse({ results: { channels: [] } })).toThrow();
  });
});
