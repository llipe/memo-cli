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
        must: [{ key: 'org', match: { value: 'llipe' } }],
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

  it('throws when repo context cannot be resolved', async () => {
    const missingContextDeps: ListDeps = {
      ...deps,
      loadCfg: jest.fn().mockRejectedValue(new MemoError('CONFIG_NOT_FOUND', 'not found')),
    };

    await expect(handleList({}, missingContextDeps)).rejects.toMatchObject({
      code: 'REPO_CONTEXT_UNRESOLVED',
    });
  });
});
