import { randomUUID } from 'node:crypto';
import { handleBankInit, handleBankList, handleBankShow } from '../../../src/commands/bank.js';
import type { BankInitDeps, BankListDeps, BankShowDeps } from '../../../src/commands/bank.js';
import { MemoError } from '../../../src/lib/errors.js';
import {
  DEFAULT_KB_EPISODIC_POLICY,
  DEFAULT_KB_SEMANTIC_POLICY,
} from '../../../src/types/config.js';

// ---------------------------------------------------------------------------
// Shared test fixtures / mocks
// ---------------------------------------------------------------------------

interface MockQdrant {
  ensureCollection: jest.Mock;
  upsert: jest.Mock;
  count: jest.Mock;
  scroll: jest.Mock;
  scrollOrdered: jest.Mock;
  getById: jest.Mock;
  getByDedupeKey: jest.Mock;
  setPayload: jest.Mock;
}

function createMockQdrant(): MockQdrant {
  return {
    ensureCollection: jest.fn().mockResolvedValue(undefined),
    upsert: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
    scroll: jest.fn().mockResolvedValue([]),
    scrollOrdered: jest.fn().mockResolvedValue([]),
    getById: jest.fn().mockResolvedValue(null),
    getByDedupeKey: jest.fn().mockResolvedValue(null),
    setPayload: jest.fn().mockResolvedValue(undefined),
  };
}

const mockEmbeddings = () => ({
  embed: jest.fn().mockResolvedValue(new Array<number>(1536).fill(0.1)),
  dimensions: 1536,
});

function fullConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: '2',
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
    repo: 'my-repo',
    org: 'my-org',
    domain: 'backend',
    relates_to: [],
    defaults: { source: 'agent', search_scope: 'repo' },
    ...overrides,
  };
}

let stdoutData = '';
let stderrData = '';
let mockQdrant: MockQdrant;

