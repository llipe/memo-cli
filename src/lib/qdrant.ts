import { QdrantClient } from '@qdrant/js-client-rest';
import type { Schemas } from '@qdrant/js-client-rest';

export type QdrantFilter = Schemas['QueryRequest']['filter'];
import { MemoError } from './errors.js';
import { withRetry } from './retry.js';
import { debugLog } from './debug.js';

const DEFAULT_COLLECTION_NAME = 'decisions';
const VECTOR_SIZE = 1536;

/** Default page size for `scrollAll` and the chunk size for `batchSetPayload` (#81 AC2/AC5). */
const DEFAULT_SCROLL_ALL_BATCH = 256;
const BATCH_SET_PAYLOAD_CHUNK_SIZE = 256;
const DEFAULT_STALENESS_CORPUS_LIMIT = 1000;

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

/** Ordering directive for `scrollOrdered` (#81 AC3, spec §18.4). */
export interface OrderBySpec {
  key: string;
  direction?: 'asc' | 'desc';
}

export interface ScrollOrderedOptions {
  orderBy: OrderBySpec;
  limit: number;
  /** Includes the stored vector on every returned point. Default `false`. */
  withVector?: boolean;
}

export interface ScrollAllOptions {
  /** Page size forwarded as `limit`. Default `256` (#81 AC2). */
  batch?: number;
  /** Includes the stored vector on every returned point. Default `false`. */
  withVector?: boolean;
}

/** One `{ id, payload }` operation for `batchSetPayload` (#81 AC5). */
export interface SetPayloadOp {
  id: string | number;
  payload: Record<string, unknown>;
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
  // Phase 2 (S2-02, issue #81, spec §18.4): twelve v2 filter fields. `entry_type`
  // above is already indexed and reused unchanged by v2 filters.
  { field: 'bank', schema: 'keyword' },
  { field: 'kind', schema: 'keyword' },
  { field: 'session_id', schema: 'keyword' },
  { field: 'contexts', schema: 'keyword' },
  { field: 'seq', schema: 'integer' },
  { field: 'archived', schema: 'bool' },
  { field: 'superseded', schema: 'bool' },
  { field: 'consolidated', schema: 'bool' },
  { field: 'pinned', schema: 'bool' },
  { field: 'valid_to', schema: 'datetime' },
  { field: 'expires_at', schema: 'datetime' },
  { field: 'archived_at', schema: 'datetime' },
  // S2-07 (issue #86): `memo recall`'s CONFLICTS section filters on this
  // field directly (spec §18.9: `scroll({ bank, pending_contradiction: true
  // }, 5)`) - discovered missing from the S2-02 twelve-index list during
  // this story's live manual validation (a strict-mode Qdrant cluster
  // rejects a filter on an unindexed field with 400 Bad Request).
  { field: 'pending_contradiction', schema: 'bool' },
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
   * Fetches the staleness-detection corpus (#81 AC6, spec §18.4/A12;
   * refactored per the S2-02 Audit Mode drift finding D-2, issue #82 task
   * 3.7): the caller builds `base` via `src/lib/filters.ts`'s
   * `buildBaseFilter` (plus a `repo` any-match clause when `bank = 'kb'`,
   * merged in via `mergeFilters`) and this method applies it verbatim -
   * it no longer derives its own private copy of the §8.1 bank/repo shape.
   * This guarantees the staleness corpus can never silently diverge from
   * the same base filter every other read path uses (S2-05 AC4). Ordered
   * by `timestamp_utc` desc via the underlying `scroll()`, same as
   * `fetchByRepo`.
   */
  async fetchStalenessCorpus(
    base: QdrantFilter,
    limit = DEFAULT_STALENESS_CORPUS_LIMIT,
  ): Promise<ScrollResult[]> {
    return this.scroll(base, limit);
  }

