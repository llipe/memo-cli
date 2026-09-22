import { handleList } from '../../../src/commands/list.js';
import type { ListDeps } from '../../../src/commands/list.js';
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
  jest.spyOn(process.stdout, 'write').mockImplementation((data: any) => {
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

describe('handleList', () => {
  const deps: ListDeps = {
    loadCfg: jest.fn().mockResolvedValue(mockConfig),
    createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  it('resolves config context, builds filters, and calls scroll with normalized range', async () => {
    await handleList(
      {
        entryType: 'decision,structure',
        source: 'agent,manual',
        from: '2026-01-01',
        to: '2026-01-31',
        limit: '5',
      },
      deps,
    );

    expect(mockQdrant.ensureCollection).toHaveBeenCalled();
    expect(mockQdrant.scroll).toHaveBeenCalledWith(
      {
        must: [
          { should: [{ key: 'bank', match: { value: 'kb' } }, { is_empty: { key: 'bank' } }] },
          { key: 'org', match: { value: 'llipe' } },
          { key: 'entry_type', match: { any: ['decision', 'structure'] } },
          { key: 'source', match: { any: ['agent', 'manual'] } },
          {
            key: 'timestamp_utc',
            range: {
              gte: '2026-01-01T00:00:00.000Z',
              lte: '2026-01-31T23:59:59.999Z',
            },
          },
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
      5,
    );
  });

  it('defaults limit to 20 and renders the human empty state', async () => {
    await handleList({}, deps);

    expect(mockQdrant.scroll).toHaveBeenCalledWith(
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
        ],
      },
      20,
    );
    expect(stdoutData).toContain('No entries found.');
    expect(stdoutData).toContain('count: 0');
  });

  it('filters by tags when provided', async () => {
    await handleList(
      {
        tags: 'auth,security',
        limit: '10',
      },
      deps,
    );

    expect(mockQdrant.scroll).toHaveBeenCalledWith(
      {
        must: [
          { should: [{ key: 'bank', match: { value: 'kb' } }, { is_empty: { key: 'bank' } }] },
          { key: 'org', match: { value: 'llipe' } },
          { key: 'tags', match: { any: ['auth', 'security'] } },
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
      10,
    );
  });

  it('throws when repo context cannot be resolved', async () => {
    const missingContextDeps: ListDeps = {
      ...deps,
      loadCfg: jest.fn().mockRejectedValue(new MemoError('CONFIG_NOT_FOUND', 'not found')),
    };

    await expect(handleList({}, missingContextDeps)).rejects.toMatchObject({
      code: 'REPO_CONTEXT_UNRESOLVED',
    });
  });

  describe('S2-05: read-side flags (spec §18.7)', () => {
    it('AC1: an invalid --kind value fails VALIDATION_FAILED', async () => {
      await expect(handleList({ kind: 'bogus' }, deps)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('AC1: a non-ISO --as-of value fails VALIDATION_FAILED', async () => {
      await expect(handleList({ asOf: 'not-a-date' }, deps)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('AC3 (PRD AC-2.4): --bank pins the bank clause', async () => {
      await handleList({ bank: 'a-memory' }, deps);
      expect(mockQdrant.scroll).toHaveBeenCalledWith(
        expect.objectContaining({
          must: expect.arrayContaining([{ key: 'bank', match: { value: 'a-memory' } }]),
        }),
        20,
      );
    });

    it('AC8: the JSON envelope filters gain bank/kind/session/as_of', async () => {
      await handleList(
        { json: true, bank: 'a-memory', kind: 'episodic', session: 's-1', asOf: '2026-01-01' },
        deps,
      );
      const result = JSON.parse(stdoutData) as { filters: Record<string, unknown> };
      expect(result.filters).toMatchObject({
        bank: 'a-memory',
        kind: 'episodic',
        session: 's-1',
        as_of: '2026-01-01T00:00:00.000Z',
      });
    });

    it('AC8: JSON rows add bank/kind, and archived/superseded only when true (CT-1)', async () => {
      mockQdrant.scroll.mockResolvedValueOnce([
        { id: 'active', payload: { repo: 'memo-cli', rationale: 'Active' } },
        { id: 'archived', payload: { repo: 'memo-cli', rationale: 'Archived', archived: true } },
      ]);

      await handleList({ json: true, includeArchived: true }, deps);
      const result = JSON.parse(stdoutData) as { results: Record<string, unknown>[] };
      const active = result.results.find((r) => r['id'] === 'active');
      const archived = result.results.find((r) => r['id'] === 'archived');

      expect(active).toMatchObject({ bank: 'kb', kind: 'semantic' });
      expect(active).not.toHaveProperty('archived');
      expect(archived).toMatchObject({ bank: 'kb', kind: 'semantic', archived: true });
    });

    it('AC6: prefixes an archived row with [archived] in human output', async () => {
      mockQdrant.scroll.mockResolvedValueOnce([
        {
          id: 'archived',
          payload: { repo: 'memo-cli', rationale: 'Archived note', archived: true },
        },
      ]);

      await handleList({ includeArchived: true }, deps);
      expect(stdoutData).toContain('[archived]');
    });

    it('AC7: --as-of implies --include-superseded (must_not omits the superseded exclusion)', async () => {
      await handleList({ asOf: '2026-01-01' }, deps);
      const [filterArg] = mockQdrant.scroll.mock.calls[0] as [Record<string, unknown>];
      const mustNot = (filterArg['must_not'] ?? []) as Record<string, unknown>[];
      expect(mustNot).not.toContainEqual({ key: 'superseded', match: { value: true } });
    });
  });
});
