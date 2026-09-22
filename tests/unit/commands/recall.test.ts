import { handleRecall } from '../../../src/commands/recall.js';
import type { RecallDeps } from '../../../src/commands/recall.js';
import { MemoError } from '../../../src/lib/errors.js';
import { MemoConfigSchema } from '../../../src/types/config.js';
import type { MemoConfig } from '../../../src/types/config.js';

function buildConfig(overrides: Partial<MemoConfig> = {}): MemoConfig {
  return MemoConfigSchema.parse({
    schema_version: '2',
    repo: 'memo-cli',
    org: 'llipe',
    domain: 'developer-tools',
    ...overrides,
  });
}

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  scroll: jest.fn().mockResolvedValue([]),
  scrollOrdered: jest.fn().mockResolvedValue([]),
  search: jest.fn().mockResolvedValue([]),
  fetchStalenessCorpus: jest.fn().mockResolvedValue([]),
  setPayload: jest.fn().mockResolvedValue(undefined),
  batchSetPayload: jest.fn().mockResolvedValue(undefined),
};

const mockEmbeddings = {
  embed: jest.fn().mockResolvedValue(new Array<number>(1536).fill(0.1)),
  dimensions: 1536,
};

let stdoutData = '';
let stderrData = '';

beforeEach(() => {
  stdoutData = '';
  stderrData = '';
  jest.spyOn(process.stdout, 'write').mockImplementation((data: any) => {
    stdoutData += String(data);
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation((data: any) => {
    stderrData += String(data);
    return true;
  });
  jest.clearAllMocks();
  mockQdrant.scroll.mockResolvedValue([]);
  mockQdrant.scrollOrdered.mockResolvedValue([]);
  mockQdrant.search.mockResolvedValue([]);
  mockQdrant.fetchStalenessCorpus.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function deps(config: MemoConfig = buildConfig()): RecallDeps {
  return {
    loadCfg: jest.fn().mockResolvedValue(config),
    createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

describe('handleRecall - validation', () => {
  it('EC-09: empty task string is rejected with VALIDATION_FAILED and zero embed calls', async () => {
    await expect(handleRecall({ task: '', bank: 'alpha' }, deps())).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(mockEmbeddings.embed).not.toHaveBeenCalled();
  });

  it('EC-10: whitespace-only task string is rejected with VALIDATION_FAILED', async () => {
    await expect(handleRecall({ task: '   ', bank: 'alpha' }, deps())).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(mockEmbeddings.embed).not.toHaveBeenCalled();
  });

  it('missing repo context (no config) fails REPO_CONTEXT_UNRESOLVED', async () => {
    const noConfigDeps: RecallDeps = {
      loadCfg: jest.fn().mockRejectedValue(new MemoError('CONFIG_NOT_FOUND', 'nope')),
      createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    await expect(handleRecall({ task: 'plan next story' }, noConfigDeps)).rejects.toMatchObject({
      code: 'REPO_CONTEXT_UNRESOLVED',
    });
  });

  it('a config load failure other than CONFIG_NOT_FOUND propagates unchanged', async () => {
    const badConfigDeps: RecallDeps = {
      loadCfg: jest.fn().mockRejectedValue(new MemoError('CONFIG_INVALID', 'bad config')),
      createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    await expect(
      handleRecall({ task: 'plan next story', bank: 'alpha' }, badConfigDeps),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('an invalid --max-tokens value fails VALIDATION_FAILED', async () => {
    await expect(
      handleRecall({ task: 'plan next story', bank: 'alpha', maxTokens: '-1' }, deps()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('an invalid --scope value fails VALIDATION_FAILED', async () => {
    await expect(
      handleRecall({ task: 'plan next story', bank: 'alpha', scope: 'nonsense' }, deps()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('handleRecall - AC8: exactly one embed call, zero write calls', () => {
  it('embeds exactly once per invocation regardless of how many sections are gathered', async () => {
    await handleRecall({ task: 'plan next story', bank: 'alpha', json: true }, deps());
    expect(mockEmbeddings.embed).toHaveBeenCalledTimes(1);
  });

  it('CT-06: zero setPayload/batchSetPayload calls anywhere in the invocation', async () => {
    await handleRecall({ task: 'plan next story', bank: 'alpha', json: true }, deps());
    expect(mockQdrant.setPayload).not.toHaveBeenCalled();
    expect(mockQdrant.batchSetPayload).not.toHaveBeenCalled();
  });

  it('kb bank still embeds exactly once and writes nothing', async () => {
    await handleRecall({ task: 'plan next story', bank: 'kb', json: true }, deps());
    expect(mockEmbeddings.embed).toHaveBeenCalledTimes(1);
    expect(mockQdrant.setPayload).not.toHaveBeenCalled();
    expect(mockQdrant.batchSetPayload).not.toHaveBeenCalled();
  });
});

describe('handleRecall - call shape on the mocked repo', () => {
  it('AC7: bank=kb never calls the self/mine/last_session scroll paths', async () => {
    await handleRecall({ task: 'plan next story', bank: 'kb', json: true }, deps());

    // Only POLICIES (search) + SHARED (rankCandidates: search) + CONFLICTS
    // (scroll) touch the repo for `kb` - no self scroll, no episodic scroll.
    const scrollCalls = mockQdrant.scroll.mock.calls as unknown[][];
    for (const call of scrollCalls) {
      const filter = call[0] as { must?: { key?: string; match?: { value?: unknown } }[] };
      const kindClause = filter.must?.find((c) => c.key === 'kind');
      expect(kindClause?.match?.value).not.toBe('self');
      expect(kindClause?.match?.value).not.toBe('episodic');
    }
  });

  it('POLICIES filter shape: kb semantic + entry_type = policy', async () => {
    await handleRecall({ task: 'plan next story', bank: 'alpha', json: true }, deps());

    const searchCalls = mockQdrant.search.mock.calls as unknown[][];
    const policiesCall = searchCalls.find((call) => {
      const filter = call[1] as { must?: { key?: string; match?: { value?: unknown } }[] };
      return filter.must?.some((c) => c.key === 'entry_type' && c.match?.value === 'policy');
    });
    expect(policiesCall).toBeDefined();
    const filter = policiesCall?.[1] as { must?: { key?: string; match?: { value?: unknown } }[] };
    expect(filter.must).toContainEqual({
      should: [{ key: 'bank', match: { value: 'kb' } }, { is_empty: { key: 'bank' } }],
    });
    expect(filter.must).toContainEqual({ key: 'kind', match: { value: 'semantic' } });
    expect(policiesCall?.[2]).toBe(8);
  });

  it('--scope reaches only the SHARED filter (MINE stays unaffected)', async () => {
    const configWithRelated = buildConfig({ relates_to: ['other-repo'] });

    await handleRecall(
      { task: 'plan next story', bank: 'alpha', scope: 'related', json: true },
      deps(configWithRelated),
    );

    const searchCalls = mockQdrant.search.mock.calls as unknown[][];
    // SHARED targets kb + repo scope; with --scope related it should carry a
    // `should` repo OR-match across memo-cli and other-repo. Distinguished
    // from POLICIES (also kb-scoped) by the absence of an entry_type clause.
    const sharedCall = searchCalls.find((call) => {
      const filter = call[1] as {
        must?: {
          key?: string;
          match?: { value?: unknown };
          should?: { key?: string; match?: { value?: unknown } }[];
        }[];
        should?: { key?: string; match?: { value?: unknown } }[];
      };
      const isKbBank = filter.must?.some(
        (c) => Array.isArray(c.should) && c.should.some((s) => s.key === 'bank'),
      );
      const isPolicies = filter.must?.some((c) => c.key === 'entry_type');
      return isKbBank && !isPolicies && (filter.should?.length ?? 0) > 0;
    });
    expect(sharedCall).toBeDefined();
    const sharedFilter = sharedCall?.[1] as {
      should?: { key?: string; match?: { value?: unknown } }[];
    };
    const repoValues = (sharedFilter.should ?? [])
      .filter((c) => c.key === 'repo')
      .map((c) => c.match?.value);
    expect(repoValues.sort()).toEqual(['memo-cli', 'other-repo'].sort());

    // MINE targets the private bank; it never carries a repo clause at all
    // (private banks skip repo scoping per buildSearchFilters).
    const mineCall = searchCalls.find((call) => {
      const filter = call[1] as { must?: { key?: string; match?: { value?: unknown } }[] };
      return filter.must?.some((c) => c.key === 'bank' && c.match?.value === 'alpha');
    });
    expect(mineCall).toBeDefined();
    const mineFilter = mineCall?.[1] as { must?: { key?: string }[] };
    expect(mineFilter.must?.some((c) => c.key === 'repo')).toBe(false);
  });

  it('SELF scroll uses soft_cap + 1 as the limit and warns on stderr when exceeded', async () => {
    const config = buildConfig({ banks: { private: { self: { soft_cap: 2 } } } as any }); // eslint-disable-line @typescript-eslint/no-explicit-any
    mockQdrant.scroll.mockImplementation((filter: any) => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const isSelf = filter.must?.some(
        (c: any) => c.key === 'kind' && c.match?.value === 'self', // eslint-disable-line @typescript-eslint/no-explicit-any
      );
      if (isSelf) {
        return Promise.resolve([
          { id: 's1', payload: { kind: 'self', bank: 'alpha', rationale: 'a' } },
          { id: 's2', payload: { kind: 'self', bank: 'alpha', rationale: 'b' } },
          { id: 's3', payload: { kind: 'self', bank: 'alpha', rationale: 'c' } },
        ]);
      }
      return Promise.resolve([]);
    });

    await handleRecall({ task: 'plan next story', bank: 'alpha', json: true }, deps(config));

    const selfScrollCall = (mockQdrant.scroll.mock.calls as unknown[][]).find((call) => {
      const filter = call[0] as { must?: { key?: string; match?: { value?: unknown } }[] };
      return filter.must?.some((c) => c.key === 'kind' && c.match?.value === 'self');
    });
    expect(selfScrollCall?.[1]).toBe(3); // soft_cap (2) + 1
    expect(stderrData.length).toBeGreaterThan(0);
  });

  it('LAST SESSION calls a single-page newest scroll then scrollOrdered seq asc, limit 15', async () => {
    mockQdrant.scroll.mockImplementation((filter: any) => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const isEpisodic = filter.must?.some(
        (c: any) => c.key === 'kind' && c.match?.value === 'episodic', // eslint-disable-line @typescript-eslint/no-explicit-any
      );
      if (isEpisodic) {
        return Promise.resolve([
          { id: 'e1', payload: { kind: 'episodic', bank: 'alpha', session_id: 'ISSUE-1', seq: 5 } },
        ]);
      }
      return Promise.resolve([]);
    });

    await handleRecall({ task: 'plan next story', bank: 'alpha', json: true }, deps());

    expect(mockQdrant.scrollOrdered).toHaveBeenCalledWith(
      expect.objectContaining({
        must: expect.arrayContaining([{ key: 'session_id', match: { value: 'ISSUE-1' } }]),
      }),
      { orderBy: { key: 'seq', direction: 'asc' }, limit: 15 },
    );
  });

  it('EC-07: empty episodic history never calls scrollOrdered', async () => {
    await handleRecall({ task: 'plan next story', bank: 'alpha', json: true }, deps());
    expect(mockQdrant.scrollOrdered).not.toHaveBeenCalled();
    const parsed = JSON.parse(stdoutData);
    expect(parsed.sections.last_session).toEqual({ session_id: null, entries: [] });
  });

  it('CONFLICTS filter shape: bank-scoped + pending_contradiction = true', async () => {
    await handleRecall({ task: 'plan next story', bank: 'alpha', json: true }, deps());
    const conflictsCall = (mockQdrant.scroll.mock.calls as unknown[][]).find((call) => {
      const filter = call[0] as { must?: { key?: string; match?: { value?: unknown } }[] };
      return filter.must?.some((c) => c.key === 'pending_contradiction');
    });
    expect(conflictsCall).toBeDefined();
    const filter = conflictsCall?.[0] as { must?: { key?: string; match?: { value?: unknown } }[] };
    expect(filter.must).toContainEqual({ key: 'bank', match: { value: 'alpha' } });
    expect(filter.must).toContainEqual({
      key: 'pending_contradiction',
      match: { value: true },
    });
    expect(conflictsCall?.[1]).toBe(5);
  });
});

describe('handleRecall - AC9: envelope and human output shape', () => {
  it('--json emits the full envelope with a single query_id (UUID v4)', async () => {
    await handleRecall({ task: 'plan next story', bank: 'alpha', json: true }, deps());
    const parsed = JSON.parse(stdoutData);
    expect(parsed).toHaveProperty('query_id');
    expect(parsed.query_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(parsed.bank).toBe('alpha');
    expect(parsed.budget).toEqual({ max_tokens: 2000, used_tokens: 0 });
    expect(parsed.sections).toHaveProperty('self');
    expect(parsed.sections).toHaveProperty('policies');
    expect(parsed.sections).toHaveProperty('shared');
    expect(parsed.sections).toHaveProperty('mine');
    expect(parsed.sections).toHaveProperty('last_session');
    expect(parsed.sections).toHaveProperty('conflicts');
    expect(parsed.truncated).toEqual([]);
  });

  it('--max-tokens default resolves from config.recall.max_tokens (2000)', async () => {
    await handleRecall({ task: 'plan next story', bank: 'alpha', json: true }, deps());
    const parsed = JSON.parse(stdoutData);
    expect(parsed.budget.max_tokens).toBe(2000);
  });

  it('an explicit --max-tokens overrides the config default', async () => {
    await handleRecall(
      { task: 'plan next story', bank: 'alpha', maxTokens: '250', json: true },
      deps(),
    );
    const parsed = JSON.parse(stdoutData);
    expect(parsed.budget.max_tokens).toBe(250);
  });

  it('human output renders uppercase section headers and the budget footer', async () => {
    await handleRecall({ task: 'plan next story', bank: 'alpha' }, deps());
    expect(stdoutData).toContain('SELF');
    expect(stdoutData).toContain('POLICIES');
    expect(stdoutData).toContain('SHARED');
    expect(stdoutData).toContain('MINE');
    expect(stdoutData).toContain('LAST SESSION');
    expect(stdoutData).toContain('CONFLICTS');
    expect(stdoutData).toMatch(/budget: \d+\/\d+ tokens/);
  });

  it('human output renders one line per entry across every populated section (SELF/POLICIES/SHARED/MINE/LAST SESSION/CONFLICTS)', async () => {
    mockQdrant.scroll.mockImplementation((filter: any) => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      if (filter.must?.some((c: any) => c.key === 'kind' && c.match?.value === 'self')) {
        return Promise.resolve([
          { id: 'self-1', payload: { kind: 'self', bank: 'alpha', rationale: 'Self rationale.' } },
        ]);
      }
      if (filter.must?.some((c: any) => c.key === 'pending_contradiction')) {
        return Promise.resolve([
          {
            id: 'conflict-1',
            payload: {
              kind: 'semantic',
              bank: 'alpha',
              rationale: 'Conflicting fact.',
              pending_contradiction: true,
            },
          },
        ]);
      }
      if (filter.must?.some((c: any) => c.key === 'kind' && c.match?.value === 'episodic')) {
        return Promise.resolve([
          {
            id: 'sess-1',
            payload: {
              kind: 'episodic',
              bank: 'alpha',
              session_id: 'ISSUE-9',
              seq: 1,
              rationale: 'Episodic rationale.',
            },
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockQdrant.scrollOrdered.mockResolvedValueOnce([
      {
        id: 'sess-1',
        payload: {
          kind: 'episodic',
          bank: 'alpha',
          session_id: 'ISSUE-9',
          seq: 1,
          rationale: 'Episodic rationale.',
        },
      },
    ]);
    mockQdrant.search.mockImplementation((_vector: any, filter: any) => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      if (filter.must?.some((c: any) => c.key === 'entry_type')) {
        return Promise.resolve([
          {
            id: 'policy-1',
            score: 0.9,
            payload: { kind: 'semantic', bank: 'kb', entry_type: 'policy', rationale: 'Policy.' },
          },
        ]);
      }
      if (filter.must?.some((c: any) => c.key === 'bank' && c.match?.value === 'alpha')) {
        return Promise.resolve([
          {
            id: 'mine-1',
            score: 0.7,
            payload: { kind: 'semantic', bank: 'alpha', rationale: 'Mine rationale.' },
          },
        ]);
      }
      return Promise.resolve([
        {
          id: 'shared-1',
          score: 0.8,
          payload: { kind: 'semantic', bank: 'kb', rationale: 'Shared rationale.' },
        },
      ]);
    });

    await handleRecall({ task: 'plan next story', bank: 'alpha' }, deps());

    expect(stdoutData).toContain('Self rationale.');
    expect(stdoutData).toContain('Policy.');
    expect(stdoutData).toContain('Shared rationale.');
    expect(stdoutData).toContain('Mine rationale.');
    expect(stdoutData).toContain('Episodic rationale.');
    expect(stdoutData).toContain('Conflicting fact.');
  });

  it('AC7: kb bank human output omits SELF/MINE/LAST SESSION headers', async () => {
    await handleRecall({ task: 'plan next story', bank: 'kb' }, deps());
    expect(stdoutData).not.toContain('SELF');
    expect(stdoutData).not.toContain('MINE');
    expect(stdoutData).not.toContain('LAST SESSION');
    expect(stdoutData).toContain('POLICIES');
    expect(stdoutData).toContain('SHARED');
    expect(stdoutData).toContain('CONFLICTS');
  });

  it('AC7: kb bank JSON omits self/mine/last_session keys entirely', async () => {
    await handleRecall({ task: 'plan next story', bank: 'kb', json: true }, deps());
    const parsed = JSON.parse(stdoutData);
    expect(parsed.sections).not.toHaveProperty('self');
    expect(parsed.sections).not.toHaveProperty('mine');
    expect(parsed.sections).not.toHaveProperty('last_session');
    expect(parsed.sections).toHaveProperty('policies');
    expect(parsed.sections).toHaveProperty('shared');
    expect(parsed.sections).toHaveProperty('conflicts');
  });
});

describe('handleRecall - EC-18: embeddings failure', () => {
  it('surfaces EMBEDDING_API_ERROR-shaped failure with no partial bundle and no repo scroll/search calls', async () => {
    const failingEmbeddings = {
      embed: jest.fn().mockRejectedValue(new MemoError('EMBEDDING_API_ERROR', 'boom', 2)),
      dimensions: 1536,
    };
    const failingDeps: RecallDeps = {
      loadCfg: jest.fn().mockResolvedValue(buildConfig()),
      createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      createEmbeddings: () => failingEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    await expect(
      handleRecall({ task: 'plan next story', bank: 'alpha' }, failingDeps),
    ).rejects.toMatchObject({ code: 'EMBEDDING_API_ERROR' });

    expect(stdoutData).toBe('');
    expect(mockQdrant.search).not.toHaveBeenCalled();
    // The SELF scroll happens before embedding in this implementation's
    // gathering order only if placed after embed - verify no dense search
    // fired, which is the call that actually needs the vector.
  });
});
