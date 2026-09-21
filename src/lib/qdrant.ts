import { QdrantClient } from '@qdrant/js-client-rest';
import type { Schemas } from '@qdrant/js-client-rest';

export type QdrantFilter = Schemas['QueryRequest']['filter'];
import { MemoError } from './errors.js';
import { withRetry } from './retry.js';
import { debugLog } from './debug.js';

const DEFAULT_COLLECTION_NAME = 'decisions';
const VECTOR_SIZE = 1536;

/**
 * Resolves the effective collection name from `MEMO_COLLECTION`.
 *
 * `MEMO_COLLECTION` is a test/eval affordance (not a product feature): it lets
 * `scripts/eval-relevance.ts` target an isolated `memo_eval` collection so
 * seeding fixture data can never land in the production `decisions`
 * collection. An unset or empty/whitespace-only value falls back to the
 * documented default `decisions` rather than being sent to Qdrant literally.
 */
function resolveCollectionName(envValue: string | undefined): string {
  if (envValue === undefined || envValue.trim().length === 0) {
    return DEFAULT_COLLECTION_NAME;
  }
  return envValue;
}

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
  private readonly resolvedCollectionName: string;

  constructor(qdrantUrl?: string, apiKey?: string) {
    const url = qdrantUrl ?? process.env['QDRANT_URL'];
    if (!url) throw new MemoError('MISSING_CREDENTIAL', 'QDRANT_URL is required');
    this.client = new QdrantClient({ url, apiKey: apiKey ?? process.env['QDRANT_API_KEY'] });
    // Read once at construction so a later mutation of the env var never
    // changes which collection an already-constructed repository targets.
    this.resolvedCollectionName = resolveCollectionName(process.env['MEMO_COLLECTION']);
  }

  /** The effective collection name this repository targets (see `resolveCollectionName`). */
  get collectionName(): string {
    return this.resolvedCollectionName;
  }

  async ensureCollection(): Promise<void> {
    try {
      let exists = false;
      try {
        await this.client.getCollection(this.collectionName);
        exists = true;
      } catch {
        exists = false;
      }

      if (!exists) {
        await this.client.createCollection(this.collectionName, {
          vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
        });

        for (const { field, schema } of PAYLOAD_INDEXES) {
          await this.client.createPayloadIndex(this.collectionName, {
            field_name: field,
            field_schema: schema,
          });
        }

        debugLog(
          `ensureCollection: created collection ${this.collectionName} with ${String(PAYLOAD_INDEXES.length)} indexes`,
        );
      } else {
        debugLog(`ensureCollection: collection ${this.collectionName} already exists`);
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
        this.client.upsert(this.collectionName, {
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
      const response = await withRetry(() =>
        this.client.query(this.collectionName, {
          query: vector,
          filter,
          limit,
          with_payload: true,
        }),
      );
      return (
        response as {
          points: {
            id: string | number;
            score: number;
            payload?: Record<string, unknown> | null;
          }[];
        }
      ).points.map((r) => ({
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
        this.client.scroll(this.collectionName, {
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

  /**
   * Fetches the corpus used for staleness detection (#38 AC5/AC6): one
   * `scroll` call per `memo search` invocation, filtered to `repos` (the
   * resolved repo scope - a single repo, or the full `--scope related` set),
   * ordered by `timestamp_utc` desc via the underlying `scroll()`.
   *
   * Bounded at `limit` (default `1,000`) - a config-free constant, not
   * user-configurable, documented here rather than exposed as a setting;
   * revisit if a single repo's corpus regularly exceeds this bound.
   */
  async fetchByRepo(repos: string[], limit = 1000): Promise<ScrollResult[]> {
    return this.scroll({ must: [{ key: 'repo', match: { any: repos } }] }, limit);
  }

  async getByDedupeKey(dedupeKeySha256: string): Promise<ScrollResult | null> {
    const results = await this.scroll(
      { must: [{ key: 'dedupe_key_sha256', match: { value: dedupeKeySha256 } }] },
      1,
    );
    return results[0] ?? null;
  }

  async getById(id: string): Promise<ScrollResult | null> {
    const results = await this.scroll({ must: [{ has_id: [id] }] }, 1);
    return results[0] ?? null;
  }

  async deleteById(id: string): Promise<void> {
    try {
      const existing = await this.scroll({ must: [{ has_id: [id] }] }, 1);
      if (existing.length === 0) {
        throw new MemoError('ENTRY_NOT_FOUND', `Entry not found: ${id}`);
      }

      await withRetry(() =>
        this.client.delete(this.collectionName, {
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
        this.client.delete(this.collectionName, {
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
