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
  fetchByRepo: jest.fn().mockResolvedValue([]),
  scroll: jest.fn().mockResolvedValue([]),
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
  mockQdrant.fetchByRepo.mockResolvedValue([]);
  mockQdrant.scroll.mockResolvedValue([]);
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

    it('does not remove or rename existing envelope keys, only adds query_id (AC4, #63 AC1)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true }, rankedDeps);
      const parsed = JSON.parse(stdoutData) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(
        ['count', 'filters', 'query', 'query_id', 'results'].sort(),
      );
    });

    it('slices ranked results down to --limit (AC13)', async () => {
      await handleSearch({ query: 'q', limit: '1', json: true }, rankedDeps);
      const parsed = JSON.parse(stdoutData) as { results: unknown[]; count: number };
      expect(parsed.results).toHaveLength(1);
      expect(parsed.count).toBe(1);
    });
  });

  describe('tag overlap boosting (#36)', () => {
    const boostDeps: SearchDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    beforeEach(() => {
      mockQdrant.search.mockResolvedValue([
        {
          id: 'no-tag-match',
          score: 0.7,
          payload: {
            repo: 'memo-cli',
            rationale: 'Unrelated entry',
            source: 'agent',
            tags: ['unrelated'],
            timestamp_utc: new Date().toISOString(),
          },
        },
        {
          id: 'tag-match',
          score: 0.7,
          payload: {
            repo: 'memo-cli',
            rationale: 'Rate limiting strategy',
            source: 'agent',
            tags: ['rate', 'limiting'],
            timestamp_utc: new Date().toISOString(),
          },
        },
      ]);
    });

    it('exposes tag_boost on every --json result (AC4)', async () => {
      await handleSearch({ query: 'rate limiting strategy', limit: '5', json: true }, boostDeps);
      const parsed = JSON.parse(stdoutData) as { results: Record<string, unknown>[] };
      expect(parsed.results).toHaveLength(2);
      for (const result of parsed.results) {
        expect(typeof result['tag_boost']).toBe('number');
      }
    });

    it('ranks a tag-matching entry above an equal-similarity non-matching one', async () => {
      await handleSearch({ query: 'rate limiting strategy', limit: '5', json: true }, boostDeps);
      const parsed = JSON.parse(stdoutData) as {
        results: { id: string; tag_boost: number }[];
      };
      expect(parsed.results[0]?.id).toBe('tag-match');
      expect(parsed.results[0]?.tag_boost).toBeGreaterThan(0);
      expect(parsed.results[1]?.tag_boost).toBe(0);
    });

    it('does not change human-mode output format (AC4)', async () => {
      await handleSearch({ query: 'rate limiting strategy', limit: '5' }, boostDeps);
      expect(stdoutData).toContain('Rate limiting strategy');
      expect(stdoutData).not.toContain('tag_boost');
    });
  });

  describe('confidence tiers (#35)', () => {
    const confidenceDeps: SearchDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    beforeEach(() => {
      mockQdrant.search.mockResolvedValue([
        {
          id: 'has-confidence',
          score: 1,
          payload: {
            repo: 'memo-cli',
            rationale: 'Stored confidence should not leak into search',
            source: 'agent',
            confidence: 'high',
            timestamp_utc: new Date().toISOString(),
          },
        },
      ]);
    });

    it('exposes confidence_tier and drops confidence on every --json result (AC3, AC4)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true }, confidenceDeps);
      const parsed = JSON.parse(stdoutData) as { results: Record<string, unknown>[] };
      expect(parsed.results).toHaveLength(1);
      const result = parsed.results[0];
      expect(typeof result?.['confidence_tier']).toBe('string');
      expect(result).not.toHaveProperty('confidence');
    });

    it('renders the [tier] prefix and never the raw confidence value in human output (AC5)', async () => {
      await handleSearch({ query: 'q', limit: '5' }, confidenceDeps);
      expect(stdoutData).toContain('[exact]');
      expect(stdoutData).not.toContain('confidence: high');
    });
  });

  describe('staleness detection (#38)', () => {
    const stalenessDeps: SearchDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    const oldTimestamp = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const newTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    beforeEach(() => {
      mockQdrant.search.mockResolvedValue([
        {
          id: 'old-entry',
          score: 0.8,
          payload: {
            repo: 'memo-cli',
            rationale: 'An old decision',
            source: 'agent',
            tags: ['auth', 'rate-limiting'],
            timestamp_utc: oldTimestamp,
          },
        },
      ]);
      mockQdrant.fetchByRepo.mockResolvedValue([
        {
          id: 'old-entry',
          payload: {
            repo: 'memo-cli',
            tags: ['auth', 'rate-limiting'],
            timestamp_utc: oldTimestamp,
          },
        },
        {
          id: 'newer-entry',
          payload: {
            repo: 'memo-cli',
            tags: ['auth', 'rate-limiting'],
            timestamp_utc: newTimestamp,
          },
        },
      ]);
    });

    it('calls fetchByRepo exactly once regardless of the number of ranked results (AC5)', async () => {
      mockQdrant.search.mockResolvedValue([
        {
          id: 'old-entry',
          score: 0.8,
          payload: {
            repo: 'memo-cli',
            rationale: 'An old decision',
            source: 'agent',
            tags: ['auth'],
            timestamp_utc: oldTimestamp,
          },
        },
        {
          id: 'another-entry',
          score: 0.7,
          payload: {
            repo: 'memo-cli',
            rationale: 'Another decision',
            source: 'agent',
            tags: ['billing'],
            timestamp_utc: newTimestamp,
          },
        },
      ]);

      await handleSearch({ query: 'q', limit: '5', json: true }, stalenessDeps);

      expect(mockQdrant.fetchByRepo).toHaveBeenCalledTimes(1);
    });

    it('does not call fetchByRepo when there are no ranked results', async () => {
      mockQdrant.search.mockResolvedValue([]);

      await handleSearch({ query: 'q', limit: '5', json: true }, stalenessDeps);

      expect(mockQdrant.fetchByRepo).not.toHaveBeenCalled();
    });

    it('scopes the fetchByRepo call to the resolved repo (AC6)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true }, stalenessDeps);

      expect(mockQdrant.fetchByRepo).toHaveBeenCalledWith(['memo-cli']);
    });

    it('scopes the fetchByRepo call to the full related repo set for --scope related (AC6)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true, scope: 'related' }, stalenessDeps);

      expect(mockQdrant.fetchByRepo).toHaveBeenCalledWith(['memo-cli', 'platform-docs']);
    });

    it('flags a stale result with stale:true and stale_by in --json output (AC1, AC2)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true }, stalenessDeps);
      const parsed = JSON.parse(stdoutData) as { results: Record<string, unknown>[] };
      const result = parsed.results.find((r) => r['id'] === 'old-entry');
      expect(result?.['stale']).toBe(true);
      expect(result?.['stale_by']).toBe('newer-entry');
    });

    it('omits stale and stale_by entirely when not stale (AC3)', async () => {
      mockQdrant.search.mockResolvedValue([
        {
          id: 'fresh-entry',
          score: 0.8,
          payload: {
            repo: 'memo-cli',
            rationale: 'A fresh decision',
            source: 'agent',
            tags: ['auth'],
            timestamp_utc: newTimestamp,
          },
        },
      ]);
      mockQdrant.fetchByRepo.mockResolvedValue([
        {
          id: 'fresh-entry',
          payload: { repo: 'memo-cli', tags: ['auth'], timestamp_utc: newTimestamp },
        },
      ]);

      await handleSearch({ query: 'q', limit: '5', json: true }, stalenessDeps);
      const parsed = JSON.parse(stdoutData) as { results: Record<string, unknown>[] };
      const result = parsed.results[0];
      expect(result).not.toHaveProperty('stale');
      expect(result).not.toHaveProperty('stale_by');
    });

    it('does not change final_score or ordering when staleness is flagged (AC4)', async () => {
      mockQdrant.search.mockResolvedValue([
        {
          id: 'old-entry',
          score: 0.8,
          payload: {
            repo: 'memo-cli',
            rationale: 'An old decision',
            source: 'agent',
            tags: ['auth', 'rate-limiting'],
            timestamp_utc: oldTimestamp,
          },
        },
        {
          id: 'other-entry',
          score: 0.5,
          payload: {
            repo: 'memo-cli',
            rationale: 'A lower-similarity decision',
            source: 'agent',
            tags: [],
            timestamp_utc: oldTimestamp,
          },
        },
      ]);

      const withStaleness = await (async () => {
        await handleSearch({ query: 'q', limit: '5', json: true }, stalenessDeps);
        return JSON.parse(stdoutData) as {
          results: { id: string; final_score: number }[];
        };
      })();

      // Re-run with an empty corpus (no staleness ever flagged) - final_score
      // and ordering must be identical either way. Compared with a small
      // tolerance rather than exact equality since real wall-clock
      // milliseconds elapse between the two `handleSearch` invocations,
      // each of which reads `Date.now()` independently for recency scoring.
      stdoutData = '';
      mockQdrant.fetchByRepo.mockResolvedValueOnce([]);
      await handleSearch({ query: 'q', limit: '5', json: true }, stalenessDeps);
      const withoutStaleness = JSON.parse(stdoutData) as {
        results: { id: string; final_score: number }[];
      };

      expect(withoutStaleness.results.map((r) => r.id)).toEqual(
        withStaleness.results.map((r) => r.id),
      );
      withoutStaleness.results.forEach((r, i) => {
        expect(r.final_score).toBeCloseTo(withStaleness.results[i]?.final_score ?? NaN, 6);
      });
    });

    it('renders the STALE warning inline in human output (AC7)', async () => {
      await handleSearch({ query: 'q', limit: '5' }, stalenessDeps);
      expect(stdoutData).toContain('⚠ STALE');
      expect(stdoutData).toContain('superseded by newer-entry');
    });

    it('never crashes on an empty corpus and never flags staleness', async () => {
      mockQdrant.fetchByRepo.mockResolvedValue([]);

      await handleSearch({ query: 'q', limit: '5', json: true }, stalenessDeps);
      const parsed = JSON.parse(stdoutData) as { results: Record<string, unknown>[] };
      expect(parsed.results[0]).not.toHaveProperty('stale');
    });
  });

  describe('lexical identifier matching (#62)', () => {
    it('issues exactly one extra scroll when the query has identifier tokens (AC4)', async () => {
      await handleSearch(
        { query: 'why does search-filters.ts build should clauses', limit: '5' },
        deps,
      );
      expect(mockQdrant.scroll).toHaveBeenCalledTimes(1);
    });

    it('issues no extra scroll when the query has no identifier tokens (AC8)', async () => {
      await handleSearch({ query: 'why does search stop working sometimes', limit: '5' }, deps);
      expect(mockQdrant.scroll).not.toHaveBeenCalled();
    });

    it('issues no extra scroll when --lexical off, even with identifier tokens (AC7)', async () => {
      await handleSearch(
        { query: 'why does search-filters.ts build should clauses', limit: '5', lexical: 'off' },
        deps,
      );
      expect(mockQdrant.scroll).not.toHaveBeenCalled();
    });

    it('scrolls with a min_should:1 clause per identifier over rationale and files_modified, same pre-filters, limit 50, withVector true (AC4)', async () => {
      await handleSearch(
        { query: 'why does search-filters.ts build should clauses', limit: '5', repo: 'memo-cli' },
        deps,
      );

      expect(mockQdrant.scroll).toHaveBeenCalledWith(
        expect.objectContaining({
          must: expect.arrayContaining([
            expect.objectContaining({
              must: expect.arrayContaining([{ key: 'repo', match: { value: 'memo-cli' } }]),
            }),
            expect.objectContaining({
              min_should: expect.objectContaining({
                min_count: 1,
                conditions: expect.arrayContaining([
                  { key: 'rationale', match: { text: 'search-filters.ts' } },
                  { key: 'files_modified', match: { text: 'search-filters.ts' } },
                ]),
              }),
            }),
          ]),
        }),
        50,
        { withVector: true },
      );
    });

    it('unions and dedupes a lexical-only candidate with a locally computed cosine similarity, without recomputing a dense candidate score (AC5)', async () => {
      mockQdrant.search.mockResolvedValue([
        {
          id: 'dense-hit',
          score: 0.9,
          payload: { repo: 'memo-cli', rationale: 'unrelated dense hit', source: 'agent' },
        },
      ]);
      mockQdrant.scroll.mockResolvedValue([
        {
          id: 'dense-hit',
          payload: { repo: 'memo-cli', rationale: 'search-filters.ts duplicate of dense hit' },
          vector: new Array(1536).fill(1),
        },
        {
          id: 'lexical-only',
          payload: {
            repo: 'memo-cli',
            rationale: 'documents search-filters.ts',
            source: 'agent',
          },
          vector: new Array(1536).fill(0.25),
        },
      ]);

      await handleSearch(
        { query: 'why does search-filters.ts build should clauses', limit: '5', json: true },
        deps,
      );

      const parsed = JSON.parse(stdoutData) as { results: { id: string; similarity: number }[] };
      expect(parsed.results).toHaveLength(2);
      const denseHit = parsed.results.find((r) => r.id === 'dense-hit');
      // Dense score (0.9) is kept, never overwritten by the local cosine computation.
      expect(denseHit?.similarity).toBe(0.9);
      const lexicalOnly = parsed.results.find((r) => r.id === 'lexical-only');
      expect(lexicalOnly).toBeDefined();
      // The mock embeddings adapter returns an all-0.25 vector, so cosine(query, [0.25...]) === 1.
      expect(lexicalOnly?.similarity).toBeCloseTo(1, 6);
    });

    it('degrades gracefully to dense-only results when the lexical scroll fails, logged under MEMO_DEBUG, exit code unchanged', async () => {
      mockQdrant.search.mockResolvedValue([
        {
          id: 'dense-hit',
          score: 0.9,
          payload: { repo: 'memo-cli', rationale: 'dense only', source: 'agent' },
        },
      ]);
      mockQdrant.scroll.mockRejectedValue(new MemoError('QDRANT_OPERATION_FAILED', 'boom'));

      await expect(
        handleSearch(
          { query: 'why does search-filters.ts build should clauses', limit: '5', json: true },
          deps,
        ),
      ).resolves.toBeUndefined();

      const parsed = JSON.parse(stdoutData) as { results: { id: string }[] };
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0]?.id).toBe('dense-hit');
    });

    it('ranks a lexical-identifier match ahead of an equal-similarity non-matching candidate (AC6)', async () => {
      mockQdrant.search.mockResolvedValue([
        {
          id: 'no-match',
          score: 0.7,
          payload: { repo: 'memo-cli', rationale: 'unrelated rationale text', source: 'agent' },
        },
        {
          id: 'match',
          score: 0.7,
          payload: {
            repo: 'memo-cli',
            rationale: 'documents search-filters.ts directly',
            source: 'agent',
          },
        },
      ]);

      await handleSearch(
        { query: 'why does search-filters.ts build should clauses', limit: '5', json: true },
        deps,
      );

      const parsed = JSON.parse(stdoutData) as { results: { id: string }[] };
      expect(parsed.results[0]?.id).toBe('match');
    });
  });

  describe('query_id and --explain (#63)', () => {
    const explainDeps: SearchDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    const oneResult = [
      {
        id: 'result-1',
        score: 0.71,
        payload: {
          repo: 'memo-cli',
          rationale: 'A tagged decision about search-filters.ts',
          source: 'agent',
          tags: ['search'],
          timestamp_utc: new Date().toISOString(),
        },
      },
    ];

    beforeEach(() => {
      mockQdrant.search.mockResolvedValue(oneResult);
    });

    it('includes a UUID v4 query_id in every --json response (AC1)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true }, explainDeps);
      const parsed = JSON.parse(stdoutData) as { query_id: string };
      expect(parsed.query_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('generates a fresh query_id per invocation (AC2)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true }, explainDeps);
      const first = (JSON.parse(stdoutData) as { query_id: string }).query_id;

      stdoutData = '';
      await handleSearch({ query: 'q', limit: '5', json: true }, explainDeps);
      const second = (JSON.parse(stdoutData) as { query_id: string }).query_id;

      expect(first).not.toBe(second);
    });

    it('includes query_id even with zero results, and leaves the empty-state message unchanged (AC3, edge case)', async () => {
      mockQdrant.search.mockResolvedValue([]);
      await handleSearch({ query: 'q', limit: '5', json: true, explain: true }, explainDeps);
      const parsed = JSON.parse(stdoutData) as {
        query_id: string;
        message?: string;
        results: unknown[];
      };
      expect(typeof parsed.query_id).toBe('string');
      expect(parsed.results).toHaveLength(0);
      expect(parsed.message).toBe('No results found for the requested scope and filters.');
    });

    it('does not persist anything for query_id: no qdrant write/setPayload/batchUpdate calls exist to invoke (AC3)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true }, explainDeps);
      // search.ts never imports/calls any write-path qdrant method; the only
      // mocked methods it can call are read/scroll ones, all asserted below.
      expect(mockQdrant.ensureCollection).toHaveBeenCalledTimes(1);
      expect(mockQdrant.search).toHaveBeenCalledTimes(1);
    });

    it('adds a complete factors object to every result under --explain, including neutral values (AC5, AC8)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true, explain: true }, explainDeps);
      const parsed = JSON.parse(stdoutData) as {
        results: { factors: Record<string, unknown> }[];
      };
      expect(parsed.results).toHaveLength(1);
      const factors = parsed.results[0]?.factors;
      expect(factors).toEqual({
        similarity: expect.any(Number),
        recency_score: expect.any(Number),
        source_score: expect.any(Number),
        tag_boost: expect.any(Number),
        lexical_boost: expect.any(Number),
        retention: 1.0,
        use_ratio: 0,
        link_factor: 1.0,
        final_score: expect.any(Number),
      });
    });

    it('omits the factors object entirely when --explain is not set', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true }, explainDeps);
      const parsed = JSON.parse(stdoutData) as { results: Record<string, unknown>[] };
      expect(parsed.results[0]).not.toHaveProperty('factors');
    });

    it('shows lexical_boost: 0.0 (present, not omitted) under --explain with --lexical off (edge case)', async () => {
      await handleSearch(
        { query: 'q', limit: '5', json: true, explain: true, lexical: 'off' },
        explainDeps,
      );
      const parsed = JSON.parse(stdoutData) as {
        results: { factors: { lexical_boost: number } }[];
      };
      expect(parsed.results[0]?.factors.lexical_boost).toBe(0);
    });

    it('adds no extra Qdrant or embeddings calls under --explain (AC7)', async () => {
      await handleSearch({ query: 'q', limit: '5', json: true }, explainDeps);
      const baselineSearchCalls = mockQdrant.search.mock.calls.length;
      const baselineFetchByRepoCalls = mockQdrant.fetchByRepo.mock.calls.length;
      const baselineEmbedCalls = mockEmbeddings.embed.mock.calls.length;
      jest.clearAllMocks();
      mockQdrant.search.mockResolvedValue(oneResult);
      mockQdrant.fetchByRepo.mockResolvedValue([]);
      mockQdrant.scroll.mockResolvedValue([]);

      await handleSearch({ query: 'q', limit: '5', json: true, explain: true }, explainDeps);

      expect(mockQdrant.search.mock.calls.length).toBe(baselineSearchCalls);
      expect(mockQdrant.fetchByRepo.mock.calls.length).toBe(baselineFetchByRepoCalls);
      expect(mockEmbeddings.embed.mock.calls.length).toBe(baselineEmbedCalls);
    });

    it('does not change human-mode output without --explain (AC6)', async () => {
      await handleSearch({ query: 'q', limit: '5' }, explainDeps);
      expect(stdoutData).not.toContain('query_id');
      expect(stdoutData).not.toContain('retention');
    });

    it('renders an aligned factor table and the query_id footer under --explain in human mode (AC6)', async () => {
      await handleSearch({ query: 'q', limit: '5', explain: true }, explainDeps);
      expect(stdoutData).toContain('sim');
      expect(stdoutData).toContain('recency');
      expect(stdoutData).toContain('retention');
      expect(stdoutData).toContain('final');
      expect(stdoutData).toContain('query_id:');
    });
  });
});
