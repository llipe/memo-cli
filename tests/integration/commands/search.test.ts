import { handleSearch } from '../../../src/commands/search.js';
import type { SearchDeps } from '../../../src/commands/search.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  search: jest.fn(),
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

    expect(mockQdrant.search).toHaveBeenCalledWith(
      expect.any(Array),
      {
        must: [{ key: 'org', match: { value: 'llipe' } }],
        should: [
          { key: 'repo', match: { value: 'memo-cli' } },
          { key: 'repo', match: { value: 'platform-docs' } },
          { key: 'repo', match: { value: 'agent-sdk' } },
        ],
      },
      10,
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

    expect(stdoutData).toContain('memo-cli');
    expect(stdoutData).toContain('91%');
    expect(stdoutData).toContain('Use related scope to expand repo search coverage.');
  });
});
