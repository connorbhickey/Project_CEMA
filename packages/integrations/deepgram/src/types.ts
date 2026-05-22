export interface SubmitBatchOptions {
  punctuate?: boolean;
  diarize?: boolean;
  smart_format?: boolean;
  paragraphs?: boolean;
}

export interface SubmitBatchInput {
  audioUrl: string;
  model: string;
  callbackUrl: string;
  options?: SubmitBatchOptions;
}

export interface SubmitBatchResult {
  requestId: string;
}

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  speaker: number;
}

export interface TranscriptParagraph {
  text: string;
  start: number;
  end: number;
  speaker: number;
}

export interface NormalizedTranscript {
  language: string;
  confidence: number;
  words: TranscriptWord[];
  paragraphs: TranscriptParagraph[];
}
