import OpenAI from 'openai';
import type { EmbeddingsAdapter } from '../lib/embeddings.js';
import { MemoError } from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

export class OpenAIEmbeddingsAdapter implements EmbeddingsAdapter {
  readonly dimensions = 1536;
  private client: OpenAI;

  constructor() {
    const apiKey = process.env['EMBEDDINGS_API_KEY'];
    if (!apiKey) throw new MemoError('MISSING_CREDENTIAL', 'EMBEDDINGS_API_KEY is required');
    this.client = new OpenAI({ apiKey });
  }

  async embed(text: string): Promise<number[]> {
    try {
      const response = await withRetry(() =>
        this.client.embeddings.create({
          model: 'text-embedding-3-small',
          input: text,
        }),
      );
      const embedding = response.data[0]?.embedding;
      if (!embedding) {
        throw new MemoError('EMBEDDING_API_ERROR', 'Empty embedding response from OpenAI');
      }
      return embedding;
    } catch (err) {
      if (err instanceof MemoError) throw err;
      throw new MemoError(
        'EMBEDDING_API_ERROR',
        `Embedding failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
