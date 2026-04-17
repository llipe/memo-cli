import { buildSearchVectorInput, handleSearch } from '../../../src/commands/search.js';
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

describe('handleSearch', () => {
  const deps: SearchDeps = {
    loadCfg: jest.fn().mockResolvedValue(mockConfig),
    createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  it('embeds query plus tags and calls search with the built filter', async () => {
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
      3,
    );
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

  it('renders an empty-state message in human mode', async () => {
    await handleSearch({ query: 'missing decision' }, deps);

    expect(stdoutData).toContain('No results found.');
    expect(stdoutData).toContain('tip: broaden the query');
  });
});
