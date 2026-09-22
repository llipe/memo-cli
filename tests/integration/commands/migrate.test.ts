import { handleMigrate } from '../../../src/commands/migrate.js';
import type { MigrateDeps } from '../../../src/commands/migrate.js';
import { normalizeEntry } from '../../../src/lib/entry-normalize.js';
import { MemoError } from '../../../src/lib/errors.js';
import type { ScrollResult } from '../../../src/lib/qdrant.js';

/**
 * Integration coverage for issue #88 / Story S2-09 (`memo migrate --to-v2`):
 * a mocked three-page Qdrant collection of v1 points is driven through the
 * full lifecycle SC-1 describes — dry-run (zero writes) -> real run (one
 * `batchSetPayload` per page) -> second real run (`scanned: 0`) — with the
 * no-`delete*`-ever guarantee (EC-9/F-2) asserted independently after each
 * phase, and a replay-identity check (AC6) on the resulting payloads.
 */

interface MockQdrant {
  ensureCollection: jest.Mock;
  scrollAll: jest.Mock;
  batchSetPayload: jest.Mock;
  setPayload: jest.Mock;
  upsert: jest.Mock;
  deleteById: jest.Mock;
  deleteByFilter: jest.Mock;
}

function createMockQdrant(pages: ScrollResult[][]): MockQdrant {
  return {
    ensureCollection: jest.fn().mockResolvedValue(undefined),
    scrollAll: jest.fn(
      async (
        _filter: unknown,
        _opts: unknown,
        onPage: (page: ScrollResult[]) => void | Promise<void>,
      ) => {
        for (const page of pages) {
          if (page.length > 0) await onPage(page);
        }
      },
    ),
    batchSetPayload: jest.fn().mockResolvedValue(undefined),
    setPayload: jest.fn().mockResolvedValue(undefined),
    upsert: jest.fn().mockResolvedValue(undefined),
    deleteById: jest.fn().mockResolvedValue(undefined),
    deleteByFilter: jest.fn().mockResolvedValue(0),
  };
}

