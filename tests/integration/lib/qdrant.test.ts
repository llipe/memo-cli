import { QdrantRepository } from '../../../src/lib/qdrant';
import { MemoError } from '../../../src/lib/errors';

// Mock withRetry to avoid delays
jest.mock('../../../src/lib/retry', () => ({
  withRetry: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

const mockGetCollection = jest.fn();
const mockCreateCollection = jest.fn();
const mockCreatePayloadIndex = jest.fn();

jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({
    getCollection: mockGetCollection,
    createCollection: mockCreateCollection,
    createPayloadIndex: mockCreatePayloadIndex,
    upsert: jest.fn(),
    search: jest.fn(),
    scroll: jest.fn(),
  })),
}));

describe('QdrantRepository Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, QDRANT_URL: 'http://localhost:6333' };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

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
  };

  it('ensureCollection() creates collection on fresh instance', async () => {
    mockGetCollection.mockRejectedValueOnce(new Error('collection not found'));
    mockCreateCollection.mockResolvedValueOnce({});
    mockCreatePayloadIndex.mockResolvedValue({});

    const repo = new QdrantRepository();
    await repo.ensureCollection();

    expect(mockCreateCollection).toHaveBeenCalledTimes(1);
    // 22 payload indexes total (#62 adds rationale + files_modified; #81/S2-02 adds 12 v2 indexes).
    expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(22);
  });

  it('ensureCollection() is idempotent when called twice against a fully-indexed collection', async () => {
    // First call: collection doesn't exist -> create it
    mockGetCollection.mockRejectedValueOnce(new Error('collection not found'));
    mockCreateCollection.mockResolvedValueOnce({});
    mockCreatePayloadIndex.mockResolvedValue({});
    // Second call: collection now exists with every index already present -> skip all
    mockGetCollection.mockResolvedValueOnce({
      config: {},
      payload_schema: {
        repo: {},
        org: {},
        entry_type: {},
        source: {},
        tags: {},
        timestamp_utc: {},
        commit: {},
        dedupe_key_sha256: {},
        rationale: {},
        files_modified: {},
        ...V2_NEW_FIELDS,
      },
    });

    const repo = new QdrantRepository();
    await repo.ensureCollection();
    await repo.ensureCollection();

    expect(mockCreateCollection).toHaveBeenCalledTimes(1);
    expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(22); // only from the first (create) call
  });

  it('throws COLLECTION_BOOTSTRAP_FAILED when Qdrant is unreachable', async () => {
    mockGetCollection.mockRejectedValue(new Error('Connection refused'));
    mockCreateCollection.mockRejectedValue(new Error('Connection refused'));

    const repo = new QdrantRepository();
    await expect(repo.ensureCollection()).rejects.toThrow(MemoError);
    await expect(repo.ensureCollection()).rejects.toMatchObject({
      code: 'COLLECTION_BOOTSTRAP_FAILED',
    });
  });

  describe('ensureIndexes() (#62 AC1, AC11)', () => {
    it('creates only the missing indexes on a pre-existing collection (v1.1.x reconciliation)', async () => {
      mockGetCollection.mockResolvedValueOnce({
        config: {},
        payload_schema: {
          repo: {},
          org: {},
          entry_type: {},
          source: {},
          tags: {},
          timestamp_utc: {},
          commit: {},
          dedupe_key_sha256: {},
          // rationale, files_modified, and the 12 S2-02/#81 v2 fields are all
          // missing, as they would be on a collection created before #62/#81.
        },
      });
      mockCreatePayloadIndex.mockResolvedValue({});

      const repo = new QdrantRepository();
      await repo.ensureIndexes();

      expect(mockCreateCollection).not.toHaveBeenCalled();
      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(14);
      expect(mockCreatePayloadIndex).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({ field_name: 'rationale' }),
      );
      expect(mockCreatePayloadIndex).toHaveBeenCalledWith(
        'decisions',
        expect.objectContaining({ field_name: 'files_modified' }),
      );
    });

    it('is a no-op when every index already exists', async () => {
      mockGetCollection.mockResolvedValueOnce({
        config: {},
        payload_schema: {
          repo: {},
          org: {},
          entry_type: {},
          source: {},
          tags: {},
          timestamp_utc: {},
          commit: {},
          dedupe_key_sha256: {},
          rationale: {},
          files_modified: {},
          ...V2_NEW_FIELDS,
        },
      });

      const repo = new QdrantRepository();
      await repo.ensureIndexes();

      expect(mockCreatePayloadIndex).not.toHaveBeenCalled();
    });

    it('throws COLLECTION_BOOTSTRAP_FAILED when the collection cannot be read', async () => {
      mockGetCollection.mockRejectedValue(new Error('Connection refused'));

      const repo = new QdrantRepository();
      await expect(repo.ensureIndexes()).rejects.toMatchObject({
        code: 'COLLECTION_BOOTSTRAP_FAILED',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Story S2-02 (issue #81): SC-1 / CT-6 — ensureIndexes reconciles a
  // pre-existing v1.2.0-shaped collection by creating exactly the 12 new
  // indexes, and is idempotent on a second run.
  // ---------------------------------------------------------------------------

  describe('ensureIndexes() (#81 AC1 — SC-1/CT-6)', () => {
    const V1_2_0_PAYLOAD_SCHEMA = {
      repo: {},
      org: {},
      entry_type: {},
      source: {},
      tags: {},
      timestamp_utc: {},
      commit: {},
      dedupe_key_sha256: {},
      rationale: {},
      files_modified: {},
    };

    it('SC-1: first call creates exactly the 12 new indexes and none of the existing 10; second call creates 0', async () => {
      mockGetCollection
        .mockResolvedValueOnce({ config: {}, payload_schema: V1_2_0_PAYLOAD_SCHEMA })
        .mockResolvedValueOnce({
          config: {},
          payload_schema: { ...V1_2_0_PAYLOAD_SCHEMA, ...V2_NEW_FIELDS },
        });
      mockCreatePayloadIndex.mockResolvedValue({});

      const repo = new QdrantRepository();
      await repo.ensureIndexes();

      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(12);
      const createdFields = new Set(
        mockCreatePayloadIndex.mock.calls.map(
          (call) => (call[1] as { field_name: string }).field_name,
        ),
      );
      expect(createdFields).toEqual(new Set(Object.keys(V2_NEW_FIELDS)));
      // None of the 10 pre-existing fields were re-created.
      for (const field of Object.keys(V1_2_0_PAYLOAD_SCHEMA)) {
        expect(createdFields.has(field)).toBe(false);
      }

      mockCreatePayloadIndex.mockClear();
      await repo.ensureIndexes();
      expect(mockCreatePayloadIndex).not.toHaveBeenCalled();
    });

    it('CT-6: PAYLOAD_INDEXES field/schema pairs for the 12 new entries match AC1 exactly', async () => {
      mockGetCollection.mockResolvedValueOnce({
        config: {},
        payload_schema: V1_2_0_PAYLOAD_SCHEMA,
      });
      mockCreatePayloadIndex.mockResolvedValue({});

      const repo = new QdrantRepository();
      await repo.ensureIndexes();

      const expected: Record<string, string> = {
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
      };

      for (const call of mockCreatePayloadIndex.mock.calls) {
        const [, { field_name, field_schema }] = call as [
          string,
          { field_name: string; field_schema: string },
        ];
        if (field_name in expected) {
          expect(field_schema).toBe(expected[field_name]);
        }
      }
    });
  });
});
