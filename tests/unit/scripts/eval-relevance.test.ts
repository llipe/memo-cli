import {
  EvalEntrySeedSchema,
  EvalQuerySchema,
  isMemoCollectionSet,
  parseFixtureArray,
  resolveTimestamp,
  runEval,
  validateNoDanglingExpectedIds,
} from '../../../scripts/eval-relevance';
import { MemoError } from '../../../src/lib/errors';
import type { QdrantRepository, ScrollResult, SearchResult } from '../../../src/lib/qdrant';
import type { EmbeddingsAdapter } from '../../../src/lib/embeddings';

const VALID_ENTRY = {
  id: '11111111-1111-4111-8111-111111111111',
  repo: 'memo-cli',
  org: 'llipe',
  domain: 'cli',
  rationale: 'A valid rationale describing a decision.',
  tags: ['tag-one', 'tag-two'],
  entry_type: 'decision',
  source: 'agent',
  age_days: 10,
} as const;

const VALID_QUERY = {
  id: 'q-1',
  query: 'what does this do',
  expected_ids: ['11111111-1111-4111-8111-111111111111'],
  category: 'concept',
} as const;

describe('EvalEntrySeedSchema', () => {
  it('accepts a valid fixture entry', () => {
    expect(EvalEntrySeedSchema.safeParse(VALID_ENTRY).success).toBe(true);
  });

  it('accepts source "scan" (fixture-only source domain, per story business rule)', () => {
    const result = EvalEntrySeedSchema.safeParse({ ...VALID_ENTRY, source: 'scan' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing required field', () => {
    const { rationale, ...withoutRationale } = VALID_ENTRY;
    void rationale;
    expect(EvalEntrySeedSchema.safeParse(withoutRationale).success).toBe(false);
  });

  it('rejects an unknown source value', () => {
    expect(EvalEntrySeedSchema.safeParse({ ...VALID_ENTRY, source: 'bot' }).success).toBe(false);
  });

  it('rejects age_days as a string (fuzz-style type mismatch, RT-2)', () => {
    expect(EvalEntrySeedSchema.safeParse({ ...VALID_ENTRY, age_days: '10' }).success).toBe(false);
  });

  it('accepts optional files_modified and relates_to when present', () => {
    const result = EvalEntrySeedSchema.safeParse({
      ...VALID_ENTRY,
      files_modified: ['src/index.ts'],
      relates_to: ['other-repo'],
    });
    expect(result.success).toBe(true);
  });
});

describe('EvalQuerySchema', () => {
  it('accepts a valid query', () => {
    expect(EvalQuerySchema.safeParse(VALID_QUERY).success).toBe(true);
  });

  it('rejects a query missing expected_ids entirely (CT-3)', () => {
    const { expected_ids, ...withoutExpectedIds } = VALID_QUERY;
    void expected_ids;
    expect(EvalQuerySchema.safeParse(withoutExpectedIds).success).toBe(false);
  });

  it('accepts an empty expected_ids array (EC-3, distinct from a missing field)', () => {
    const result = EvalQuerySchema.safeParse({ ...VALID_QUERY, expected_ids: [] });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown category value', () => {
    expect(EvalQuerySchema.safeParse({ ...VALID_QUERY, category: 'unknown' }).success).toBe(false);
  });
});

describe('parseFixtureArray', () => {
  it('parses every valid item in the array', () => {
    const parsed = parseFixtureArray(
      [VALID_ENTRY, VALID_ENTRY],
      EvalEntrySeedSchema,
      'entries.json',
    );
    expect(parsed).toHaveLength(2);
  });

  it('throws MemoError identifying the offending index when a record is malformed', () => {
    let error: unknown;
    try {
      parseFixtureArray(
        [VALID_ENTRY, { ...VALID_ENTRY, source: 'bot' }],
        EvalEntrySeedSchema,
        'entries.json',
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MemoError);
    expect((error as MemoError).message).toContain('[1]');
  });

  it('throws MemoError when input is not an array', () => {
    expect(() => parseFixtureArray({}, EvalEntrySeedSchema, 'entries.json')).toThrow(MemoError);
  });
});

describe('validateNoDanglingExpectedIds', () => {
  const entry = EvalEntrySeedSchema.parse(VALID_ENTRY);
  const query = EvalQuerySchema.parse(VALID_QUERY);

  it('passes when every expected id resolves to a known entry', () => {
    expect(() => validateNoDanglingExpectedIds([entry], [query])).not.toThrow();
  });

  it('fails loudly (does not silently pass) when an expected id has no matching entry', () => {
    const danglingQuery = { ...query, expected_ids: ['does-not-exist'] };
    expect(() => validateNoDanglingExpectedIds([entry], [danglingQuery])).toThrow(MemoError);
  });

  it('does not flag a query with an empty expected_ids array as dangling', () => {
    const emptyQuery = { ...query, expected_ids: [] };
    expect(() => validateNoDanglingExpectedIds([entry], [emptyQuery])).not.toThrow();
  });
});

describe('resolveTimestamp', () => {
  it('resolves age_days relative to the provided now (EC-1)', () => {
    const now = new Date('2026-01-11T00:00:00.000Z');
    expect(resolveTimestamp(10, now)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('resolves age_days of 0 to now', () => {
    const now = new Date('2026-01-11T00:00:00.000Z');
    expect(resolveTimestamp(0, now)).toBe(now.toISOString());
  });

  it('resolves a negative age_days to a future timestamp rather than clamping to 0 (EC-1)', () => {
    const now = new Date('2026-01-11T00:00:00.000Z');
    const resolved = resolveTimestamp(-5, now);
    expect(Date.parse(resolved)).toBeGreaterThan(now.getTime());
  });

  it('resolves large age_days (10 years) without overflow', () => {
    const now = new Date('2026-01-11T00:00:00.000Z');
    const resolved = resolveTimestamp(3650, now);
    expect(Number.isNaN(Date.parse(resolved))).toBe(false);
  });
});

describe('isMemoCollectionSet', () => {
  it('is false when unset', () => {
    expect(isMemoCollectionSet({})).toBe(false);
  });

  it('is false for an empty or whitespace-only value', () => {
    expect(isMemoCollectionSet({ MEMO_COLLECTION: '' })).toBe(false);
    expect(isMemoCollectionSet({ MEMO_COLLECTION: '   ' })).toBe(false);
  });

  it('is true for a non-empty value', () => {
    expect(isMemoCollectionSet({ MEMO_COLLECTION: 'memo_eval' })).toBe(true);
  });
});

function makeFakeEmbeddings(): EmbeddingsAdapter {
  return {
    dimensions: 3,
    embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  };
}

interface FakeRepoOptions {
  searchResult?: SearchResult[];
  failEnsureCollection?: boolean;
  failUpsert?: boolean;
}

function makeFakeRepo(opts: FakeRepoOptions = {}): {
  repo: QdrantRepository;
  upsertCalls: { id: string; payload: Record<string, unknown> }[];
  ensureCollectionCalls: number;
} {
  const upsertCalls: { id: string; payload: Record<string, unknown> }[] = [];
  let ensureCollectionCalls = 0;

  const repo = {
    collectionName: 'memo_eval',
    ensureCollection: jest.fn(async () => {
      ensureCollectionCalls += 1;
      if (opts.failEnsureCollection) {
        throw new MemoError('COLLECTION_BOOTSTRAP_FAILED', 'connection refused');
      }
    }),
    upsert: jest.fn(async (id: string, _vector: number[], payload: Record<string, unknown>) => {
      if (opts.failUpsert) {
        throw new MemoError('QDRANT_OPERATION_FAILED', 'connection refused');
      }
      upsertCalls.push({ id, payload });
    }),
    search: jest.fn(async (): Promise<SearchResult[]> => opts.searchResult ?? []),
    scroll: jest.fn(async (): Promise<ScrollResult[]> => []),
  };

  return { repo: repo as unknown as QdrantRepository, upsertCalls, ensureCollectionCalls };
}

const ENTRY_A = EvalEntrySeedSchema.parse({
  ...VALID_ENTRY,
  id: '11111111-1111-4111-8111-111111111111',
});
const QUERY_A = EvalQuerySchema.parse(VALID_QUERY);

describe('runEval', () => {
  it('throws MemoError (exitCode 1) and performs no upsert when --seed runs with MEMO_COLLECTION unset', async () => {
    const { repo, upsertCalls } = makeFakeRepo();
    const embeddings = makeFakeEmbeddings();

    await expect(
      runEval(['--seed'], {
        env: {},
        loadFixturesFn: async () => ({ entries: [ENTRY_A], queries: [QUERY_A] }),
        createRepo: () => repo,
        createEmbeddings: () => embeddings,
      }),
    ).rejects.toMatchObject({ exitCode: 1 });

    expect(upsertCalls).toHaveLength(0);
  });

  it('seeds every fixture entry and returns seed-only when --seed runs alone with MEMO_COLLECTION set', async () => {
    const { repo, upsertCalls } = makeFakeRepo();
    const embeddings = makeFakeEmbeddings();

    const summary = await runEval(['--seed'], {
      env: { MEMO_COLLECTION: 'memo_eval' },
      loadFixturesFn: async () => ({ entries: [ENTRY_A], queries: [QUERY_A] }),
      createRepo: () => repo,
      createEmbeddings: () => embeddings,
    });

    expect(summary).toEqual({ mode: 'seed-only', seededCount: 1 });
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]?.id).toBe(ENTRY_A.id);
    expect(upsertCalls[0]?.payload['timestamp_utc']).toBeDefined();
  });

  it('runs every query and reports the hit rate in default run mode without writing files', async () => {
    const { repo } = makeFakeRepo({ searchResult: [{ id: ENTRY_A.id, score: 0.9, payload: {} }] });
    const embeddings = makeFakeEmbeddings();
    const writeFileFn = jest.fn();

    const summary = await runEval([], {
      env: {},
      loadFixturesFn: async () => ({ entries: [ENTRY_A], queries: [QUERY_A] }),
      createRepo: () => repo,
      createEmbeddings: () => embeddings,
      writeFileFn,
    });

    expect(summary.mode).toBe('run');
    expect(summary.report?.overall_top3).toBe(1);
    expect(writeFileFn).not.toHaveBeenCalled();
  });

  it('writes candidates.json and baseline.json in --record mode', async () => {
    const { repo } = makeFakeRepo({ searchResult: [{ id: ENTRY_A.id, score: 0.9, payload: {} }] });
    const embeddings = makeFakeEmbeddings();
    const writeFileFn = jest.fn().mockResolvedValue(undefined);

    const summary = await runEval(['--record'], {
      env: {},
      loadFixturesFn: async () => ({ entries: [ENTRY_A], queries: [QUERY_A] }),
      createRepo: () => repo,
      createEmbeddings: () => embeddings,
      writeFileFn,
    });

    expect(summary.mode).toBe('record');
    expect(writeFileFn).toHaveBeenCalledTimes(2);
    const [candidatesCall, baselineCall] = writeFileFn.mock.calls as [string, string, string][][];
    expect(String(candidatesCall?.[0])).toContain('candidates.json');
    expect(String(baselineCall?.[0])).toContain('baseline.json');
  });

  it('seeds then records in one invocation when --seed and --record are combined', async () => {
    const { repo, upsertCalls } = makeFakeRepo({
      searchResult: [{ id: ENTRY_A.id, score: 0.9, payload: {} }],
    });
    const embeddings = makeFakeEmbeddings();
    const writeFileFn = jest.fn().mockResolvedValue(undefined);

    const summary = await runEval(['--seed', '--record'], {
      env: { MEMO_COLLECTION: 'memo_eval' },
      loadFixturesFn: async () => ({ entries: [ENTRY_A], queries: [QUERY_A] }),
      createRepo: () => repo,
      createEmbeddings: () => embeddings,
      writeFileFn,
    });

    expect(upsertCalls).toHaveLength(1);
    expect(summary.mode).toBe('record');
  });

  it('surfaces a Qdrant connectivity failure during ensureCollection as exit-2 QDRANT_UNREACHABLE', async () => {
    const { repo } = makeFakeRepo({ failEnsureCollection: true });
    const embeddings = makeFakeEmbeddings();

    let error: unknown;
    try {
      await runEval([], {
        env: {},
        loadFixturesFn: async () => ({ entries: [ENTRY_A], queries: [QUERY_A] }),
        createRepo: () => repo,
        createEmbeddings: () => embeddings,
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(MemoError);
    expect((error as MemoError).code).toBe('QDRANT_UNREACHABLE');
    expect((error as MemoError).exitCode).toBe(2);
  });

  it('surfaces a Qdrant connectivity failure during --seed upsert as exit-2 QDRANT_UNREACHABLE', async () => {
    const { repo } = makeFakeRepo({ failUpsert: true });
    const embeddings = makeFakeEmbeddings();

    let error: unknown;
    try {
      await runEval(['--seed'], {
        env: { MEMO_COLLECTION: 'memo_eval' },
        loadFixturesFn: async () => ({ entries: [ENTRY_A], queries: [QUERY_A] }),
        createRepo: () => repo,
        createEmbeddings: () => embeddings,
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(MemoError);
    expect((error as MemoError).code).toBe('QDRANT_UNREACHABLE');
    expect((error as MemoError).exitCode).toBe(2);
  });
});