function v1Point(id: string, overrides: Record<string, unknown> = {}): ScrollResult {
  return {
    id,
    payload: {
      rationale: `Rationale for ${id}.`,
      tags: ['decision', 'x'],
      entry_type: 'decision',
      source: 'agent',
      timestamp_utc: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  };
}

/** Every write-family call the safety oracle must see zero of, in any mode. */
function expectNoWriteFamilyCalls(mock: MockQdrant): void {
  expect(mock.batchSetPayload).not.toHaveBeenCalled();
  expect(mock.setPayload).not.toHaveBeenCalled();
  expect(mock.upsert).not.toHaveBeenCalled();
}

function expectNoDeleteEver(mock: MockQdrant): void {
  expect(mock.deleteById).not.toHaveBeenCalled();
  expect(mock.deleteByFilter).not.toHaveBeenCalled();
}

let stdoutData = '';

beforeEach(() => {
  stdoutData = '';
  jest.spyOn(process.stdout, 'write').mockImplementation((data: any) => {
    stdoutData += String(data);
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const loadCfgNotFound: MigrateDeps['loadCfg'] = () =>
  Promise.reject(new MemoError('CONFIG_NOT_FOUND', 'no config'));

describe('migrate integration — SC-1: dry-run -> real run -> second real run', () => {
  it('three mocked pages of v1 points: full lifecycle with independent no-delete checkpoints (EC-9)', async () => {
    const page1 = [
      v1Point('a1', { tags: ['intent'], story: 'ISSUE-1' }),
      v1Point('a2', { tags: ['outcome'] }),
    ];
    const page2 = [v1Point('b1', { tags: ['decision'] })];
    const page3 = [v1Point('c1', { tags: ['structure'] }), v1Point('c2', { tags: ['note'] })];
    const fixturePages = [page1, page2, page3];
    const totalPoints = page1.length + page2.length + page3.length;

    const deps = (mock: MockQdrant): MigrateDeps => ({
      createRepo: () => mock as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      loadCfg: loadCfgNotFound,
      now: () => '2026-09-22T00:00:00.000Z',
    });

    // Phase 1: dry-run. Zero writes, zero deletes (checkpoint 1 of EC-9).
    const dryRunMock = createMockQdrant(fixturePages);
    await handleMigrate({ toV2: true, dryRun: true, json: true }, deps(dryRunMock));
    expectNoWriteFamilyCalls(dryRunMock);
    expectNoDeleteEver(dryRunMock);
    const dryRunResult = JSON.parse(stdoutData) as {
      scanned: number;
      migrated: number;
      skipped: number;
      by_rule: Record<string, number>;
      dry_run: boolean;
    };
    expect(dryRunResult.dry_run).toBe(true);
    expect(dryRunResult.scanned).toBe(totalPoints);
    expect(dryRunResult.migrated).toBe(totalPoints);
    expect(dryRunResult.by_rule).toEqual({ '1': 2, '2': 3 });

    // Phase 2: real run. One batchSetPayload per page; zero deletes (checkpoint 2 of EC-9).
    stdoutData = '';
    const realRunMock = createMockQdrant(fixturePages);
    await handleMigrate({ toV2: true, json: true }, deps(realRunMock));
    expect(realRunMock.batchSetPayload).toHaveBeenCalledTimes(3);
    expect(realRunMock.setPayload).not.toHaveBeenCalled();
    expect(realRunMock.upsert).not.toHaveBeenCalled();
    expectNoDeleteEver(realRunMock);
    const realRunResult = JSON.parse(stdoutData) as {
      scanned: number;
      migrated: number;
      by_rule: Record<string, number>;
      dry_run: boolean;
    };
    expect(realRunResult.dry_run).toBe(false);
    expect(realRunResult.scanned).toBe(totalPoints);
    expect(realRunResult.migrated).toBe(totalPoints);
    // by_rule counts are stable between the dry-run preview and the real run.
    expect(realRunResult.by_rule).toEqual(dryRunResult.by_rule);

    // Phase 3: second real run against an already-fully-migrated collection
    // (simulated as an empty result set, since the `is_empty schema_version`
    // filter would now exclude every point). Zero writes, zero deletes
    // (checkpoint 3 of EC-9; EC-7's idempotency assertion).
    stdoutData = '';
    const secondRunMock = createMockQdrant([]);
    await handleMigrate({ toV2: true, json: true }, deps(secondRunMock));
    expectNoWriteFamilyCalls(secondRunMock);
    expectNoDeleteEver(secondRunMock);
    const secondRunResult = JSON.parse(stdoutData) as { scanned: number; migrated: number };
    expect(secondRunResult).toMatchObject({ scanned: 0, migrated: 0 });
  });
});

describe('migrate integration — EC-6: page boundary exactly at 256', () => {
  const deps = (mock: MockQdrant): MigrateDeps => ({
    createRepo: () => mock as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    loadCfg: loadCfgNotFound,
  });

  it('256 points (one full page): exactly one batchSetPayload call covering all 256', async () => {
    const page = Array.from({ length: 256 }, (_, i) => v1Point(`p-${String(i)}`));
    const mock = createMockQdrant([page]);
    await handleMigrate({ toV2: true, json: true }, deps(mock));

    expect(mock.batchSetPayload).toHaveBeenCalledTimes(1);
    const ops = mock.batchSetPayload.mock.calls[0]![0] as unknown[];
    expect(ops).toHaveLength(256);
    const parsed = JSON.parse(stdoutData) as { scanned: number; migrated: number };
    expect(parsed.scanned).toBe(256);
    expect(parsed.migrated).toBe(256);
  });

  it('257 points (one full page + 1): exactly two batchSetPayload calls (256 + 1), no dropped/duplicated point', async () => {
    const fullPage = Array.from({ length: 256 }, (_, i) => v1Point(`p-${String(i)}`));
    const secondPage = [v1Point('p-256')];
    const mock = createMockQdrant([fullPage, secondPage]);
    await handleMigrate({ toV2: true, json: true }, deps(mock));

    expect(mock.batchSetPayload).toHaveBeenCalledTimes(2);
    const firstCallOps = mock.batchSetPayload.mock.calls[0]![0] as { id: string }[];
    const secondCallOps = mock.batchSetPayload.mock.calls[1]![0] as { id: string }[];
    expect(firstCallOps).toHaveLength(256);
    expect(secondCallOps).toHaveLength(1);

    const allIds = new Set([...firstCallOps, ...secondCallOps].map((op) => op.id));
    expect(allIds.size).toBe(257); // no dropped or duplicated point at the boundary

    const parsed = JSON.parse(stdoutData) as { scanned: number; migrated: number };
    expect(parsed.scanned).toBe(257);
    expect(parsed.migrated).toBe(257);
  });
});

describe('migrate integration — AC6: replay identity holds across the rewrite', () => {
  it('migrated payloads resolve to the same bank/kind/archived/superseded defaults normalizeEntry already assigned pre-migration', async () => {
    // The default `memo search` base filter (bank=kb, kind != self,
    // archived=false, superseded=false) is driven by exactly these fields.
    // A v1 point with no bank/kind/archived/superseded already reads as
    // kb/semantic/false/false via normalizeEntry (S2-01) - migration must
    // resolve every non-episodic point to the identical bank/kind/archived/
    // superseded shape, so the same search would still include it.
    const points = [
      v1Point('sem-1', { tags: ['decision', 'x'] }),
      v1Point('sem-2', { tags: ['structure', 'y'] }),
    ];
    const preMigrationNormalized = points.map((p) => normalizeEntry(p.payload ?? {}));

    const mock = createMockQdrant([points]);
    await handleMigrate(
      { toV2: true, json: true },
      {
        createRepo: () => mock as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        loadCfg: loadCfgNotFound,
        now: () => '2026-09-22T00:00:00.000Z',
      },
    );

    const ops = mock.batchSetPayload.mock.calls[0]![0] as {
      id: string;
      payload: Record<string, unknown>;
    }[];
    expect(ops).toHaveLength(2);

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!;
      const pre = preMigrationNormalized[i]!;
      expect(op.payload['bank']).toBe(pre.bank);
      expect(op.payload['kind']).toBe(pre.kind);
      expect(op.payload['archived']).toBe(pre.archived);
      expect(op.payload['superseded']).toBe(pre.superseded);
    }
  });
});

describe('migrate integration — negative-space: no vector ever sent, in any mode', () => {
  it('dry-run and real run ops never include a vector field', async () => {
    const points = [v1Point('a'), v1Point('b', { tags: ['intent'] })];

    const dryRunMock = createMockQdrant([points]);
    await handleMigrate(
      { toV2: true, dryRun: true, json: true },
      { createRepo: () => dryRunMock as any, loadCfg: loadCfgNotFound }, // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    expect(dryRunMock.batchSetPayload).not.toHaveBeenCalled();

    const realRunMock = createMockQdrant([points]);
    await handleMigrate(
      { toV2: true, json: true },
      { createRepo: () => realRunMock as any, loadCfg: loadCfgNotFound }, // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    const ops = realRunMock.batchSetPayload.mock.calls[0]![0] as Record<string, unknown>[];
    for (const op of ops) {
      expect(op).not.toHaveProperty('vector');
    }
  });
});
