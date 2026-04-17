import { QdrantRepository } from '../../../src/lib/qdrant';
import { MemoError } from '../../../src/lib/errors';

// Mock withRetry to avoid delays in tests
jest.mock('../../../src/lib/retry', () => ({
  withRetry: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

const mockGetCollection = jest.fn();
const mockCreateCollection = jest.fn();
const mockCreatePayloadIndex = jest.fn();
const mockUpsert = jest.fn();
const mockSearch = jest.fn();
const mockScroll = jest.fn();

jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({
    getCollection: mockGetCollection,
    createCollection: mockCreateCollection,
    createPayloadIndex: mockCreatePayloadIndex,
    upsert: mockUpsert,
    search: mockSearch,
    scroll: mockScroll,
  })),
}));

describe('QdrantRepository', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, QDRANT_URL: 'http://localhost:6333' };
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
    it('calls client.search with filter and limit', async () => {
      mockSearch.mockResolvedValueOnce([{ id: '1', score: 0.9, payload: { text: 'hello' } }]);

      const repo = new QdrantRepository('http://localhost:6333');
      const vector = Array(1536).fill(0.1) as number[];
      const filter = { must: [] };
      const results = await repo.search(vector, filter, 5);

      expect(mockSearch).toHaveBeenCalledWith(
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
  });

  describe('getByDedupeKey()', () => {
    it('returns null when no results', async () => {
      mockScroll.mockResolvedValueOnce({ points: [] });

      const repo = new QdrantRepository('http://localhost:6333');
      const result = await repo.getByDedupeKey('abc123');

      expect(result).toBeNull();
    });
  });
});
