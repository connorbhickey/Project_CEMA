export interface EmbedTextInput {
  text: string;
  model?: 'text-embedding-3-large' | 'text-embedding-3-small';
}

export interface EmbedTextResult {
  embedding: number[];
  dimensions: number;
  model: string;
  inputTokens: number;
}
