import type { NormalizedTranscript, TranscriptParagraph, TranscriptWord } from './types';

interface DgWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
}

interface DgSentence {
  text: string;
  start: number;
  end: number;
}

interface DgParagraph {
  sentences: DgSentence[];
  num_words: number;
  start: number;
  end: number;
  speaker?: number;
}

interface DgAlternative {
  transcript: string;
  confidence: number;
  words: DgWord[];
  paragraphs?: {
    transcript: string;
    paragraphs: DgParagraph[];
  };
}

interface DgChannel {
  alternatives: DgAlternative[];
}

interface DgResults {
  channels: DgChannel[];
  detected_language?: string;
}

interface DgResponse {
  results: DgResults;
}

function isDgResponse(value: unknown): value is DgResponse {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (!r.results || typeof r.results !== 'object') return false;
  const results = r.results as Record<string, unknown>;
  return Array.isArray(results.channels);
}

export function parseTranscriptResponse(deepgramJson: unknown): NormalizedTranscript {
  if (!isDgResponse(deepgramJson)) {
    throw new Error('Invalid Deepgram response: missing results.channels');
  }

  const { results } = deepgramJson;

  if (results.channels.length === 0) {
    throw new Error('Invalid Deepgram response: channels array is empty');
  }

  const channel = results.channels[0]!;

  if (!channel.alternatives || channel.alternatives.length === 0) {
    throw new Error('Invalid Deepgram response: no alternatives in channel');
  }

  const alt = channel.alternatives[0]!;

  const words: TranscriptWord[] = alt.words.map((w) => ({
    text: w.punctuated_word ?? w.word,
    start: w.start,
    end: w.end,
    speaker: w.speaker ?? 0,
  }));

  const paragraphs: TranscriptParagraph[] = (alt.paragraphs?.paragraphs ?? []).map((p) => ({
    text: p.sentences.map((s) => s.text).join(' '),
    start: p.start,
    end: p.end,
    speaker: p.speaker ?? 0,
  }));

  return {
    language: results.detected_language ?? '',
    confidence: alt.confidence,
    words,
    paragraphs,
  };
}
