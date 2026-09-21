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

  it('ensureCollection() creates collection on fresh instance', async () => {
    mockGetCollection.mockRejectedValueOnce(new Error('collection not found'));
    mockCreateCollection.mockResolvedValueOnce({});
    mockCreatePayloadIndex.mockResolvedValue({});

    const repo = new QdrantRepository();
    await repo.ensureCollection();

    expect(mockCreateCollection).toHaveBeenCalledTimes(1);
    expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(10); // 10 payload indexes (#62 adds rationale + files_modified)
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
      },
    });

    const repo = new QdrantRepository();
    await repo.ensureCollection();
    await repo.ensureCollection();

    expect(mockCreateCollection).toHaveBeenCalledTimes(1);
    expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(10); // only from the first (create) call
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
          // rationale and files_modified are missing, as they would be on a
          // collection created before #62 (AC11).
        },
      });
      mockCreatePayloadIndex.mockResolvedValue({});

      const repo = new QdrantRepository();
      await repo.ensureIndexes();

      expect(mockCreateCollection).not.toHaveBeenCalled();
      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(2);
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
});
