import { OpenAIEmbeddingsAdapter } from '../../../src/adapters/openai-embeddings';
import { MemoError } from '../../../src/lib/errors';

// Mock withRetry to avoid delays
jest.mock('../../../src/lib/retry', () => ({
  withRetry: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

const mockCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    embeddings: { create: mockCreate },
  })),
}));

describe('OpenAIEmbeddingsAdapter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('throws MISSING_CREDENTIAL when EMBEDDINGS_API_KEY not set', () => {
      delete process.env['EMBEDDINGS_API_KEY'];
      expect(() => new OpenAIEmbeddingsAdapter()).toThrow(MemoError);
      expect(() => new OpenAIEmbeddingsAdapter()).toThrow('EMBEDDINGS_API_KEY is required');
    });
  });

  describe('adapter interface', () => {
    it('implements EmbeddingsAdapter interface with dimensions = 1536', () => {
      process.env['EMBEDDINGS_API_KEY'] = 'test-key';
      const adapter = new OpenAIEmbeddingsAdapter();
      expect(adapter.dimensions).toBe(1536);
    });
  });

  describe('embed()', () => {
    it('calls openai API with text-embedding-3-small', async () => {
      process.env['EMBEDDINGS_API_KEY'] = 'test-key';
      mockCreate.mockResolvedValueOnce({
        data: [{ embedding: Array(1536).fill(0.1) }],
      });

      const adapter = new OpenAIEmbeddingsAdapter();
      const result = await adapter.embed('test text');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'text-embedding-3-small',
          input: 'test text',
        }),
      );
      expect(result).toHaveLength(1536);
    });

    it('throws EMBEDDING_API_ERROR on OpenAI failure', async () => {
      process.env['EMBEDDINGS_API_KEY'] = 'test-key';
      mockCreate.mockRejectedValueOnce(new Error('API error'));

      const adapter = new OpenAIEmbeddingsAdapter();
      await expect(adapter.embed('test')).rejects.toThrow(MemoError);
      await expect(adapter.embed('test')).rejects.toMatchObject({
        code: 'EMBEDDING_API_ERROR',
      });
    });
  });
});
