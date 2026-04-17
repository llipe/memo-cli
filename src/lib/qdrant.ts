import { QdrantClient } from '@qdrant/js-client-rest';
import type { Schemas } from '@qdrant/js-client-rest';

export type QdrantFilter = Schemas['SearchRequest']['filter'];
import { MemoError } from './errors.js';
import { withRetry } from './retry.js';
import { debugLog } from './debug.js';

const COLLECTION_NAME = 'decisions';
const VECTOR_SIZE = 1536;

export interface SearchResult {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
}

export interface ScrollResult {
  id: string | number;
  payload?: Record<string, unknown>;
}

const PAYLOAD_INDEXES = [
  { field: 'repo', schema: 'keyword' },
  { field: 'org', schema: 'keyword' },
  { field: 'entry_type', schema: 'keyword' },
  { field: 'source', schema: 'keyword' },
  { field: 'tags', schema: 'keyword' },
  { field: 'timestamp_utc', schema: 'datetime' },
  { field: 'commit', schema: 'keyword' },
  { field: 'dedupe_key_sha256', schema: 'keyword' },
] as const;

export class QdrantRepository {
  private client: QdrantClient;

  constructor(qdrantUrl?: string, apiKey?: string) {
    const url = qdrantUrl ?? process.env['QDRANT_URL'];
    if (!url) throw new MemoError('MISSING_CREDENTIAL', 'QDRANT_URL is required');
    this.client = new QdrantClient({ url, apiKey: apiKey ?? process.env['QDRANT_API_KEY'] });
  }

  async ensureCollection(): Promise<void> {
    try {
      let exists = false;
      try {
        await this.client.getCollection(COLLECTION_NAME);
        exists = true;
      } catch {
        exists = false;
      }

      if (!exists) {
        await this.client.createCollection(COLLECTION_NAME, {
          vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
        });

        for (const { field, schema } of PAYLOAD_INDEXES) {
          await this.client.createPayloadIndex(COLLECTION_NAME, {
            field_name: field,
            field_schema: schema,
          });
        }

        debugLog(
          `ensureCollection: created collection ${COLLECTION_NAME} with ${String(PAYLOAD_INDEXES.length)} indexes`,
        );
      } else {
        debugLog(`ensureCollection: collection ${COLLECTION_NAME} already exists`);
      }
    } catch (err) {
      if (err instanceof MemoError) throw err;
      throw new MemoError(
        'COLLECTION_BOOTSTRAP_FAILED',
        `Failed to bootstrap collection: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async upsert(id: string, vector: number[], payload: Record<string, unknown>): Promise<void> {
    try {
      await withRetry(() =>
        this.client.upsert(COLLECTION_NAME, {
          wait: true,
          points: [{ id, vector, payload }],
        }),
      );
    } catch (err) {
      if (err instanceof MemoError) throw err;
      throw new MemoError(
        'QDRANT_OPERATION_FAILED',
        `Upsert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async search(vector: number[], filter?: QdrantFilter, limit = 10): Promise<SearchResult[]> {
    try {
      const results = await withRetry(() =>
        this.client.search(COLLECTION_NAME, {
          vector,
          filter,
          limit,
          with_payload: true,
        }),
      );
      return (
        results as {
          id: string | number;
          score: number;
          payload?: Record<string, unknown> | null;
        }[]
      ).map((r) => ({
        id: r.id,
        score: r.score,
        payload: r.payload ?? undefined,
      }));
    } catch (err) {
      if (err instanceof MemoError) throw err;
      throw new MemoError(
        'QDRANT_OPERATION_FAILED',
        `Search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async scroll(filter?: QdrantFilter, limit = 100): Promise<ScrollResult[]> {
    try {
      const result = await withRetry(() =>
        this.client.scroll(COLLECTION_NAME, {
          filter,
          limit,
          with_payload: true,
          order_by: { key: 'timestamp_utc', direction: 'desc' },
        }),
      );
      return (
        result as { points: { id: string | number; payload?: Record<string, unknown> | null }[] }
      ).points.map((p) => ({
        id: p.id,
        payload: p.payload ?? undefined,
      }));
    } catch (err) {
      if (err instanceof MemoError) throw err;
      throw new MemoError(
        'QDRANT_OPERATION_FAILED',
        `Scroll failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getByDedupeKey(dedupeKeySha256: string): Promise<ScrollResult | null> {
    const results = await this.scroll(
      { must: [{ key: 'dedupe_key_sha256', match: { value: dedupeKeySha256 } }] },
      1,
    );
    return results[0] ?? null;
  }

  async deleteById(id: string): Promise<void> {
    try {
      const existing = await this.scroll({ must: [{ has_id: [id] }] }, 1);
      if (existing.length === 0) {
        throw new MemoError('ENTRY_NOT_FOUND', `Entry not found: ${id}`);
      }

      await withRetry(() =>
        this.client.delete(COLLECTION_NAME, {
          wait: true,
          points: [id],
        }),
      );
    } catch (err) {
      if (err instanceof MemoError) throw err;
      throw new MemoError(
        'DELETE_FAILED',
        `Delete operation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async deleteByFilter(filter: QdrantFilter): Promise<number> {
    try {
      const existing = await this.scroll(filter, 10_000);
      const count = existing.length;

      if (count === 0) {
        return 0;
      }

      await withRetry(() =>
        this.client.delete(COLLECTION_NAME, {
          wait: true,
          filter: filter as unknown as Schemas['Filter'],
        }),
      );

      return count;
    } catch (err) {
      if (err instanceof MemoError) throw err;
      throw new MemoError(
        'DELETE_FAILED',
        `Delete operation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
