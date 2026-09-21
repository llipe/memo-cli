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
  /** Present only when the scroll was called with `{ withVector: true }` (#62 AC4). */
  vector?: number[];
}

export interface ScrollOptions {
  /** Includes the stored vector on every returned point (#62 AC4/AC5). Default `false`. */
  withVector?: boolean;
}

/**
 * `rationale` and `files_modified` text indexes per #62 AC2, sub-task 6.1:
 * verified live against Qdrant 1.18.2 that a `text` index on an array field
 * tokenizes each element independently (a query matching a token present in
 * only one array element still matches; a token present in neither element
 * does not) - so both fields are indexed, no rationale-only fallback needed.
 */
const TEXT_INDEX_SCHEMA = {
  type: 'text',
  tokenizer: 'word',
  lowercase: true,
  min_token_len: 2,
  max_token_len: 20,
} as const;

const PAYLOAD_INDEXES = [
  { field: 'repo', schema: 'keyword' },
  { field: 'org', schema: 'keyword' },
  { field: 'entry_type', schema: 'keyword' },
  { field: 'source', schema: 'keyword' },
  { field: 'tags', schema: 'keyword' },
  { field: 'timestamp_utc', schema: 'datetime' },
  { field: 'commit', schema: 'keyword' },
  { field: 'dedupe_key_sha256', schema: 'keyword' },
  { field: 'rationale', schema: TEXT_INDEX_SCHEMA },
  { field: 'files_modified', schema: TEXT_INDEX_SCHEMA },
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

  /**
   * Creates `field_name`/`field_schema` payload indexes for every entry in
   * `PAYLOAD_INDEXES` not already present in `existingFields` (#62 AC1,
   * sub-tasks 6.2-6.3). Additive only - never touches an existing index or
   * any stored point.
   */
  private async createMissingIndexes(existingFields: ReadonlySet<string>): Promise<void> {
    const missing = PAYLOAD_INDEXES.filter(({ field }) => !existingFields.has(field));
    for (const { field, schema } of missing) {
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: field,
        field_schema: schema,
      });
    }
    if (missing.length > 0) {
      debugLog(
        `ensureIndexes: created ${String(missing.length)} missing index(es) on ${this.collectionName}: ${missing.map((m) => m.field).join(', ')}`,
      );
    } else {
      debugLog(`ensureIndexes: no missing indexes on ${this.collectionName}`);
    }
  }

  /**
   * Reconciles `PAYLOAD_INDEXES` against the collection's current
   * `payload_schema` and creates only what is missing (#62 AC1). Idempotent
   * and safe to call on every `memo search`/`memo write` invocation and on a
   * pre-existing collection created by an earlier memo-cli version (AC11).
   */
  async ensureIndexes(): Promise<void> {
    try {
      const info = await this.client.getCollection(this.collectionName);
      const payloadSchema = (info as { payload_schema?: Record<string, unknown> }).payload_schema;
      const existingFields = new Set(Object.keys(payloadSchema ?? {}));
      await this.createMissingIndexes(existingFields);
    } catch (err) {
      if (err instanceof MemoError) throw err;
      throw new MemoError(
        'COLLECTION_BOOTSTRAP_FAILED',
        `Failed to ensure indexes: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async ensureCollection(): Promise<void> {
    try {
      let info: { payload_schema?: Record<string, unknown> } | null = null;
      try {
        info = await this.client.getCollection(this.collectionName);
      } catch {
        info = null;
      }

      if (!info) {
        await this.client.createCollection(this.collectionName, {
          vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
        });
        debugLog(`ensureCollection: created collection ${this.collectionName}`);
        await this.createMissingIndexes(new Set());
      } else {
        debugLog(`ensureCollection: collection ${this.collectionName} already exists`);
        await this.createMissingIndexes(new Set(Object.keys(info.payload_schema ?? {})));
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

  async scroll(
    filter?: QdrantFilter,
    limit = 100,
    options: ScrollOptions = {},
  ): Promise<ScrollResult[]> {
    try {
      const result = await withRetry(() =>
        this.client.scroll(this.collectionName, {
          filter,
          limit,
          with_payload: true,
          with_vector: options.withVector ?? false,
          order_by: { key: 'timestamp_utc', direction: 'desc' },
        }),
      );
      return (
        result as {
          points: {
            id: string | number;
            payload?: Record<string, unknown> | null;
            vector?: number[] | null;
          }[];
        }
      ).points.map((p) => ({
        id: p.id,
        payload: p.payload ?? undefined,
        ...(options.withVector && Array.isArray(p.vector) ? { vector: p.vector } : {}),
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
