import { handleList } from '../../../src/commands/list.js';
import type { ListDeps } from '../../../src/commands/list.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  scroll: jest.fn(),
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

describe('list integration', () => {
  const deps: ListDeps = {
    loadCfg: jest.fn().mockResolvedValue(mockConfig),
    createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  it('returns the JSON contract with all payload fields', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      {
        id: 'entry-1',
        payload: {
          id: 'entry-1',
          repo: 'memo-cli',
          org: 'llipe',
          domain: 'developer-tools',
          rationale: 'List results should preserve every stored payload field in JSON mode.',
          tags: ['list', 'json'],
          entry_type: 'decision',
          source: 'agent',
          confidence: 'high',
          timestamp_utc: '2026-04-10T14:25:02.431Z',
          files_modified: ['src/commands/list.ts'],
          relates_to: ['platform-docs'],
          dedupe_key_sha256: 'abc123',
          dedupe_key_version: 'v1',
        },
      },
    ]);

    await handleList({ json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect((result['filters'] as Record<string, unknown>)['scope']).toBe('related');
    expect((result['filters'] as Record<string, unknown>)['limit']).toBe(20);
    expect(result['count']).toBe(1);
    expect((result['results'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 'entry-1',
      repo: 'memo-cli',
      timestamp_utc: '2026-04-10T14:25:02.431Z',
      files_modified: ['src/commands/list.ts'],
      dedupe_key_version: 'v1',
    });
  });

  it('returns success JSON for empty results', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await handleList(
      {
        json: true,
        from: '2026-01-01',
        to: '2026-01-31',
        entryType: 'integration_point',
        source: 'manual',
      },
      deps,
    );

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['count']).toBe(0);
    expect(result['message']).toBe('No entries found for the requested scope and filters.');
    expect(result['results']).toEqual([]);
    expect(result['filters']).toEqual({
      scope: 'related',
      repo: 'memo-cli',
      bank: 'kb',
      kind: 'all',
      org: 'llipe',
      entry_type: ['integration_point'],
      source: ['manual'],
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T23:59:59.999Z',
      limit: 20,
    });
  });

  it('passes normalized from/to filters to the repository', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await handleList({ json: true, from: '2026-02-01', to: '2026-02-03' }, deps);

    expect(mockQdrant.scroll).toHaveBeenCalledWith(
      expect.objectContaining({
        must: expect.arrayContaining([
          {
            key: 'timestamp_utc',
            range: {
              gte: '2026-02-01T00:00:00.000Z',
              lte: '2026-02-03T23:59:59.999Z',
            },
          },
        ]),
      }),
      20,
    );
  });

  it('passes entry-type filters to the repository', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await handleList({ json: true, entryType: 'structure' }, deps);

    expect(mockQdrant.scroll).toHaveBeenCalledWith(
      expect.objectContaining({
        must: expect.arrayContaining([{ key: 'entry_type', match: { value: 'structure' } }]),
      }),
      20,
    );
  });

  // S2-05 AC3 (PRD AC-2.4): two-bank isolation via `list`, confirming
  // isolation is not search-pipeline-specific (`list` uses `scroll`, not
  // `search` — E2E-3).
  describe('AC3 (PRD AC-2.4): two-bank isolation', () => {
    const corpus = [
      { id: 'a-1', payload: { repo: 'memo-cli', bank: 'a-memory', rationale: 'A' } },
      { id: 'b-1', payload: { repo: 'memo-cli', bank: 'b-memory', rationale: 'B' } },
    ];

    function bankOf(filter: Record<string, unknown>): string {
      const must = (filter['must'] ?? []) as Record<string, unknown>[];
      const direct = must.find(
        (c) =>
          c['key'] === 'bank' && typeof (c['match'] as { value?: unknown })?.value === 'string',
      );
      return direct ? (direct['match'] as { value: string }).value : 'kb';
    }

    beforeEach(() => {
      mockQdrant.scroll.mockImplementation((filter: Record<string, unknown>) => {
        const bank = bankOf(filter);
        return Promise.resolve(corpus.filter((c) => c.payload.bank === bank));
      });
    });

    it('memo list --bank a-memory never returns a b-memory entry', async () => {
      await handleList({ bank: 'a-memory', json: true }, deps);
      const parsed = JSON.parse(stdoutData) as { results: { id: string }[] };
      expect(parsed.results.map((r) => r.id)).toEqual(['a-1']);
    });

    it('memo list --bank b-memory never returns an a-memory entry', async () => {
      await handleList({ bank: 'b-memory', json: true }, deps);
      const parsed = JSON.parse(stdoutData) as { results: { id: string }[] };
      expect(parsed.results.map((r) => r.id)).toEqual(['b-1']);
    });
  });
});
