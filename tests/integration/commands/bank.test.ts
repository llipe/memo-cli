import { handleBankInit, handleBankList, handleBankShow } from '../../../src/commands/bank.js';
import type { BankInitDeps, BankListDeps, BankShowDeps } from '../../../src/commands/bank.js';
import {
  DEFAULT_KB_EPISODIC_POLICY,
  DEFAULT_KB_SEMANTIC_POLICY,
} from '../../../src/types/config.js';

// A minimal in-memory fake standing in for QdrantRepository, shared across
// init -> list -> show so a point written by `init` is visible to the
// subsequent `list`/`show` calls, mirroring real Qdrant round-trip behavior.
interface FakePoint {
  id: string;
  payload: Record<string, unknown>;
}

function createFakeRepo(seed: FakePoint[] = []) {
  const points: FakePoint[] = [...seed];

  function matchesClause(
    payload: Record<string, unknown>,
    clause: Record<string, unknown>,
  ): boolean {
    if ('key' in clause && 'match' in clause) {
      const key = clause['key'] as string;
      const match = clause['match'] as { value: unknown };
      return payload[key] === match.value;
    }
    if ('key' in clause && 'is_empty' in clause) {
      return false; // handled by the is_empty branch below
    }
    if ('is_empty' in clause) {
      const key = (clause['is_empty'] as { key: string }).key;
      return payload[key] === undefined || payload[key] === null;
    }
    if ('should' in clause) {
      const should = clause['should'] as Record<string, unknown>[];
      return should.some((c) => matchesClause(payload, c));
    }
    return false;
  }

  function matchesFilter(
    payload: Record<string, unknown>,
    filter?: Record<string, unknown>,
  ): boolean {
    if (!filter) return true;
    const must = (filter['must'] as Record<string, unknown>[] | undefined) ?? [];
    const mustNot = (filter['must_not'] as Record<string, unknown>[] | undefined) ?? [];
    for (const clause of must) {
      if (!matchesClause(payload, clause)) return false;
    }
    for (const clause of mustNot) {
      if (matchesClause(payload, clause)) return false;
    }
    return true;
  }

  return {
    ensureCollection: jest.fn().mockResolvedValue(undefined),
    upsert: jest.fn(async (id: string, _vector: number[], payload: Record<string, unknown>) => {
      points.push({ id, payload });
    }),
    count: jest.fn(async (filter?: Record<string, unknown>) => {
      return points.filter((p) => matchesFilter(p.payload, filter)).length;
    }),
    scroll: jest.fn(async (filter?: Record<string, unknown>) => {
      return points
        .filter((p) => matchesFilter(p.payload, filter))
        .sort((a, b) => {
          const at = (a.payload['timestamp_utc'] as string | undefined) ?? '';
          const bt = (b.payload['timestamp_utc'] as string | undefined) ?? '';
          return bt.localeCompare(at);
        });
    }),
    scrollOrdered: jest.fn().mockResolvedValue([]),
    getById: jest.fn().mockResolvedValue(null),
    getByDedupeKey: jest.fn().mockResolvedValue(null),
    setPayload: jest.fn().mockResolvedValue(undefined),
    _points: points,
  };
}

type FakeRepo = ReturnType<typeof createFakeRepo>;

const mockEmbeddings = () => ({
  embed: jest.fn().mockResolvedValue(new Array<number>(1536).fill(0.1)),
  dimensions: 1536,
});

const mockConfig = {
  schema_version: '2' as const,
  bank: { default: 'kb' },
  banks: {
    kb: { episodic: DEFAULT_KB_EPISODIC_POLICY, semantic: DEFAULT_KB_SEMANTIC_POLICY },
    private: {
      self: { soft_cap: 50 },
      episodic: { expires_in_days: 90 },
      semantic: {},
    },
  },
  recall: { max_tokens: 2000 },
  repo: 'test-repo',
  org: 'test-org',
  domain: 'backend',
  relates_to: [],
  defaults: { source: 'agent' as const, search_scope: 'repo' as const },
};

let stdoutData = '';

beforeEach(() => {
  stdoutData = '';
  jest.spyOn(process.stdout, 'write').mockImplementation((data: unknown) => {
    stdoutData += String(data);
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function jsonResult(): Record<string, unknown> {
  return JSON.parse(stdoutData) as Record<string, unknown>;
}

describe('bank integration: init -> list -> show', () => {
  it('creates a bank via init, then list and show reflect it, alongside a v1 legacy point', async () => {
    // Seed with a v1 legacy point (no `bank` field) that must fold into `kb`.
    const repo: FakeRepo = createFakeRepo([
      {
        id: 'legacy-v1',
        payload: {
          kind: 'semantic',
          rationale: 'pre-Phase-2 point',
          timestamp_utc: '2026-01-01T00:00:00.000Z',
        },
      },
    ]);

    const initDeps: BankInitDeps = {
      createRepo: () => repo as unknown as ReturnType<NonNullable<BankInitDeps['createRepo']>>,
      createEmbeddings: () =>
        mockEmbeddings() as unknown as ReturnType<NonNullable<BankInitDeps['createEmbeddings']>>,
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      writeConfig: jest.fn().mockResolvedValue(undefined),
    };

    await handleBankInit({ id: 'my-bank', json: true }, initDeps);
    const initResult = jsonResult();
    expect(initResult['created']).toBe(true);
    expect(typeof initResult['self_id']).toBe('string');

    stdoutData = '';
    const listDeps: BankListDeps = {
      createRepo: () => repo as unknown as ReturnType<NonNullable<BankListDeps['createRepo']>>,
    };
    await handleBankList({ json: true }, listDeps);
    const listResult = jsonResult();
    const banks = listResult['banks'] as Array<{ bank: string; counts: Record<string, number> }>;

    const myBank = banks.find((b) => b.bank === 'my-bank');
    expect(myBank?.counts['self']).toBe(1);

    const kb = banks.find((b) => b.bank === 'kb');
    expect(kb).toBeDefined();
    expect(kb?.counts['semantic']).toBe(1); // the seeded v1 legacy point

    stdoutData = '';
    const showDeps: BankShowDeps = {
      createRepo: () => repo as unknown as ReturnType<NonNullable<BankShowDeps['createRepo']>>,
    };
    await handleBankShow({ id: 'my-bank', json: true }, showDeps);
    const showResult = jsonResult();
    const entries = showResult['entries'] as Array<{ id: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(initResult['self_id']);
  });

  it('a second init on the same bank is idempotent (no additional writes)', async () => {
    const repo: FakeRepo = createFakeRepo();
    const initDeps: BankInitDeps = {
      createRepo: () => repo as unknown as ReturnType<NonNullable<BankInitDeps['createRepo']>>,
      createEmbeddings: () =>
        mockEmbeddings() as unknown as ReturnType<NonNullable<BankInitDeps['createEmbeddings']>>,
      loadCfg: jest.fn().mockResolvedValue(mockConfig),
      writeConfig: jest.fn().mockResolvedValue(undefined),
    };

    await handleBankInit({ id: 'my-bank', json: true }, initDeps);
    const firstResult = jsonResult();

    stdoutData = '';
    await handleBankInit({ id: 'my-bank', json: true }, initDeps);
    const secondResult = jsonResult();

    expect(secondResult['created']).toBe(false);
    expect(secondResult['self_id']).toBe(firstResult['self_id']);
    expect(repo.upsert).toHaveBeenCalledTimes(1);
  });
});
