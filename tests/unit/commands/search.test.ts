import {
  buildSearchVectorInput,
  handleSearch,
  computeOverfetchLimit,
} from '../../../src/commands/search.js';
import type { SearchDeps } from '../../../src/commands/search.js';
import { MemoError } from '../../../src/lib/errors.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  search: jest.fn().mockResolvedValue([]),
};

const mockEmbeddings = {
  embed: jest.fn().mockResolvedValue(new Array<number>(1536).fill(0.25)),
  dimensions: 1536,
};

const mockConfig = {
  schema_version: '1' as const,
  repo: 'memo-cli',
  org: 'llipe',
  domain: 'developer-tools',
  relates_to: ['platform-docs'],
  defaults: { source: 'agent' as const, search_scope: 'repo' as const },
};

let stdoutData = '';

beforeEach(() => {
  stdoutData = '';
  jest.spyOn(process.stdout, 'write').mockImplementation((data: any) => {
    stdoutData += String(data);
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  jest.clearAllMocks();
  mockQdrant.search.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('buildSearchVectorInput', () => {
  it('returns query plus normalized tag terms when tags are present', () => {
    expect(buildSearchVectorInput('persist decisions', ['qdrant', 'search'])).toBe(
      'persist decisions qdrant search',
    );
  });

  it('returns the raw query when no tags are present', () => {
    expect(buildSearchVectorInput('persist decisions', [])).toBe('persist decisions');
  });
});

describe('computeOverfetchLimit', () => {
  it('applies max(limit, min(limit*3, 50)) (D2, AC13)', () => {
    expect(computeOverfetchLimit(3)).toBe(9);
    expect(computeOverfetchLimit(16)).toBe(48);
    expect(computeOverfetchLimit(17)).toBe(50);
    expect(computeOverfetchLimit(20)).toBe(50);
    expect(computeOverfetchLimit(50)).toBe(50);
  });

  it('never truncates a limit above 50 (AC14)', () => {
    expect(computeOverfetchLimit(51)).toBe(51);
    expect(computeOverfetchLimit(100)).toBe(100);
    expect(computeOverfetchLimit(1000)).toBe(1000);
  });
});

describe('handleSearch', () => {
  const deps: SearchDeps = {
    loadCfg: jest.fn().mockResolvedValue(mockConfig),
    createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  it('embeds query plus tags and calls search with the over-fetch limit (DEF-1)', async () => {
    await handleSearch(
      {
        query: 'persist decisions',
        tags: 'qdrant,search',
        entryType: 'decision,structure',
        source: 'agent,manual',
        limit: '3',
      },
      deps,
    );

    expect(mockQdrant.ensureCollection).toHaveBeenCalled();
    expect(mockEmbeddings.embed).toHaveBeenCalledWith('persist decisions qdrant search');
    // --limit 3 over-fetches 9 (D2), not the raw --limit (DEF-1).
    expect(mockQdrant.search).toHaveBeenCalledWith(
      expect.any(Array),
      {
        must: [
          { key: 'repo', match: { value: 'memo-cli' } },
          { key: 'org', match: { value: 'llipe' } },
          { key: 'tags', match: { value: 'qdrant' } },
          { key: 'tags', match: { value: 'search' } },
          { key: 'entry_type', match: { any: ['decision', 'structure'] } },
          { key: 'source', match: { any: ['agent', 'manual'] } },
        ],
      },
      9,
    );
  });

  it('over-fetches 50 for --limit 20 and exactly 100 for --limit 100 (AC13, AC14)', async () => {
    await handleSearch({ query: 'q', limit: '20' }, deps);
    expect(mockQdrant.search).toHaveBeenCalledWith(expect.any(Array), expect.any(Object), 50);

    jest.clearAllMocks();
    mockQdrant.search.mockResolvedValue([]);
    await handleSearch({ query: 'q', limit: '100' }, deps);
    expect(mockQdrant.search).toHaveBeenCalledWith(expect.any(Array), expect.any(Object), 100);
  });

  it('throws when repo context cannot be resolved', async () => {
    const missingContextDeps: SearchDeps = {
      ...deps,
      loadCfg: jest.fn().mockRejectedValue(new MemoError('CONFIG_NOT_FOUND', 'not found')),
    };

    await expect(
      handleSearch({ query: 'persist decisions' }, missingContextDeps),
    ).rejects.toMatchObject({
      code: 'REPO_CONTEXT_UNRESOLVED',
    });
  });

  it('propagates CONFIG_INVALID rather than silently falling back to defaults (D7, AC12)', async () => {
    const invalidConfigDeps: SearchDeps = {
      ...deps,
      loadCfg: jest
        .fn()
        .mockRejectedValue(new MemoError('CONFIG_INVALID', 'ranking: weights must sum to 1.0')),
    };

    await expect(
      handleSearch({ query: 'persist decisions', repo: 'memo-cli' }, invalidConfigDeps),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    expect(mockQdrant.search).not.toHaveBeenCalled();
  });

  it('renders an empty-state message in human mode', async () => {
    await handleSearch({ query: 'missing decision' }, deps);

    expect(stdoutData).toContain('No results found.');
    expect(stdoutData).toContain('tip: broaden the query');
  });

  describe('ranked results', () => {
    const rankedDeps: SearchDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    beforeEach(() => {
      mockQdrant.search.mockResolvedValue([
        {
          id: 'old-high-sim',
          score: 0.9,
          payload: {
            repo: 'memo-cli',
            rationale: 'Old but similar',
            source: 'agent',
            timestamp_utc: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
          },
        },
        {
          id: 'new-lower-sim',
          score: 0.82,
          payload: {
            repo: 'memo-cli',
            rationale: 'Newer, less similar',
            source: 'agent',
            timestamp_utc: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          },
        },
      ]);
    });

    it('orders --json results by final_score, not raw similarity (AC1, AC2)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true }, rankedDeps);
      const parsed = JSON.parse(stdoutData) as {
        results: { id: string; final_score: number; similarity: number }[];
      };
      expect(parsed.results[0]?.id).toBe('new-lower-sim');
      expect(parsed.results[1]?.id).toBe('old-high-sim');
      expect(parsed.results[0]?.final_score).toBeGreaterThan(parsed.results[1]?.final_score ?? 0);
      // similarity remains the raw, unranked score (backward compatibility).
      expect(parsed.results[1]?.similarity).toBeGreaterThan(parsed.results[0]?.similarity ?? 0);
    });

    it('exposes all four score fields on every --json result (AC5)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true }, rankedDeps);
      const parsed = JSON.parse(stdoutData) as { results: Record<string, unknown>[] };
      for (const result of parsed.results) {
        expect(typeof result['final_score']).toBe('number');
        expect(typeof result['similarity']).toBe('number');
        expect(typeof result['recency_score']).toBe('number');
        expect(typeof result['source_score']).toBe('number');
      }
    });

    it('does not remove or rename existing envelope keys (AC7)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true }, rankedDeps);
      const parsed = JSON.parse(stdoutData) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(['count', 'filters', 'query', 'results'].sort());
    });

    it('slices ranked results down to --limit (AC13)', async () => {
      await handleSearch({ query: 'q', limit: '1', json: true }, rankedDeps);
      const parsed = JSON.parse(stdoutData) as { results: unknown[]; count: number };
      expect(parsed.results).toHaveLength(1);
      expect(parsed.count).toBe(1);
    });
  });
});