beforeEach(() => {
  stdoutData = '';
  stderrData = '';
  mockQdrant = createMockQdrant();
  jest.spyOn(process.stdout, 'write').mockImplementation((data: unknown) => {
    stdoutData += String(data);
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
    stderrData += String(data);
    return true;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function jsonResult(): Record<string, unknown> {
  return JSON.parse(stdoutData) as Record<string, unknown>;
}

function initDeps(overrides: Partial<BankInitDeps> = {}): BankInitDeps {
  return {
    createRepo: () => mockQdrant as unknown as ReturnType<NonNullable<BankInitDeps['createRepo']>>,
    createEmbeddings: () =>
      mockEmbeddings() as unknown as ReturnType<NonNullable<BankInitDeps['createEmbeddings']>>,
    loadCfg: jest.fn().mockResolvedValue(fullConfig()),
    writeConfig: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// bank init
// ---------------------------------------------------------------------------

describe('handleBankInit', () => {
  describe('AC1 — id validation', () => {
    it('rejects the reserved word "kb" with a reserved-word message, no write', async () => {
      const deps = initDeps();
      await expect(handleBankInit({ id: 'kb' }, deps)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await expect(handleBankInit({ id: 'kb' }, deps)).rejects.toMatchObject({
        message: expect.stringContaining('reserved'),
      });
      expect(mockQdrant.upsert).not.toHaveBeenCalled();
    });

    it('rejects "KB" for the kebab-case reason, not the reserved-word reason', async () => {
      const deps = initDeps();
      let caught: MemoError | undefined;
      try {
        await handleBankInit({ id: 'KB' }, deps);
      } catch (err) {
        caught = err as MemoError;
      }
      expect(caught?.code).toBe('VALIDATION_FAILED');
      expect(caught?.message).not.toContain('reserved');
      expect(mockQdrant.upsert).not.toHaveBeenCalled();
    });

    it('rejects a malformed id', async () => {
      await expect(handleBankInit({ id: 'Not_Valid!' }, initDeps())).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(mockQdrant.upsert).not.toHaveBeenCalled();
    });

    it('rejects an id with leading/trailing whitespace', async () => {
      await expect(handleBankInit({ id: ' my-bank' }, initDeps())).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await expect(handleBankInit({ id: 'my-bank ' }, initDeps())).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('accepts a UUID-form id', async () => {
      const id = randomUUID();
      await handleBankInit({ id, json: true }, initDeps());
      expect(mockQdrant.upsert).toHaveBeenCalledTimes(1);
    });

    it('accepts a fixed adversarial near-miss set of the reserved word (RT-04)', async () => {
      const nearMisses = ['KB', 'Kb', 'kb ', ' kb', 'kb-', 'kb1'];
      for (const candidate of nearMisses) {
        mockQdrant = createMockQdrant();
        const deps = initDeps();
        let caught: MemoError | undefined;
        try {
          await handleBankInit({ id: candidate, json: true }, deps);
        } catch (err) {
          caught = err as MemoError;
        }
        if (candidate === 'kb1') {
          // valid kebab, not the reserved word — accepted.
          expect(caught).toBeUndefined();
        } else {
          expect(caught?.code).toBe('VALIDATION_FAILED');
        }
      }
    });

    it('accepts a randomized corpus of valid kebab ids (RT-01, fixed seed)', async () => {
      // mulberry32 PRNG, fixed seed for deterministic replay.
      let seed = 424242;
      const rand = (): number => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
      const segments = 10;
      for (let i = 0; i < segments; i++) {
        const len = 3 + Math.floor(rand() * 6);
        let id = alphabet[Math.floor(rand() * 26)] ?? 'a'; // first char must be a letter
        for (let j = 1; j < len; j++) {
          id += alphabet[Math.floor(rand() * alphabet.length)] ?? 'a';
        }
        mockQdrant = createMockQdrant();
        const deps = initDeps();
        await expect(handleBankInit({ id, json: true }, deps)).resolves.toBeUndefined();
      }
    });

    it('accepts a randomized corpus of valid UUIDs (RT-02)', async () => {
      for (let i = 0; i < 5; i++) {
        mockQdrant = createMockQdrant();
        const deps = initDeps();
        await expect(
          handleBankInit({ id: randomUUID(), json: true }, deps),
        ).resolves.toBeUndefined();
      }
    });

    it('rejects a randomized corpus of invalid strings (RT-03)', async () => {
      const invalids = [
        'Invalid-Upper',
        'has_underscore',
        '-leading-hyphen',
        'trailing-hyphen-',
        'double--hyphen',
        'has space',
        '',
        '😀emoji',
      ];
      for (const candidate of invalids) {
        mockQdrant = createMockQdrant();
        const deps = initDeps();
        await expect(handleBankInit({ id: candidate, json: true }, deps)).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
        });
        expect(mockQdrant.upsert).not.toHaveBeenCalled();
      }
    });
  });

  describe('AC1 — fresh init writes one self entry', () => {
    it('writes via the S2-04 write path with default rationale/tags', async () => {
      await handleBankInit({ id: 'my-bank', json: true }, initDeps());

      expect(mockQdrant.upsert).toHaveBeenCalledTimes(1);
      const [, , payload] = mockQdrant.upsert.mock.calls[0] as [
        string,
        number[],
        Record<string, unknown>,
      ];
      expect(payload['bank']).toBe('my-bank');
      expect(payload['kind']).toBe('self');
      expect(payload['source']).toBe('manual');
      expect(payload['entry_type']).toBe('structure');
      expect(payload['rationale']).toBe('Bank my-bank initialised.');
      expect(payload['tags']).toEqual(['bank', 'self']);
    });

    it('honors --rationale/--tags overrides', async () => {
      await handleBankInit(
        { id: 'my-bank', rationale: 'custom', tags: 'team,seed', json: true },
        initDeps(),
      );

      const [, , payload] = mockQdrant.upsert.mock.calls[0] as [
        string,
        number[],
        Record<string, unknown>,
      ];
      expect(payload['rationale']).toBe('custom');
      expect(payload['tags']).toEqual(['team', 'seed']);
    });

    it('JSON envelope: { bank, created: true, self_id, default_set: false }', async () => {
      await handleBankInit({ id: 'my-bank', json: true }, initDeps());

      const result = jsonResult();
      expect(result['bank']).toBe('my-bank');
      expect(result['created']).toBe(true);
      expect(result['default_set']).toBe(false);
      expect(typeof result['self_id']).toBe('string');
      expect(result['self_id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('produces no stray human text on stdout in --json mode', async () => {
      await handleBankInit({ id: 'my-bank', json: true }, initDeps());

      expect(() => JSON.parse(stdoutData)).not.toThrow();
    });

    it('--tags with only 1 tag is rejected by the 2–5 schema rule (EC-05)', async () => {
      await expect(
        handleBankInit({ id: 'my-bank', tags: 'solo', json: true }, initDeps()),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('--tags with 6 tags is rejected by the 2–5 schema rule (EC-06)', async () => {
      await expect(
        handleBankInit({ id: 'my-bank', tags: 'a,b,c,d,e,f', json: true }, initDeps()),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('AC2 — idempotent second init', () => {
    it('writes nothing and returns created: false when the bank already exists', async () => {
      mockQdrant.count.mockResolvedValue(1);
      mockQdrant.scroll.mockResolvedValue([
        { id: 'existing-self-id', payload: { kind: 'self', bank: 'my-bank' } },
      ]);

      await handleBankInit({ id: 'my-bank', json: true }, initDeps());

      expect(mockQdrant.upsert).not.toHaveBeenCalled();
      const result = jsonResult();
      expect(result['created']).toBe(false);
      expect(result['self_id']).toBe('existing-self-id');
    });

    it('prints an existing-summary notice in human mode with zero additional writes', async () => {
      mockQdrant.count.mockResolvedValue(1);
      mockQdrant.scroll.mockResolvedValue([
        { id: 'existing-self-id', payload: { kind: 'self', bank: 'my-bank' } },
      ]);

      await handleBankInit({ id: 'my-bank' }, initDeps());

      expect(mockQdrant.upsert).not.toHaveBeenCalled();
      expect(stdoutData.length).toBeGreaterThan(0);
    });
  });

  describe('AC3 — --set-default gates writeConfig', () => {
    it('calls writeConfig exactly once with bank.default = <id> when --set-default is passed', async () => {
      const writeConfig = jest.fn().mockResolvedValue(undefined);
      await handleBankInit(
        { id: 'my-bank', setDefault: true, json: true },
        initDeps({ writeConfig }),
      );

      expect(writeConfig).toHaveBeenCalledTimes(1);
      const [cfgArg] = writeConfig.mock.calls[0] as [{ bank: { default: string } }];
      expect(cfgArg.bank.default).toBe('my-bank');

      const result = jsonResult();
      expect(result['default_set']).toBe(true);
    });

    it('never calls writeConfig when --set-default is absent (call count === 0)', async () => {
      const writeConfig = jest.fn().mockResolvedValue(undefined);
      await handleBankInit({ id: 'my-bank', json: true }, initDeps({ writeConfig }));

      expect(writeConfig).toHaveBeenCalledTimes(0);
      const result = jsonResult();
      expect(result['default_set']).toBe(false);
    });

    it('re-invokes writeConfig unconditionally on a second --set-default call (§18.14 item 11)', async () => {
      mockQdrant.count.mockResolvedValue(1);
      mockQdrant.scroll.mockResolvedValue([
        { id: 'existing-self-id', payload: { kind: 'self', bank: 'my-bank' } },
      ]);
      const writeConfig = jest.fn().mockResolvedValue(undefined);

      await handleBankInit(
        { id: 'my-bank', setDefault: true, json: true },
        initDeps({ writeConfig }),
      );

      expect(writeConfig).toHaveBeenCalledTimes(1);
      const result = jsonResult();
      expect(result['created']).toBe(false);
      expect(result['default_set']).toBe(true);
    });

    it('raises CONFIG_NOT_FOUND before any Qdrant write when --set-default has no config', async () => {
      const loadCfg = jest.fn().mockRejectedValue(new MemoError('CONFIG_NOT_FOUND', 'not found'));
      await expect(
        handleBankInit({ id: 'my-bank', setDefault: true, json: true }, initDeps({ loadCfg })),
      ).rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' });

      expect(mockQdrant.upsert).not.toHaveBeenCalled();
      expect(mockQdrant.count).not.toHaveBeenCalled();
    });

    it('raises CONFIG_INVALID before any Qdrant write when --set-default has an invalid config', async () => {
      const loadCfg = jest.fn().mockRejectedValue(new MemoError('CONFIG_INVALID', 'bad config'));
      await expect(
        handleBankInit({ id: 'my-bank', setDefault: true, json: true }, initDeps({ loadCfg })),
      ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });

      expect(mockQdrant.upsert).not.toHaveBeenCalled();
    });

    it('does not require config at all when --set-default is absent, even with no memo.config.json', async () => {
      const loadCfg = jest.fn().mockRejectedValue(new MemoError('CONFIG_NOT_FOUND', 'not found'));
      await handleBankInit({ id: 'my-bank', json: true }, initDeps({ loadCfg }));

      expect(mockQdrant.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('BR2 — no ownership check', () => {
    it('allows init for any bank id with no permission error', async () => {
      await expect(
        handleBankInit({ id: 'anyone-elses-bank', json: true }, initDeps()),
      ).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// bank list
// ---------------------------------------------------------------------------

function listDeps(overrides: Partial<BankListDeps> = {}): BankListDeps {
  return {
    createRepo: () => mockQdrant as unknown as ReturnType<NonNullable<BankListDeps['createRepo']>>,
    ...overrides,
  };
}

describe('handleBankList', () => {
  it('AC4 — returns { banks: [] } on an empty collection', async () => {
    mockQdrant.scroll.mockResolvedValue([]);
    mockQdrant.count.mockResolvedValue(0);

    await handleBankList({ json: true }, listDeps());

    const result = jsonResult();
    expect(result['banks']).toEqual([]);
  });

  it('AC4 — lists multiple banks with per-kind counts and folds v1/absent-bank points into kb', async () => {
    mockQdrant.scroll.mockImplementation((filter: unknown) => {
      // Simulate aggregateField's raw scroll (filter undefined) discovering explicit bank names.
      if (filter === undefined) {
        return Promise.resolve([
          { id: '1', payload: { bank: 'alpha' } },
          { id: '2', payload: { bank: 'beta' } },
          { id: '3', payload: {} }, // v1 legacy, no bank field
        ]);
      }
      return Promise.resolve([]);
    });
    mockQdrant.count.mockImplementation((filter: { must?: Array<Record<string, unknown>> }) => {
      const must = filter.must ?? [];
      const findMatch = (key: string): string | undefined => {
        for (const clause of must) {
          if (
            clause['key'] === key &&
            typeof clause['match'] === 'object' &&
            clause['match'] !== null
          ) {
            return (clause['match'] as { value?: string }).value;
          }
        }
        return undefined;
      };
      // is_empty(bank) count for the v1-legacy-only case.
      const hasIsEmptyBank = must.some(
        (c) =>
          typeof c['is_empty'] === 'object' && (c['is_empty'] as { key?: string }).key === 'bank',
      );
      if (hasIsEmptyBank) return Promise.resolve(1);

      const bank = findMatch('bank');
      const kind = findMatch('kind');
      if (bank === 'alpha' && kind === 'self') return Promise.resolve(2);
      if (bank === 'alpha' && kind === 'episodic') return Promise.resolve(1);
      if (bank === 'alpha' && kind === 'semantic') return Promise.resolve(0);
      if (bank === 'beta' && kind === 'self') return Promise.resolve(0);
      if (bank === 'beta' && kind === 'episodic') return Promise.resolve(3);
      if (bank === 'beta' && kind === 'semantic') return Promise.resolve(0);
      if (bank === 'kb' && kind === 'semantic') return Promise.resolve(1);
      return Promise.resolve(0);
    });

    await handleBankList({ json: true }, listDeps());

    const result = jsonResult();
    const banks = result['banks'] as Array<{
      bank: string;
      counts: { self: number; episodic: number; semantic: number };
      total: number;
    }>;

    const alpha = banks.find((b) => b.bank === 'alpha');
    expect(alpha?.counts).toEqual({ self: 2, episodic: 1, semantic: 0 });
    expect(alpha?.total).toBe(3);

    const beta = banks.find((b) => b.bank === 'beta');
    expect(beta?.counts).toEqual({ self: 0, episodic: 3, semantic: 0 });
    expect(beta?.total).toBe(3);

    const kb = banks.find((b) => b.bank === 'kb');
    expect(kb).toBeDefined();
    expect(kb?.total).toBe(kb ? kb.counts.self + kb.counts.episodic + kb.counts.semantic : -1);

    // No duplicate kb rows (EC-11).
    expect(banks.filter((b) => b.bank === 'kb')).toHaveLength(1);
  });

  it('EC-12 — a single-kind bank still reports all three kind keys with 0', async () => {
    mockQdrant.scroll.mockImplementation((filter: unknown) => {
      if (filter === undefined) {
        return Promise.resolve([{ id: '1', payload: { bank: 'self-only' } }]);
      }
      return Promise.resolve([]);
    });
    mockQdrant.count.mockImplementation((filter: { must?: Array<Record<string, unknown>> }) => {
      const must = filter.must ?? [];
      const kindClause = must.find((c) => c['key'] === 'kind');
      const kind =
        kindClause && typeof kindClause['match'] === 'object'
          ? (kindClause['match'] as { value?: string }).value
          : undefined;
      return Promise.resolve(kind === 'self' ? 5 : 0);
    });

    await handleBankList({ json: true }, listDeps());

    const result = jsonResult();
    const banks = result['banks'] as Array<{
      counts: { self: number; episodic: number; semantic: number };
    }>;
    expect(banks[0]?.counts).toEqual({ self: 5, episodic: 0, semantic: 0 });
  });

  it('AC4 — human output lists bank ids with self/episodic/semantic/total', async () => {
    mockQdrant.scroll.mockImplementation((filter: unknown) => {
      if (filter === undefined) {
        return Promise.resolve([{ id: '1', payload: { bank: 'my-bank' } }]);
      }
      return Promise.resolve([]);
    });
    mockQdrant.count.mockResolvedValue(1);

    await handleBankList({}, listDeps());

    expect(stdoutData).toContain('my-bank');
    expect(stdoutData.toLowerCase()).toContain('self');
    expect(stdoutData.toLowerCase()).toContain('episodic');
    expect(stdoutData.toLowerCase()).toContain('semantic');
  });

  it('AC4 — human output shows an empty-state notice for an empty collection', async () => {
    mockQdrant.scroll.mockResolvedValue([]);
    mockQdrant.count.mockResolvedValue(0);

    await handleBankList({}, listDeps());

    expect(stdoutData.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// bank show
// ---------------------------------------------------------------------------

function showDeps(overrides: Partial<BankShowDeps> = {}): BankShowDeps {
  return {
    createRepo: () => mockQdrant as unknown as ReturnType<NonNullable<BankShowDeps['createRepo']>>,
    ...overrides,
  };
}

const now = '2026-09-22T00:00:00.000Z';
const earlier = '2026-09-20T00:00:00.000Z';
const earliest = '2026-09-18T00:00:00.000Z';

describe('handleBankShow', () => {
  it('AC5 — prints non-superseded self entries newest-first', async () => {
    mockQdrant.scroll.mockResolvedValue([
      {
        id: 'newest',
        payload: {
          kind: 'self',
          bank: 'my-bank',
          rationale: 'newest rationale',
          timestamp_utc: now,
          superseded: false,
        },
      },
      {
        id: 'oldest',
        payload: {
          kind: 'self',
          bank: 'my-bank',
          rationale: 'oldest rationale',
          timestamp_utc: earlier,
          superseded: false,
        },
      },
    ]);

    await handleBankShow({ id: 'my-bank', json: true }, showDeps());

    const result = jsonResult();
    const entries = result['entries'] as Array<{ id: string }>;
    expect(entries.map((e) => e.id)).toEqual(['newest', 'oldest']);
  });

  it('AC5 — excludes superseded self entries from the printed list', async () => {
    mockQdrant.scroll.mockResolvedValue([
      {
        id: 'active-one',
        payload: { kind: 'self', bank: 'my-bank', timestamp_utc: now, superseded: false },
      },
      {
        id: 'superseded-one',
        payload: { kind: 'self', bank: 'my-bank', timestamp_utc: earlier, superseded: true },
      },
    ]);

    await handleBankShow({ id: 'my-bank', json: true }, showDeps());

    const result = jsonResult();
    const entries = result['entries'] as Array<{ id: string }>;
    expect(entries.map((e) => e.id)).toEqual(['active-one']);
  });

  it('AC5 / §18.14 item 12 — counts are broken down per kind AND per state', async () => {
    mockQdrant.scroll.mockResolvedValue([
      { id: '1', payload: { kind: 'self', bank: 'my-bank', timestamp_utc: now } },
      {
        id: '2',
        payload: { kind: 'self', bank: 'my-bank', timestamp_utc: earlier, archived: true },
      },
      {
        id: '3',
        payload: { kind: 'self', bank: 'my-bank', timestamp_utc: earliest, superseded: true },
      },
      {
        id: '4',
        payload: { kind: 'episodic', bank: 'my-bank', timestamp_utc: now, session_id: 's1' },
      },
    ]);

    await handleBankShow({ id: 'my-bank', json: true }, showDeps());

    const result = jsonResult();
    const counts = result['counts'] as {
      self: { active: number; archived: number; superseded: number };
      episodic: { active: number; archived: number; superseded: number };
      semantic: { active: number; archived: number; superseded: number };
    };
    expect(counts.self).toEqual({ active: 1, archived: 1, superseded: 1 });
    expect(counts.episodic).toEqual({ active: 1, archived: 0, superseded: 0 });
    expect(counts.semantic).toEqual({ active: 0, archived: 0, superseded: 0 });
  });

  it('EC-13 — an archived-only bank still prints its archived self entries', async () => {
    mockQdrant.scroll.mockResolvedValue([
      {
        id: 'archived-one',
        payload: { kind: 'self', bank: 'my-bank', timestamp_utc: now, archived: true },
      },
    ]);

    await handleBankShow({ id: 'my-bank', json: true }, showDeps());

    const result = jsonResult();
    const entries = result['entries'] as Array<{ id: string }>;
    const counts = result['counts'] as { self: { active: number; archived: number } };
    expect(entries.map((e) => e.id)).toEqual(['archived-one']);
    expect(counts.self.archived).toBe(1);
    expect(counts.self.active).toBe(0);
  });

  it('EC-14 — counts.self reflects the raw count, not the printed (superseded-filtered) list', async () => {
    mockQdrant.scroll.mockResolvedValue([
      {
        id: 'superseded-one',
        payload: { kind: 'self', bank: 'my-bank', timestamp_utc: now, superseded: true },
      },
      {
        id: 'superseded-two',
        payload: { kind: 'self', bank: 'my-bank', timestamp_utc: earlier, superseded: true },
      },
    ]);

    await handleBankShow({ id: 'my-bank', json: true }, showDeps());

    const result = jsonResult();
    const entries = result['entries'] as unknown[];
    const counts = result['counts'] as { self: { superseded: number } };
    expect(entries).toEqual([]);
    expect(counts.self.superseded).toBe(2);
  });

  it('AC5 — last_session_id from the most recent non-archived, non-superseded episodic entry', async () => {
    mockQdrant.scroll.mockResolvedValue([
      {
        id: '1',
        payload: {
          kind: 'episodic',
          bank: 'my-bank',
          timestamp_utc: now,
          session_id: 'session-newest',
        },
      },
      {
        id: '2',
        payload: {
          kind: 'episodic',
          bank: 'my-bank',
          timestamp_utc: earlier,
          session_id: 'session-older',
        },
      },
    ]);

    await handleBankShow({ id: 'my-bank', json: true }, showDeps());

    const result = jsonResult();
    expect(result['last_session_id']).toBe('session-newest');
  });

  it('AC5 — unknown bank exits 0 with zero counts, empty entries, null last_session_id, and a notice', async () => {
    mockQdrant.scroll.mockResolvedValue([]);

    await handleBankShow({ id: 'never-created', json: true }, showDeps());

    const result = jsonResult();
    expect(result['entries']).toEqual([]);
    expect(result['last_session_id']).toBeNull();
    const counts = result['counts'] as {
      self: { active: number; archived: number; superseded: number };
    };
    expect(counts.self).toEqual({ active: 0, archived: 0, superseded: 0 });
  });

  it('AC5 — unknown bank in human mode prints a notice, not an error', async () => {
    mockQdrant.scroll.mockResolvedValue([]);

    await expect(handleBankShow({ id: 'never-created' }, showDeps())).resolves.toBeUndefined();
    expect(stdoutData.length).toBeGreaterThan(0);
  });

  it('EC-15 — show --id kb is not rejected the way init --id kb is', async () => {
    mockQdrant.scroll.mockResolvedValue([]);
    await expect(handleBankShow({ id: 'kb', json: true }, showDeps())).resolves.toBeUndefined();
  });
});