  /**
   * Returns a single ordered page (#81 AC3, spec §18.4): sends `order_by`
   * and never sends `offset` - Qdrant rejects `offset` alongside `order_by`
   * (decision A11), so this method can never auto-continue to a further
   * page even when the response's `next_page_offset` is non-null. Callers
   * that need pagination over an ordered scan pass `order_by.start_from`
   * (unused by any Phase 2 caller - `timeline --last` is a single bounded
   * page). Requires a payload index on `orderBy.key`.
   */
  async scrollOrdered(
    filter: QdrantFilter | undefined,
    options: ScrollOrderedOptions,
  ): Promise<ScrollResult[]> {
    try {
      const result = await withRetry(() =>
        this.client.scroll(this.collectionName, {
          filter,
          limit: options.limit,
          with_payload: true,
          with_vector: options.withVector ?? false,
          order_by: options.orderBy,
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
   * Streams every page of an unordered full-collection scan (#81 AC2, spec
   * §18.4): sends no `order_by` (Qdrant rejects `offset` alongside
   * `order_by` - decision A11) and pages with `offset: next_page_offset`
   * from the previous response, until `next_page_offset` is `null`.
   * `onPage` is invoked once per non-empty page, in order; a page with zero
   * points is never delivered (this is the mechanism behind the "empty
   * collection -> zero `onPage` calls" edge case, applied uniformly to any
   * zero-length page rather than special-cased only for the first call).
   * Resolves to `undefined` once the loop ends - this is a streaming
   * callback contract, not an accumulate-then-return contract, so a caller
   * (`migrate`, S2-09) can process an arbitrarily large collection without
   * buffering every page's points into memory at once.
   *
   * A client failure mid-loop propagates as `MemoError('QDRANT_OPERATION_FAILED')`,
   * matching every other method's error-mapping convention; pages already
   * delivered via `onPage` are not retried or rolled back.
   */
  async scrollAll(
    filter: QdrantFilter | undefined,
    options: ScrollAllOptions,
    onPage: (page: ScrollResult[]) => void | Promise<void>,
  ): Promise<void> {
    const batch = options.batch ?? DEFAULT_SCROLL_ALL_BATCH;
    let offset: string | number | undefined;
    let hasMore = true;

    while (hasMore) {
      let result: unknown;
      try {
        result = await withRetry(() =>
          this.client.scroll(this.collectionName, {
            filter,
            limit: batch,
            with_payload: true,
            with_vector: options.withVector ?? false,
            ...(offset !== undefined ? { offset } : {}),
          }),
        );
      } catch (err) {
        if (err instanceof MemoError) throw err;
        throw new MemoError(
          'QDRANT_OPERATION_FAILED',
          `Scroll failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const typed = result as {
        points: {
          id: string | number;
          payload?: Record<string, unknown> | null;
          vector?: number[] | null;
        }[];
        next_page_offset?: string | number | null;
      };

      if (typed.points.length > 0) {
        const page: ScrollResult[] = typed.points.map((p) => ({
          id: p.id,
          payload: p.payload ?? undefined,
          ...(options.withVector && Array.isArray(p.vector) ? { vector: p.vector } : {}),
        }));
        await onPage(page);
      }

      const nextOffset = typed.next_page_offset ?? null;
      hasMore = nextOffset !== null;
      offset = hasMore && nextOffset !== null ? nextOffset : undefined;
    }
  }

  /**
   * Counts points matching `filter` (#81 AC4, spec §18.4): always requests
   * an exact count (`exact: true`), never the faster approximate count.
   */
  async count(filter?: QdrantFilter): Promise<number> {
    try {
      const result = await withRetry(() =>
        this.client.count(this.collectionName, { filter, exact: true }),
      );
      return result.count;
    } catch (err) {
      if (err instanceof MemoError) throw err;
      throw new MemoError(
        'QDRANT_OPERATION_FAILED',
        `Count failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Overwrites the payload of a single point (#81 AC5, spec §18.4). */
  async setPayload(id: string | number, payload: Record<string, unknown>): Promise<void> {
    try {
      await withRetry(() =>
        this.client.setPayload(this.collectionName, {
          points: [id],
          payload,
          wait: true,
        }),
      );
    } catch (err) {
      if (err instanceof MemoError) throw err;
      throw new MemoError(
        'QDRANT_OPERATION_FAILED',
        `Set payload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Overwrites the payload of many points in one logical call (#81 AC5,
   * spec §18.4): chunks `ops` at `256` operations per `batchUpdate` call
   * (Qdrant/HTTP payload-size hygiene, matching the story's documented
   * chunk size) and issues the chunks sequentially, preserving input order.
   * `batchSetPayload([])` is a no-op - no `batchUpdate` call is made.
   */
  async batchSetPayload(ops: SetPayloadOp[]): Promise<void> {
    if (ops.length === 0) return;
    try {
      for (let i = 0; i < ops.length; i += BATCH_SET_PAYLOAD_CHUNK_SIZE) {
        const chunk = ops.slice(i, i + BATCH_SET_PAYLOAD_CHUNK_SIZE);
        await withRetry(() =>
          this.client.batchUpdate(this.collectionName, {
            wait: true,
            operations: chunk.map((op) => ({
              set_payload: { points: [op.id], payload: op.payload },
            })),
          }),
        );
      }
    } catch (err) {
      if (err instanceof MemoError) throw err;
      throw new MemoError(
        'QDRANT_OPERATION_FAILED',
        `Batch set payload failed: ${err instanceof Error ? err.message : String(err)}`,
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
