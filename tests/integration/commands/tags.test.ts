import { handleTagsList } from '../../../src/commands/tags.js';
import type { TagsListDeps } from '../../../src/commands/tags.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  scroll: jest.fn(),
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

describe('tags list integration', () => {
  const deps: TagsListDeps = {
    loadCfg: jest.fn().mockResolvedValue(mockConfig),
    createRepo: () => mockQdrant as unknown as ReturnType<NonNullable<TagsListDeps['createRepo']>>,
  };

  it('returns JSON contract with tag counts', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { repo: 'memo-cli', tags: ['auth', 'security'] } },
      { id: '2', payload: { repo: 'memo-cli', tags: ['auth', 'api'] } },
      { id: '3', payload: { repo: 'memo-cli', tags: ['api'] } },
    ]);

    await handleTagsList({ json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['scope']).toBe('repo');
    expect(result['repos']).toEqual(['memo-cli']);
    expect(result['total']).toBe(3);

    const tags = result['tags'] as Array<{ name: string; count: number }>;
    expect(tags).toHaveLength(3);
    expect(tags.find((t) => t.name === 'auth')?.count).toBe(2);
    expect(tags.find((t) => t.name === 'api')?.count).toBe(2);
    expect(tags.find((t) => t.name === 'security')?.count).toBe(1);
  });

  it('returns human output sorted alpha by default', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { tags: ['zebra', 'auth'] } },
      { id: '2', payload: { tags: ['security'] } },
    ]);

    await handleTagsList({}, deps);

    expect(stdoutData).toContain('Tags (3 total):');
    expect(stdoutData.indexOf('auth')).toBeLessThan(stdoutData.indexOf('security'));
    expect(stdoutData.indexOf('security')).toBeLessThan(stdoutData.indexOf('zebra'));
  });

  it('returns human output sorted by frequency with --sort frequency', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { tags: ['auth', 'api'] } },
      { id: '2', payload: { tags: ['auth'] } },
    ]);

    await handleTagsList({ sort: 'frequency' }, deps);

    expect(stdoutData).toContain('Tags (2 total):');
    expect(stdoutData).toContain('auth  (2 entries)');
    expect(stdoutData).toContain('api  (1 entry)');
    expect(stdoutData.indexOf('auth')).toBeLessThan(stdoutData.indexOf('api'));
  });

  it('passes repo filter for scope repo', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await handleTagsList({}, deps);

    expect(mockQdrant.scroll).toHaveBeenCalledWith(
      {
        must: [
          { should: [{ key: 'bank', match: { value: 'kb' } }, { is_empty: { key: 'bank' } }] },
          { key: 'repo', match: { value: 'memo-cli' } },
        ],
        must_not: [
          { key: 'kind', match: { value: 'self' } },
          { key: 'archived', match: { value: true } },
          { key: 'superseded', match: { value: true } },
        ],
      },
      10_000,
    );
  });

  it('passes multi-repo should filter for scope related', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await handleTagsList({ scope: 'related' }, deps);

    expect(mockQdrant.scroll).toHaveBeenCalledWith(
      {
        must: [
          { should: [{ key: 'bank', match: { value: 'kb' } }, { is_empty: { key: 'bank' } }] },
        ],
        must_not: [
          { key: 'kind', match: { value: 'self' } },
          { key: 'archived', match: { value: true } },
          { key: 'superseded', match: { value: true } },
        ],
        should: [
          { key: 'repo', match: { value: 'memo-cli' } },
          { key: 'repo', match: { value: 'platform-docs' } },
        ],
      },
      10_000,
    );
  });

  it('includes related repos in JSON output for scope related', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([{ id: '1', payload: { tags: ['shared'] } }]);

    await handleTagsList({ scope: 'related', json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['scope']).toBe('related');
    expect(result['repos']).toEqual(['memo-cli', 'platform-docs']);
  });

  it('outputs no-tags message for empty result', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await handleTagsList({}, deps);

    expect(stdoutData).toContain('No tags found.');
  });

  it('outputs empty JSON for empty result with --json', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await handleTagsList({ json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['tags']).toEqual([]);
    expect(result['total']).toBe(0);
    expect(result['scope']).toBe('repo');
    expect(result['repos']).toEqual(['memo-cli']);
  });

  it('skips entries without tags in aggregation', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { repo: 'memo-cli' } },
      { id: '2', payload: { repo: 'memo-cli', tags: ['api'] } },
      { id: '3', payload: { repo: 'memo-cli', tags: null } },
    ]);

    await handleTagsList({ json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    const tags = result['tags'] as Array<{ name: string; count: number }>;
    expect(tags).toEqual([{ name: 'api', count: 1 }]);
    expect(result['total']).toBe(1);
  });

  // S2-05 EC-11 / AC3 (PRD AC-2.4).
  describe('bank scoping (S2-05)', () => {
    it('EC-11: an empty private bank returns exit 0 and count 0, not an error', async () => {
      mockQdrant.scroll.mockResolvedValueOnce([]);

      await handleTagsList({ bank: 'empty-bank', json: true }, deps);

      const result = JSON.parse(stdoutData) as Record<string, unknown>;
      expect(result['tags']).toEqual([]);
      expect(result['total']).toBe(0);
      expect(result['bank']).toBe('empty-bank');
    });

    it('AC3: tags list --bank a-memory never returns a b-memory tag', async () => {
      mockQdrant.scroll.mockImplementation((filter: Record<string, unknown>) => {
        const must = (filter['must'] ?? []) as Record<string, unknown>[];
        const direct = must.find(
          (c) =>
            c['key'] === 'bank' && typeof (c['match'] as { value?: unknown })?.value === 'string',
        );
        const bank = direct ? (direct['match'] as { value: string }).value : 'kb';
        const corpus: Record<string, { id: string; payload: Record<string, unknown> }[]> = {
          'a-memory': [{ id: 'a-1', payload: { bank: 'a-memory', tags: ['a-tag'] } }],
          'b-memory': [{ id: 'b-1', payload: { bank: 'b-memory', tags: ['b-tag'] } }],
        };
        return Promise.resolve(corpus[bank] ?? []);
      });

      await handleTagsList({ bank: 'a-memory', json: true }, deps);
      const result = JSON.parse(stdoutData) as { tags: { name: string }[] };
      expect(result.tags.map((t) => t.name)).toEqual(['a-tag']);
    });
  });
});
