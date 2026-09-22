import { handleSearch } from '../../../src/commands/search.js';
import type { SearchDeps } from '../../../src/commands/search.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  search: jest.fn(),
  fetchStalenessCorpus: jest.fn().mockResolvedValue([]),
};

const mockEmbeddings = {
  embed: jest.fn().mockResolvedValue(new Array<number>(1536).fill(0.15)),
  dimensions: 1536,
};

const mockConfig = {
  schema_version: '1' as const,
  repo: 'memo-cli',
  org: 'llipe',
  domain: 'developer-tools',
  relates_to: ['platform-docs', 'agent-sdk'],
  defaults: { source: 'agent' as const, search_scope: 'related' as const },
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('search integration', () => {
  const deps: SearchDeps = {
    loadCfg: jest.fn().mockResolvedValue(mockConfig),
    createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  it('returns the JSON contract with payload fields plus similarity', async () => {
    mockQdrant.search.mockResolvedValueOnce([
      {
        id: 'entry-1',
        score: 0.8129,
        payload: {
          repo: 'memo-cli',
          org: 'llipe',
          domain: 'developer-tools',
          rationale: 'Entries are persisted through QdrantRepository after schema validation.',
          tags: ['qdrant', 'write-flow'],
          entry_type: 'decision',
          source: 'agent',
          confidence: 'high',
          timestamp_utc: '2026-04-10T14:25:02.431Z',
        },
      },
    ]);

    await handleSearch({ query: 'persist decisions', json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['query']).toBe('persist decisions');
    expect(result['count']).toBe(1);
    expect((result['filters'] as Record<string, unknown>)['scope']).toBe('related');
    expect((result['results'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 'entry-1',
      repo: 'memo-cli',
      similarity: 0.8129,
    });
  });

  it('returns success JSON for empty results', async () => {
    mockQdrant.search.mockResolvedValueOnce([]);

    await handleSearch({ query: 'missing decision', json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['count']).toBe(0);
    expect(result['message']).toBe('No results found for the requested scope and filters.');
    expect(result['results']).toEqual([]);
  });

  it('expands related scope using relates_to repositories from config', async () => {
    mockQdrant.search.mockResolvedValueOnce([]);

    await handleSearch({ query: 'cross repo decision' }, deps);

    // DEF-1: default --limit 10 over-fetches max(10, min(30, 50)) = 30 (D2).
    expect(mockQdrant.search).toHaveBeenCalledWith(
      expect.any(Array),
      {
        must: [
          { should: [{ key: 'bank', match: { value: 'kb' } }, { is_empty: { key: 'bank' } }] },
          { key: 'org', match: { value: 'llipe' } },
        ],
        must_not: [
          { key: 'kind', match: { value: 'self' } },
          { key: 'archived', match: { value: true } },
          { key: 'superseded', match: { value: true } },
        ],
        should: [
          { key: 'repo', match: { value: 'memo-cli' } },
          { key: 'repo', match: { value: 'platform-docs' } },
          { key: 'repo', match: { value: 'agent-sdk' } },
        ],
      },
      30,
    );
  });

  it('renders human-readable result output', async () => {
    mockQdrant.search.mockResolvedValueOnce([
      {
        id: 'entry-1',
        score: 0.91,
        payload: {
          repo: 'memo-cli',
          org: 'llipe',
          rationale: 'Use related scope to expand repo search coverage.',
          entry_type: 'decision',
          source: 'agent',
          tags: ['search', 'scope'],
        },
      },
    ]);

    await handleSearch({ query: 'scope expansion' }, deps);

    // D6: the human-output percentage is now final_score, not raw similarity.
    // similarity 0.91, no timestamp_utc (recency_score 0), source agent (1.0):
    // base = 0.6*0.91 + 0.3*0 + 0.1*1.0 = 0.646.
    // #36: query "scope expansion" matches the "scope" tag (matched=1,
    // total_query_terms=2) -> tag_boost = (1/2) * 0.05 = 0.025.
    // final_score = min(1, 0.646 + 0.025) = 0.671 -> 67%, not 91%.
    expect(stdoutData).toContain('memo-cli');
    expect(stdoutData).toContain('67%');
    expect(stdoutData).not.toContain('91%');
    expect(stdoutData).toContain('Use related scope to expand repo search coverage.');
  });

  // S2-05 AC3 (PRD AC-2.4): two-bank isolation, verified end-to-end against
  // a mocked repository that actually evaluates the bank predicate (not
  // just a structural filter-shape assertion) - `memo search --bank a-memory`
  // must never surface a `b-memory` entry, and vice versa.
  describe('AC3 (PRD AC-2.4): two-bank isolation', () => {
    const corpus = [
      { id: 'a-1', score: 0.9, payload: { repo: 'memo-cli', bank: 'a-memory', rationale: 'A' } },
      { id: 'b-1', score: 0.9, payload: { repo: 'memo-cli', bank: 'b-memory', rationale: 'B' } },
    ];

    function bankOf(filter: Record<string, unknown>): string {
      const must = (filter['must'] ?? []) as Record<string, unknown>[];
      const direct = must.find(
        (c) =>
          c['key'] === 'bank' && typeof (c['match'] as { value?: unknown })?.value === 'string',
      );
      if (direct) return (direct['match'] as { value: string }).value;
      // The `kb`-default `{ should: [...] }` clause matches only `bank: 'kb'`
      // (or absent) points, never `a-memory`/`b-memory`.
      return 'kb';
    }

    beforeEach(() => {
      mockQdrant.search.mockImplementation((_vector: number[], filter: Record<string, unknown>) => {
        const bank = bankOf(filter);
        return Promise.resolve(corpus.filter((c) => c.payload.bank === bank));
      });
    });

    it('memo search --bank a-memory never returns a b-memory entry', async () => {
      await handleSearch({ query: 'q', bank: 'a-memory', json: true }, deps);
      const parsed = JSON.parse(stdoutData) as { results: { id: string }[] };
      expect(parsed.results.map((r) => r.id)).toEqual(['a-1']);
    });

    it('memo search --bank b-memory never returns an a-memory entry', async () => {
      await handleSearch({ query: 'q', bank: 'b-memory', json: true }, deps);
      const parsed = JSON.parse(stdoutData) as { results: { id: string }[] };
      expect(parsed.results.map((r) => r.id)).toEqual(['b-1']);
    });
  });
});
