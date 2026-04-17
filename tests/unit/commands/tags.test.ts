import { handleTagsList } from '../../../src/commands/tags.js';
import type { TagsListDeps } from '../../../src/commands/tags.js';
import { MemoError } from '../../../src/lib/errors.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  scroll: jest.fn().mockResolvedValue([]),
};

const mockConfig = {
  schema_version: '1' as const,
  repo: 'memo-cli',
  org: 'llipe',
  domain: 'developer-tools',
  relates_to: ['platform-docs'],
  defaults: { source: 'agent' as const, search_scope: 'related' as const },
};

let stdoutData = '';

beforeEach(() => {
  stdoutData = '';
  jest.spyOn(process.stdout, 'write').mockImplementation((data: unknown) => {
    stdoutData += String(data);
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  jest.clearAllMocks();
  mockQdrant.scroll.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('handleTagsList', () => {
  it('calls aggregate with the tags field and repo filter', async () => {
    const mockAggregate = jest.fn().mockResolvedValue([]);
    const deps: TagsListDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () =>
        mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
      aggregate: mockAggregate,
    };

    await handleTagsList({}, deps);

    expect(mockAggregate).toHaveBeenCalledWith('tags', expect.any(Function), {
      must: [{ key: 'repo', match: { value: 'memo-cli' } }],
    });
  });

  it('passes multi-repo filter for scope related', async () => {
    const mockAggregate = jest.fn().mockResolvedValue([]);
    const deps: TagsListDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () =>
        mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
      aggregate: mockAggregate,
    };

    await handleTagsList({ scope: 'related' }, deps);

    expect(mockAggregate).toHaveBeenCalledWith('tags', expect.any(Function), {
      should: [
        { key: 'repo', match: { value: 'memo-cli' } },
        { key: 'repo', match: { value: 'platform-docs' } },
      ],
    });
  });

  it('outputs human-readable list sorted alpha by default', async () => {
    const mockAggregate = jest.fn().mockResolvedValue([
      { name: 'zebra', count: 1 },
      { name: 'auth', count: 3 },
      { name: 'security', count: 2 },
    ]);
    const deps: TagsListDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () =>
        mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
      aggregate: mockAggregate,
    };

    await handleTagsList({}, deps);

    expect(stdoutData).toContain('Tags (3 total):');
    expect(stdoutData).toContain('auth  (3 entries)');
    expect(stdoutData).toContain('security  (2 entries)');
    expect(stdoutData).toContain('zebra  (1 entry)');
    expect(stdoutData.indexOf('auth')).toBeLessThan(stdoutData.indexOf('security'));
    expect(stdoutData.indexOf('security')).toBeLessThan(stdoutData.indexOf('zebra'));
  });

  it('sorts by frequency when --sort frequency', async () => {
    const mockAggregate = jest.fn().mockResolvedValue([
      { name: 'zebra', count: 1 },
      { name: 'auth', count: 3 },
      { name: 'security', count: 2 },
    ]);
    const deps: TagsListDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () =>
        mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
      aggregate: mockAggregate,
    };

    await handleTagsList({ sort: 'frequency' }, deps);

    expect(stdoutData.indexOf('auth')).toBeLessThan(stdoutData.indexOf('security'));
    expect(stdoutData.indexOf('security')).toBeLessThan(stdoutData.indexOf('zebra'));
  });

  it('outputs --json contract', async () => {
    const mockAggregate = jest.fn().mockResolvedValue([{ name: 'auth', count: 3 }]);
    const deps: TagsListDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () =>
        mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
      aggregate: mockAggregate,
    };

    await handleTagsList({ json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['tags']).toEqual([{ name: 'auth', count: 3 }]);
    expect(result['total']).toBe(1);
    expect(result['scope']).toBe('repo');
    expect(result['repos']).toEqual(['memo-cli']);
  });

  it('outputs --json with scope related and repos list', async () => {
    const mockAggregate = jest.fn().mockResolvedValue([{ name: 'api', count: 1 }]);
    const deps: TagsListDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () =>
        mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
      aggregate: mockAggregate,
    };

    await handleTagsList({ scope: 'related', json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['scope']).toBe('related');
    expect(result['repos']).toEqual(['memo-cli', 'platform-docs']);
  });

  it('outputs no-tags message when empty', async () => {
    const mockAggregate = jest.fn().mockResolvedValue([]);
    const deps: TagsListDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () =>
        mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
      aggregate: mockAggregate,
    };

    await handleTagsList({}, deps);

    expect(stdoutData).toContain('No tags found.');
  });

  it('outputs empty JSON with total 0 when empty and --json', async () => {
    const mockAggregate = jest.fn().mockResolvedValue([]);
    const deps: TagsListDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () =>
        mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
      aggregate: mockAggregate,
    };

    await handleTagsList({ json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['tags']).toEqual([]);
    expect(result['total']).toBe(0);
    expect(result['scope']).toBe('repo');
    expect(result['repos']).toEqual(['memo-cli']);
  });

  it('throws REPO_CONTEXT_UNRESOLVED when config has no repo', async () => {
    const deps: TagsListDeps = {
      loadCfg: jest.fn().mockRejectedValue(new MemoError('CONFIG_NOT_FOUND', 'not found')),
      createRepo: () =>
        mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
      aggregate: jest.fn(),
    };

    await expect(handleTagsList({}, deps)).rejects.toMatchObject({
      code: 'REPO_CONTEXT_UNRESOLVED',
    });
  });

  it('throws VALIDATION_FAILED for invalid --scope', async () => {
    const deps: TagsListDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () =>
        mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
      aggregate: jest.fn(),
    };

    await expect(handleTagsList({ scope: 'invalid' }, deps)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('throws VALIDATION_FAILED for invalid --sort', async () => {
    const deps: TagsListDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () =>
        mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
      aggregate: jest.fn(),
    };

    await expect(handleTagsList({ sort: 'bogus' }, deps)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('ensureCollection is called before aggregation', async () => {
    const mockAggregate = jest.fn().mockResolvedValue([]);
    const deps: TagsListDeps = {
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      createRepo: () =>
        mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
      aggregate: mockAggregate,
    };

    await handleTagsList({}, deps);

    expect(mockQdrant.ensureCollection).toHaveBeenCalled();
    expect(mockAggregate).toHaveBeenCalled();
  });
});
