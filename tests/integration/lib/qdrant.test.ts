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
    expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(8); // 8 payload indexes
  });

  it('ensureCollection() is idempotent when called twice (second call is no-op)', async () => {
    // First call: collection doesn't exist → create it
    mockGetCollection.mockRejectedValueOnce(new Error('collection not found'));
    mockCreateCollection.mockResolvedValueOnce({});
    mockCreatePayloadIndex.mockResolvedValue({});
    // Second call: collection now exists → skip
    mockGetCollection.mockResolvedValueOnce({ config: {} });

    const repo = new QdrantRepository();
    await repo.ensureCollection();
    await repo.ensureCollection();

    expect(mockCreateCollection).toHaveBeenCalledTimes(1);
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
});
