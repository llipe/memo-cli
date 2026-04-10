import { MemoError } from './errors.js';
import { OpenAIEmbeddingsAdapter } from '../adapters/openai-embeddings.js';

export interface EmbeddingsAdapter {
  embed(text: string): Promise<number[]>;
  readonly dimensions: number;
}

export function createEmbeddingsAdapter(): EmbeddingsAdapter {
  const provider = process.env['EMBEDDINGS_PROVIDER'] ?? 'openai';
  if (provider === 'openai') {
    return new OpenAIEmbeddingsAdapter();
  }
  throw new MemoError('MISSING_CREDENTIAL', `Unknown embeddings provider: ${provider}`);
}
