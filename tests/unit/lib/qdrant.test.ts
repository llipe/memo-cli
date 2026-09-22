import { QdrantRepository } from '../../../src/lib/qdrant';
import { MemoError } from '../../../src/lib/errors';
import { buildBaseFilter, mergeFilters } from '../../../src/lib/filters';

// Mock withRetry to avoid delays in tests
jest.mock('../../../src/lib/retry', () => ({
  withRetry: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

const mockGetCollection = jest.fn();
const mockCreateCollection = jest.fn();
const mockCreatePayloadIndex = jest.fn();
const mockUpsert = jest.fn();
const mockQuery = jest.fn();
const mockScroll = jest.fn();
const mockDelete = jest.fn();
const mockCount = jest.fn();
const mockSetPayload = jest.fn();
const mockBatchUpdate = jest.fn();

jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({
    getCollection: mockGetCollection,
    createCollection: mockCreateCollection,
    createPayloadIndex: mockCreatePayloadIndex,
    upsert: mockUpsert,
    query: mockQuery,
    scroll: mockScroll,
    delete: mockDelete,
    count: mockCount,
    setPayload: mockSetPayload,
    batchUpdate: mockBatchUpdate,
  })),
}));

describe('QdrantRepository', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, QDRANT_URL: 'http://localhost:6333' };
    delete process.env['MEMO_COLLECTION'];
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('throws MISSING_CREDENTIAL when QDRANT_URL is not set', () => {
      delete process.env['QDRANT_URL'];
      expect(() => new QdrantRepository()).toThrow(MemoError);
    });
  });

  describe('MEMO_COLLECTION resolution', () => {
    it('resolves to the default "decisions" collection when MEMO_COLLECTION is unset', async () => {
      delete process.env['MEMO_COLLECTION'];
      mockGetCollection.mockRejectedValueOnce(new Error('Not found'));
      mockCreateCollection.mockResolvedValueOnce({});
      mockCreatePayloadIndex.mockResolvedValue({});

      const repo = new QdrantRepository('http://localhost:6333');
      expect(repo.collectionName).toBe('decisions');

      await repo.ensureCollection();
      expect(mockCreateCollection).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({ vectors: expect.objectContaining({ size: 1536 }) }),
      );
    });

    it('resolves to the MEMO_COLLECTION value when set', async () => {
      process.env['MEMO_COLLECTION'] = 'memo_eval';
      mockGetCollection.mockRejectedValueOnce(new Error('Not found'));
      mockCreateCollection.mockResolvedValueOnce({});
      mockCreatePayloadIndex.mockResolvedValue({});

      const repo = new QdrantRepository('http://localhost:6333');
      expect(repo.collectionName).toBe('memo_eval');

      await repo.ensureCollection();
      expect(mockCreateCollection).toHaveBeenCalledWith(
        'memo_eval',
        expect.objectContaining({ vectors: expect.objectContaining({ size: 1536 }) }),
      );
    });

    it('treats an empty-string MEMO_COLLECTION as unset and falls back to "decisions"', () => {
      process.env['MEMO_COLLECTION'] = '';
      const repo = new QdrantRepository('http://localhost:6333');
      expect(repo.collectionName).toBe('decisions');
    });

    it('treats a whitespace-only MEMO_COLLECTION as unset and falls back to "decisions"', () => {
      process.env['MEMO_COLLECTION'] = '   ';
      const repo = new QdrantRepository('http://localhost:6333');
      expect(repo.collectionName).toBe('decisions');
    });

    it('is read once at construction and does not change if the env var mutates afterward', () => {
      process.env['MEMO_COLLECTION'] = 'memo_eval';
      const repo = new QdrantRepository('http://localhost:6333');
      process.env['MEMO_COLLECTION'] = 'something-else';
      expect(repo.collectionName).toBe('memo_eval');
    });

    it('scopes upsert/search/scroll calls to the resolved collection name', async () => {
      process.env['MEMO_COLLECTION'] = 'memo_eval';
      mockUpsert.mockResolvedValueOnce({});
      mockQuery.mockResolvedValueOnce({ points: [] });
      mockScroll.mockResolvedValueOnce({ points: [] });

      const repo = new QdrantRepository('http://localhost:6333');
      const vector = Array(1536).fill(0.1) as number[];

      await repo.upsert('id-1', vector, {});
      await repo.search(vector);
      await repo.scroll();

      expect(mockUpsert).toHaveBeenCalledWith('memo_eval', expect.anything());
      expect(mockQuery).toHaveBeenCalledWith('memo_eval', expect.anything());
      expect(mockScroll).toHaveBeenCalledWith('memo_eval', expect.anything());
    });
  });

  describe('ensureCollection()', () => {
    it('creates collection when it does not exist', async () => {
      mockGetCollection.mockRejectedValueOnce(new Error('Not found'));
      mockCreateCollection.mockResolvedValueOnce({});
      mockCreatePayloadIndex.mockResolvedValue({});

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.ensureCollection();

      expect(mockCreateCollection).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({
          vectors: expect.objectContaining({ size: 1536, distance: 'Cosine' }),
        }),
      );
    });

    it('is a no-op when collection exists', async () => {
      mockGetCollection.mockResolvedValueOnce({ config: {} });

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.ensureCollection();

      expect(mockCreateCollection).not.toHaveBeenCalled();
    });
  });

  describe('upsert()', () => {
    it('calls client.upsert with correct parameters', async () => {
      mockUpsert.mockResolvedValueOnce({});

      const repo = new QdrantRepository('http://localhost:6333');
      const vector = Array(1536).fill(0.1) as number[];
      await repo.upsert('my-id', vector, { repo: 'test' });

      expect(mockUpsert).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({
          points: expect.arrayContaining([
            expect.objectContaining({ id: 'my-id', payload: { repo: 'test' } }),
          ]),
        }),
      );
    });
  });

  describe('search()', () => {
    it('calls client.query with filter and limit', async () => {
      mockQuery.mockResolvedValueOnce({
        points: [{ id: '1', score: 0.9, payload: { text: 'hello' } }],
      });

      const repo = new QdrantRepository('http://localhost:6333');
      const vector = Array(1536).fill(0.1) as number[];
      const filter = { must: [] };
      const results = await repo.search(vector, filter, 5);

      expect(mockQuery).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({ filter, limit: 5 }),
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.score).toBe(0.9);
    });
  });

  describe('scroll()', () => {
    it('calls client.scroll with filter, limit, and descending timestamp order', async () => {
      mockScroll.mockResolvedValueOnce({
        points: [{ id: '1', payload: { text: 'hello' } }],
      });

      const repo = new QdrantRepository('http://localhost:6333');
      const filter = { must: [] };
      const results = await repo.scroll(filter, 50);

      expect(mockScroll).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({
          filter,
          limit: 50,
          order_by: { key: 'timestamp_utc', direction: 'desc' },
        }),
      );
      expect(results).toHaveLength(1);
    });

    it('defaults with_vector to false and omits vector from results (#62 AC4/AC5, existing call sites unaffected)', async () => {
      mockScroll.mockResolvedValueOnce({
        points: [{ id: '1', payload: { text: 'hello' } }],
      });

      const repo = new QdrantRepository('http://localhost:6333');
      const results = await repo.scroll({ must: [] }, 50);

      expect(mockScroll).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({ with_vector: false }),
      );
      expect(results[0]).not.toHaveProperty('vector');
    });

    it('passes with_vector: true and attaches the vector when { withVector: true } (#62 AC4/AC5)', async () => {
      mockScroll.mockResolvedValueOnce({
        points: [{ id: '1', payload: { text: 'hello' }, vector: [0.1, 0.2] }],
      });

      const repo = new QdrantRepository('http://localhost:6333');
      const results = await repo.scroll({ must: [] }, 50, { withVector: true });

      expect(mockScroll).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({ with_vector: true }),
      );
      expect(results[0]?.vector).toEqual([0.1, 0.2]);
    });
  });

  const V1_2_0_SHIPPED_FIELDS = {
    repo: {},
    org: {},
    entry_type: {},
    source: {},
    tags: {},
    timestamp_utc: {},
    commit: {},
    dedupe_key_sha256: {},
  };

  const V2_NEW_FIELDS = {
    bank: {},
    kind: {},
    session_id: {},
    contexts: {},
    seq: {},
    archived: {},
    superseded: {},
    consolidated: {},
    pinned: {},
    valid_to: {},
    expires_at: {},
    archived_at: {},
    // S2-07 (#86): added post-S2-02 for `memo recall`'s CONFLICTS filter.
    pending_contradiction: {},
  };

  const V2_NEW_FIELD_NAMES = Object.keys(V2_NEW_FIELDS);

  describe('ensureIndexes()', () => {
    it('reads payload_schema and creates only missing indexes, including the #62 text indexes and the S2-02 v2 indexes', async () => {
      mockGetCollection.mockResolvedValueOnce({
        payload_schema: V1_2_0_SHIPPED_FIELDS,
      });
      mockCreatePayloadIndex.mockResolvedValue({});

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.ensureIndexes();

      // 8 shipped fields present; missing: rationale, files_modified (#62) +
      // 12 new (S2-02) + pending_contradiction (S2-07) = 15.
      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(15);
      expect(mockCreatePayloadIndex).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({
          field_name: 'rationale',
          field_schema: expect.objectContaining({ type: 'text', tokenizer: 'word' }),
        }),
      );
      expect(mockCreatePayloadIndex).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({
          field_name: 'files_modified',
          field_schema: expect.objectContaining({ type: 'text', tokenizer: 'word' }),
        }),
      );
    });

    it('is idempotent: a second call creates nothing once every index exists', async () => {
      const fullSchema = {
        ...V1_2_0_SHIPPED_FIELDS,
        rationale: {},
        files_modified: {},
        ...V2_NEW_FIELDS,
      };
      mockGetCollection.mockResolvedValueOnce({ payload_schema: fullSchema });

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.ensureIndexes();

      expect(mockCreatePayloadIndex).not.toHaveBeenCalled();
    });

    it('throws COLLECTION_BOOTSTRAP_FAILED when the collection cannot be read', async () => {
      mockGetCollection.mockRejectedValue(new Error('Connection refused'));

      const repo = new QdrantRepository('http://localhost:6333');
      await expect(repo.ensureIndexes()).rejects.toMatchObject({
        code: 'COLLECTION_BOOTSTRAP_FAILED',
      });
    });

    // --- Story S2-02 / issue #81 AC1 -----------------------------------------

    it('AC1: on a v1.2.0-shaped schema (10 shipped fields, none of the 13 new), creates exactly the 13 new indexes and none of the 10 existing', async () => {
      mockGetCollection.mockResolvedValueOnce({
        payload_schema: { ...V1_2_0_SHIPPED_FIELDS, rationale: {}, files_modified: {} },
      });
      mockCreatePayloadIndex.mockResolvedValue({});

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.ensureIndexes();

      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(13);
      const createdFieldNames = mockCreatePayloadIndex.mock.calls.map(
        (call) => (call[1] as { field_name: string }).field_name,
      );
      expect(new Set(createdFieldNames)).toEqual(new Set(V2_NEW_FIELD_NAMES));

      const expectedSchemas: Record<string, string> = {
        bank: 'keyword',
        kind: 'keyword',
        session_id: 'keyword',
        contexts: 'keyword',
        seq: 'integer',
        archived: 'bool',
        superseded: 'bool',
        consolidated: 'bool',
        pinned: 'bool',
        valid_to: 'datetime',
        expires_at: 'datetime',
        archived_at: 'datetime',
        pending_contradiction: 'bool',
      };
      for (const call of mockCreatePayloadIndex.mock.calls) {
        const [, { field_name, field_schema }] = call as [
          string,
          { field_name: string; field_schema: string },
        ];
        expect(field_schema).toBe(expectedSchemas[field_name]);
      }
    });

    it('AC1: is idempotent — a second run against the now-fully-reconciled schema creates nothing', async () => {
      mockGetCollection
        .mockResolvedValueOnce({
          payload_schema: { ...V1_2_0_SHIPPED_FIELDS, rationale: {}, files_modified: {} },
        })
        .mockResolvedValueOnce({
          payload_schema: {
            ...V1_2_0_SHIPPED_FIELDS,
            rationale: {},
            files_modified: {},
            ...V2_NEW_FIELDS,
          },
        });
      mockCreatePayloadIndex.mockResolvedValue({});

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.ensureIndexes();
      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(13);

      mockCreatePayloadIndex.mockClear();
      await repo.ensureIndexes();
      expect(mockCreatePayloadIndex).not.toHaveBeenCalled();
    });

    it('AC1: creates exactly the 8 still-missing v2 fields on a partially-migrated schema', async () => {
      mockGetCollection.mockResolvedValueOnce({
        payload_schema: {
          ...V1_2_0_SHIPPED_FIELDS,
          rationale: {},
          files_modified: {},
          bank: {},
          kind: {},
          seq: {},
          archived: {},
          valid_to: {},
        },
      });
      mockCreatePayloadIndex.mockResolvedValue({});

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.ensureIndexes();

      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(8);
      const createdFieldNames = new Set(
        mockCreatePayloadIndex.mock.calls.map(
          (call) => (call[1] as { field_name: string }).field_name,
        ),
      );
      expect(createdFieldNames).toEqual(
        new Set([
          'session_id',
          'contexts',
          'superseded',
          'consolidated',
          'pinned',
          'expires_at',
          'archived_at',
          'pending_contradiction',
        ]),
      );
    });

    it('AC1: treats a missing payload_schema key identically to an empty schema (creates all 23)', async () => {
      mockGetCollection.mockResolvedValueOnce({});
      mockCreatePayloadIndex.mockResolvedValue({});

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.ensureIndexes();

      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(23);
    });
  });

  // S2-05 AC4: `fetchByRepo` no longer exists — superseded by
  // `fetchStalenessCorpus` (see below). Its absence is also a compile-time
  // contract: `repo.fetchByRepo` is a TypeScript error, not just a missing
  // runtime method (CT-3).
  it('AC4 (S2-05): fetchByRepo is not present on QdrantRepository', () => {
    const repo = new QdrantRepository('http://localhost:6333');
    expect((repo as unknown as Record<string, unknown>)['fetchByRepo']).toBeUndefined();
  });

  describe('getByDedupeKey()', () => {
    it('returns null when no results', async () => {
      mockScroll.mockResolvedValueOnce({ points: [] });

      const repo = new QdrantRepository('http://localhost:6333');
      const result = await repo.getByDedupeKey('abc123');

      expect(result).toBeNull();
    });
  });

  describe('getById()', () => {
    it('returns the matching entry when found', async () => {
      mockScroll.mockResolvedValueOnce({
        points: [{ id: 'entry-1', payload: { repo: 'memo-cli' } }],
      });

      const repo = new QdrantRepository('http://localhost:6333');
      const result = await repo.getById('entry-1');

      expect(mockScroll).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({
          filter: { must: [{ has_id: ['entry-1'] }] },
          limit: 1,
        }),
      );
      expect(result).toEqual({ id: 'entry-1', payload: { repo: 'memo-cli' } });
    });

    it('returns null when id does not exist', async () => {
      mockScroll.mockResolvedValueOnce({ points: [] });

      const repo = new QdrantRepository('http://localhost:6333');
      const result = await repo.getById('missing-id');

      expect(result).toBeNull();
    });
  });

  describe('deleteById()', () => {
    it('calls client.delete with points when id exists', async () => {
      mockScroll.mockResolvedValueOnce({ points: [{ id: 'entry-1', payload: {} }] });
      mockDelete.mockResolvedValueOnce({});

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.deleteById('entry-1');

      expect(mockDelete).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({ wait: true, points: ['entry-1'] }),
      );
    });

    it('throws ENTRY_NOT_FOUND when id does not exist', async () => {
      mockScroll.mockResolvedValueOnce({ points: [] });

      const repo = new QdrantRepository('http://localhost:6333');
      await expect(repo.deleteById('missing-id')).rejects.toMatchObject({
        code: 'ENTRY_NOT_FOUND',
      });
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('deleteByFilter()', () => {
    it('calls client.delete with filter and returns deleted count', async () => {
      mockScroll.mockResolvedValueOnce({
        points: [
          { id: 'entry-1', payload: {} },
          { id: 'entry-2', payload: {} },
        ],
      });
      mockDelete.mockResolvedValueOnce({});

      const repo = new QdrantRepository('http://localhost:6333');
      const filter = { must: [{ key: 'repo', match: { value: 'memo-cli' } }] };
      const deleted = await repo.deleteByFilter(filter);

      expect(deleted).toBe(2);
      expect(mockDelete).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({ wait: true, filter }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Story S2-02 (issue #81): scrollOrdered, scrollAll, count, setPayload,
  // batchSetPayload, fetchStalenessCorpus.
  // ---------------------------------------------------------------------------

  describe('scrollOrdered() (#81 AC3)', () => {
    it('CT-2: sends order_by and never an offset, and returns a single page', async () => {
      mockScroll.mockResolvedValueOnce({
        points: [{ id: 'p1', payload: { seq: 3 }, vector: [0.1, 0.2] }],
        next_page_offset: 'more-data-exists',
      });

      const repo = new QdrantRepository('http://localhost:6333');
      const filter = { must: [{ key: 'kind', match: { value: 'episodic' } }] };
      const results = await repo.scrollOrdered(filter, {
        orderBy: { key: 'seq', direction: 'desc' },
        limit: 1,
        withVector: true,
      });

      expect(mockScroll).toHaveBeenCalledTimes(1);
      const [, request] = mockScroll.mock.calls[0] as [string, Record<string, unknown>];
      expect(request['order_by']).toEqual({ key: 'seq', direction: 'desc' });
      expect(request['limit']).toBe(1);
      expect(request['with_vector']).toBe(true);
      expect(request['filter']).toEqual(filter);
      expect(request).not.toHaveProperty('offset');
      expect(results).toEqual([{ id: 'p1', payload: { seq: 3 }, vector: [0.1, 0.2] }]);
    });

    it('EC-12: never auto-continues even though next_page_offset is non-null', async () => {
      mockScroll.mockResolvedValueOnce({
        points: [{ id: 'p1', payload: {} }],
        next_page_offset: 'there-is-more',
      });

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.scrollOrdered(
        { must: [] },
        { orderBy: { key: 'timestamp_utc', direction: 'desc' }, limit: 10 },
      );

      expect(mockScroll).toHaveBeenCalledTimes(1);
    });

    it('defaults with_vector to false and omits vector when not requested', async () => {
      mockScroll.mockResolvedValueOnce({
        points: [{ id: 'p1', payload: {} }],
        next_page_offset: null,
      });

      const repo = new QdrantRepository('http://localhost:6333');
      const results = await repo.scrollOrdered(undefined, {
        orderBy: { key: 'seq', direction: 'asc' },
        limit: 5,
      });

      const [, request] = mockScroll.mock.calls[0] as [string, Record<string, unknown>];
      expect(request['with_vector']).toBe(false);
      expect(results[0]).not.toHaveProperty('vector');
    });

    it('maps a client failure to QDRANT_OPERATION_FAILED', async () => {
      mockScroll.mockRejectedValueOnce(new Error('boom'));

      const repo = new QdrantRepository('http://localhost:6333');
      await expect(
        repo.scrollOrdered(undefined, { orderBy: { key: 'seq', direction: 'desc' }, limit: 1 }),
      ).rejects.toMatchObject({ code: 'QDRANT_OPERATION_FAILED' });
    });
  });

  describe('scrollAll() (#81 AC2)', () => {
    it('CT-1: paginates without order_by, chains offset from next_page_offset, and calls onPage once per page in order', async () => {
      mockScroll
        .mockResolvedValueOnce({
          points: [{ id: 'p1', payload: {} }],
          next_page_offset: 'off-1',
        })
        .mockResolvedValueOnce({
          points: [{ id: 'p2', payload: {} }],
          next_page_offset: 'off-2',
        })
        .mockResolvedValueOnce({
          points: [{ id: 'p3', payload: {} }],
          next_page_offset: null,
        });

      const repo = new QdrantRepository('http://localhost:6333');
      const filter = { must: [{ key: 'bank', match: { value: 'kb' } }] };
      const onPage = jest.fn();
      await repo.scrollAll(filter, { batch: 50 }, onPage);

      expect(mockScroll).toHaveBeenCalledTimes(3);
      const calls = mockScroll.mock.calls as [string, Record<string, unknown>][];
      for (const [, request] of calls) {
        expect(request).not.toHaveProperty('order_by');
        expect(request['filter']).toEqual(filter);
        expect(request['limit']).toBe(50);
      }
      expect(calls[0]?.[1]).not.toHaveProperty('offset');
      expect(calls[1]?.[1]['offset']).toBe('off-1');
      expect(calls[2]?.[1]['offset']).toBe('off-2');

      expect(onPage).toHaveBeenCalledTimes(3);
      expect(onPage).toHaveBeenNthCalledWith(1, [{ id: 'p1', payload: {} }]);
      expect(onPage).toHaveBeenNthCalledWith(2, [{ id: 'p2', payload: {} }]);
      expect(onPage).toHaveBeenNthCalledWith(3, [{ id: 'p3', payload: {} }]);
    });

    it('EC edge case: empty collection invokes onPage zero times', async () => {
      mockScroll.mockResolvedValueOnce({ points: [], next_page_offset: null });

      const repo = new QdrantRepository('http://localhost:6333');
      const onPage = jest.fn();
      await repo.scrollAll(undefined, {}, onPage);

      expect(onPage).not.toHaveBeenCalled();
    });

    it('EC-1: forwards a custom batch as limit and completes a multi-page loop with batch: 1', async () => {
      mockScroll
        .mockResolvedValueOnce({ points: [{ id: 'a', payload: {} }], next_page_offset: 'o1' })
        .mockResolvedValueOnce({ points: [{ id: 'b', payload: {} }], next_page_offset: 'o2' })
        .mockResolvedValueOnce({ points: [{ id: 'c', payload: {} }], next_page_offset: 'o3' })
        .mockResolvedValueOnce({ points: [{ id: 'd', payload: {} }], next_page_offset: null });

      const repo = new QdrantRepository('http://localhost:6333');
      const onPage = jest.fn();
      await repo.scrollAll(undefined, { batch: 1 }, onPage);

      expect(mockScroll).toHaveBeenCalledTimes(4);
      for (const [, request] of mockScroll.mock.calls as [string, Record<string, unknown>][]) {
        expect(request['limit']).toBe(1);
      }
      expect(onPage).toHaveBeenCalledTimes(4);
    });

    it('EC-1: uses the documented default batch (256) when omitted', async () => {
      mockScroll.mockResolvedValueOnce({
        points: [{ id: 'a', payload: {} }],
        next_page_offset: null,
      });

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.scrollAll(undefined, {}, jest.fn());

      const [, request] = mockScroll.mock.calls[0] as [string, Record<string, unknown>];
      expect(request['limit']).toBe(256);
    });

    it('EC-8: continues after a full page (length === batch) and stops only on next_page_offset === null', async () => {
      mockScroll
        .mockResolvedValueOnce({
          points: [
            { id: 'a', payload: {} },
            { id: 'b', payload: {} },
            { id: 'c', payload: {} },
          ],
          next_page_offset: 'off-1',
        })
        .mockResolvedValueOnce({ points: [{ id: 'd', payload: {} }], next_page_offset: null });

      const repo = new QdrantRepository('http://localhost:6333');
      const onPage = jest.fn();
      await repo.scrollAll(undefined, { batch: 3 }, onPage);

      expect(mockScroll).toHaveBeenCalledTimes(2);
      expect(onPage).toHaveBeenCalledTimes(2);
    });

    it('EC-9: streams pages via onPage across many pages without accumulating a return value', async () => {
      const pageCount = 50;
      for (let i = 0; i < pageCount; i++) {
        mockScroll.mockResolvedValueOnce({
          points: [{ id: `id-${String(i)}`, payload: {} }],
          next_page_offset: i === pageCount - 1 ? null : `off-${String(i)}`,
        });
      }

      const repo = new QdrantRepository('http://localhost:6333');
      const onPage = jest.fn();
      const returnValue = await repo.scrollAll(undefined, {}, onPage);

      expect(onPage).toHaveBeenCalledTimes(pageCount);
      expect(returnValue).toBeUndefined();
    });

    it('EC-5: propagates a mid-loop client failure as QDRANT_OPERATION_FAILED without retrying delivered pages', async () => {
      mockScroll
        .mockResolvedValueOnce({ points: [{ id: 'a', payload: {} }], next_page_offset: 'off-1' })
        .mockResolvedValueOnce({ points: [{ id: 'b', payload: {} }], next_page_offset: 'off-2' })
        .mockRejectedValueOnce(new Error('network blip'));

      const repo = new QdrantRepository('http://localhost:6333');
      const onPage = jest.fn();

      await expect(repo.scrollAll(undefined, {}, onPage)).rejects.toMatchObject({
        code: 'QDRANT_OPERATION_FAILED',
      });
      expect(onPage).toHaveBeenCalledTimes(2);
      expect(mockScroll).toHaveBeenCalledTimes(3);
    });

    it('forwards withVector and attaches vectors to each page', async () => {
      mockScroll.mockResolvedValueOnce({
        points: [{ id: 'a', payload: {}, vector: [0.5] }],
        next_page_offset: null,
      });

      const repo = new QdrantRepository('http://localhost:6333');
      const onPage = jest.fn();
      await repo.scrollAll(undefined, { withVector: true }, onPage);

      const [, request] = mockScroll.mock.calls[0] as [string, Record<string, unknown>];
      expect(request['with_vector']).toBe(true);
      expect(onPage).toHaveBeenCalledWith([{ id: 'a', payload: {}, vector: [0.5] }]);
    });
  });

  describe('count() (#81 AC4)', () => {
    it('CT-3: calls client.count with exact: true and resolves the number', async () => {
      mockCount.mockResolvedValueOnce({ count: 7 });

      const repo = new QdrantRepository('http://localhost:6333');
      const filter = { must: [{ key: 'bank', match: { value: 'kb' } }] };
      const result = await repo.count(filter);

      expect(mockCount).toHaveBeenCalledWith('decisions', { filter, exact: true });
      expect(result).toBe(7);
    });

    it('EC-13: a filter matching nothing resolves to the real number 0, not a falsy coalesced value', async () => {
      mockCount.mockResolvedValueOnce({ count: 0 });

      const repo = new QdrantRepository('http://localhost:6333');
      const result = await repo.count({ must: [{ key: 'repo', match: { value: 'nope' } }] });

      expect(Object.is(result, 0)).toBe(true);
    });

    it('maps a client failure to QDRANT_OPERATION_FAILED', async () => {
      mockCount.mockRejectedValueOnce(new Error('boom'));

      const repo = new QdrantRepository('http://localhost:6333');
      await expect(repo.count(undefined)).rejects.toMatchObject({
        code: 'QDRANT_OPERATION_FAILED',
      });
    });
  });

  describe('setPayload() / batchSetPayload() (#81 AC5)', () => {
    it('CT-4a: setPayload calls client.setPayload with points/payload/wait:true', async () => {
      mockSetPayload.mockResolvedValueOnce({});

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.setPayload('id-1', { archived: true });

      expect(mockSetPayload).toHaveBeenCalledWith('decisions', {
        points: ['id-1'],
        payload: { archived: true },
        wait: true,
      });
    });

    it('CT-4b: batchSetPayload chunks 300 ops into exactly 2 batchUpdate calls (256 + 44), preserving order', async () => {
      mockBatchUpdate.mockResolvedValue([]);

      const repo = new QdrantRepository('http://localhost:6333');
      const ops = Array.from({ length: 300 }, (_, i) => ({
        id: `id-${String(i)}`,
        payload: { seq: i },
      }));
      await repo.batchSetPayload(ops);

      expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
      const calls = mockBatchUpdate.mock.calls as [
        string,
        {
          wait: boolean;
          operations: { set_payload: { points: (string | number)[]; payload: unknown } }[];
        },
      ][];

      expect(calls[0]?.[1].operations).toHaveLength(256);
      expect(calls[1]?.[1].operations).toHaveLength(44);
      expect(calls[0]?.[1].wait).toBe(true);
      expect(calls[1]?.[1].wait).toBe(true);

      const firstChunk = calls[0]?.[1];
      const secondChunk = calls[1]?.[1];
      const reconstructedIds = [
        ...(firstChunk?.operations ?? []),
        ...(secondChunk?.operations ?? []),
      ].map((op) => op.set_payload.points[0]);
      expect(reconstructedIds).toEqual(ops.map((op) => op.id));

      expect(firstChunk?.operations[0]).toEqual({
        set_payload: { points: ['id-0'], payload: { seq: 0 } },
      });
    });

    it('EC-7: batchSetPayload([]) is a no-op', async () => {
      const repo = new QdrantRepository('http://localhost:6333');
      await repo.batchSetPayload([]);

      expect(mockBatchUpdate).not.toHaveBeenCalled();
    });

    it.each([
      [1, 1],
      [255, 1],
      [256, 1],
      [257, 2],
      [512, 2],
      [513, 3],
    ])('EC-7: %i ops produces %i batchUpdate call(s)', async (opCount, expectedCalls) => {
      mockBatchUpdate.mockResolvedValue([]);
      mockBatchUpdate.mockClear();

      const repo = new QdrantRepository('http://localhost:6333');
      const ops = Array.from({ length: opCount }, (_, i) => ({
        id: `id-${String(i)}`,
        payload: {},
      }));
      await repo.batchSetPayload(ops);

      expect(mockBatchUpdate).toHaveBeenCalledTimes(expectedCalls);
    });

    it('maps setPayload client failures to QDRANT_OPERATION_FAILED', async () => {
      mockSetPayload.mockRejectedValueOnce(new Error('boom'));

      const repo = new QdrantRepository('http://localhost:6333');
      await expect(repo.setPayload('id-1', {})).rejects.toMatchObject({
        code: 'QDRANT_OPERATION_FAILED',
      });
    });

    it('maps batchSetPayload client failures to QDRANT_OPERATION_FAILED', async () => {
      mockBatchUpdate.mockRejectedValueOnce(new Error('boom'));

      const repo = new QdrantRepository('http://localhost:6333');
      await expect(repo.batchSetPayload([{ id: 'id-1', payload: {} }])).rejects.toMatchObject({
        code: 'QDRANT_OPERATION_FAILED',
      });
    });
  });

  describe('fetchStalenessCorpus() (#81 AC6, refactored per D-2 drift fix / #82)', () => {
    it('D-2 parity: forwards the caller-built base filter to scroll() unmodified, for kb + repos', async () => {
      mockScroll.mockResolvedValueOnce({ points: [] });

      const base = mergeFilters(buildBaseFilter({ bank: 'kb', kind: 'all' }), {
        must: [{ key: 'repo', match: { any: ['repo-a', 'repo-b'] } }],
      });

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.fetchStalenessCorpus(base, 1000);

      expect(mockScroll).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({ filter: base, limit: 1000 }),
      );
    });

    it('D-2 parity: forwards the caller-built base filter to scroll() unmodified, for a private bank', async () => {
      mockScroll.mockResolvedValueOnce({ points: [] });

      const base = buildBaseFilter({ bank: 'private-jarvis', kind: 'all' });

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.fetchStalenessCorpus(base, 1000);

      expect(mockScroll).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({ filter: base, limit: 1000 }),
      );
    });

    it('D-2 parity: fetchStalenessCorpus never builds its own bank/repo filter internally — the exact base object reaches scroll() byte-identical to buildBaseFilter output', async () => {
      mockScroll.mockResolvedValueOnce({ points: [] });
      mockScroll.mockResolvedValueOnce({ points: [] });

      const kbBase = buildBaseFilter({ bank: 'kb', kind: 'all' });
      const repo = new QdrantRepository('http://localhost:6333');
      await repo.fetchStalenessCorpus(kbBase, 1000);

      const [, request] = mockScroll.mock.calls[0] as [string, { filter: unknown }];
      expect(request.filter).toEqual(kbBase);

      const privateBase = buildBaseFilter({ bank: 'private-x', kind: 'all' });
      await repo.fetchStalenessCorpus(privateBase, 1000);
      const [, secondRequest] = mockScroll.mock.calls[1] as [string, { filter: unknown }];
      expect(secondRequest.filter).toEqual(privateBase);
    });

    it('defaults limit to 1000 when omitted', async () => {
      mockScroll.mockResolvedValueOnce({ points: [] });

      const repo = new QdrantRepository('http://localhost:6333');
      await repo.fetchStalenessCorpus(buildBaseFilter({ bank: 'kb', kind: 'all' }));

      expect(mockScroll).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({ limit: 1000 }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // RT-1: scrollAll pagination fuzz (fixed seed, deterministic) — property-style
  // check over random page topologies without introducing a new fuzz dependency,
  // mirroring the fixed-seed mulberry32 pattern already used in
  // tests/unit/types/entry.test.ts.
  // ---------------------------------------------------------------------------

  describe('RT-1: scrollAll pagination fuzz (fixed seed 7)', () => {
    function mulberry32(seed: number) {
      return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    it('never sends order_by, chains offset exactly, and preserves onPage order across 30 random topologies', async () => {
      const rand = mulberry32(7);

      for (let trial = 0; trial < 30; trial++) {
        mockScroll.mockClear();
        const pageCount = Math.floor(rand() * 6); // 0..5 pages
        const nonEmptyPages: { id: string; payload: Record<string, never> }[][] = [];
        for (let i = 0; i < pageCount; i++) {
          // Always at least one point per generated page in this deterministic
          // harness so every generated page is expected to reach onPage
          // (empty-page suppression is covered separately by the dedicated
          // "empty collection" unit test above).
          nonEmptyPages.push([{ id: `t${String(trial)}-p${String(i)}`, payload: {} }]);
        }

        for (let i = 0; i < pageCount; i++) {
          mockScroll.mockResolvedValueOnce({
            points: nonEmptyPages[i],
            next_page_offset: i === pageCount - 1 ? null : `off-${String(trial)}-${String(i)}`,
          });
        }
        if (pageCount === 0) {
          mockScroll.mockResolvedValueOnce({ points: [], next_page_offset: null });
        }

        const repo = new QdrantRepository('http://localhost:6333');
        const onPage = jest.fn();
        await repo.scrollAll(undefined, { batch: 10 }, onPage);

        const calls = mockScroll.mock.calls as [string, Record<string, unknown>][];
        for (const [, request] of calls) {
          expect(request).not.toHaveProperty('order_by');
        }
        if (pageCount === 0) {
          expect(onPage).not.toHaveBeenCalled();
        } else {
          expect(onPage).toHaveBeenCalledTimes(pageCount);
          for (let i = 0; i < pageCount; i++) {
            expect(onPage).toHaveBeenNthCalledWith(i + 1, nonEmptyPages[i]);
          }
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // RT-2: batchSetPayload chunking fuzz (fixed seed, deterministic)
  // ---------------------------------------------------------------------------

  describe('RT-2: batchSetPayload chunking fuzz (fixed seed 13)', () => {
    function mulberry32(seed: number) {
      return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    it('produces Math.ceil(n / 256) batchUpdate calls and preserves op order across boundary-biased random counts', async () => {
      const rand = mulberry32(13);
      const boundarySet = [0, 1, 255, 256, 257, 511, 512, 513, 767, 768, 769, 2000];

      const counts = [
        ...boundarySet,
        ...Array.from({ length: 20 }, () => Math.floor(rand() * 2001)),
      ];

      for (const n of counts) {
        mockBatchUpdate.mockClear();
        mockBatchUpdate.mockResolvedValue([]);

        const repo = new QdrantRepository('http://localhost:6333');
        const ops = Array.from({ length: n }, (_, i) => ({
          id: `id-${String(i)}`,
          payload: { i },
        }));
        await repo.batchSetPayload(ops);

        const expectedCalls = n === 0 ? 0 : Math.ceil(n / 256);
        expect(mockBatchUpdate).toHaveBeenCalledTimes(expectedCalls);

        const calls = mockBatchUpdate.mock.calls as [
          string,
          { operations: { set_payload: { points: (string | number)[]; payload: unknown } }[] },
        ][];
        const reconstructed = calls.flatMap((call) =>
          call[1].operations.map((op) => op.set_payload.points[0]),
        );
        expect(reconstructed).toEqual(ops.map((op) => op.id));
      }
    });
  });
});
