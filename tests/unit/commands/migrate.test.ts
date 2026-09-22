import { handleMigrate } from '../../../src/commands/migrate.js';
import type { MigrateDeps } from '../../../src/commands/migrate.js';
import { MemoError } from '../../../src/lib/errors.js';
import type { ScrollResult } from '../../../src/lib/qdrant.js';

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
      rationale: 'A v1 rationale.',
      tags: ['decision', 'x'],
      entry_type: 'decision',
      source: 'agent',
      timestamp_utc: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  };
}

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
});

afterEach(() => {
  jest.restoreAllMocks();
});

const loadCfgNotFound: MigrateDeps['loadCfg'] = () =>
  Promise.reject(new MemoError('CONFIG_NOT_FOUND', 'no config'));

describe('handleMigrate — flag validation', () => {
  it('requires --to-v2', async () => {
    const mock = createMockQdrant([]);
    await expect(
      handleMigrate(
        {},
        { createRepo: () => mock as any, loadCfg: loadCfgNotFound }, // eslint-disable-line @typescript-eslint/no-explicit-any
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mock.scrollAll).not.toHaveBeenCalled();
  });
});

describe('handleMigrate — AC2: --dry-run issues zero write calls (EC-8, F-1 release-blocking gate)', () => {
  const deps = (mock: MockQdrant): MigrateDeps => ({
    createRepo: () => mock as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    loadCfg: loadCfgNotFound,
    now: () => '2026-09-22T00:00:00.000Z',
  });

  it('default rules, mixed rule-1/rule-2 fixture: zero write calls under --dry-run', async () => {
    const mock = createMockQdrant([
      [v1Point('a', { tags: ['intent'] }), v1Point('b', { tags: ['decision'] })],
    ]);
    await handleMigrate({ toV2: true, dryRun: true, json: true }, deps(mock));

    expect(mock.batchSetPayload).not.toHaveBeenCalled();
    expect(mock.setPayload).not.toHaveBeenCalled();
    expect(mock.upsert).not.toHaveBeenCalled();
    expect(mock.deleteById).not.toHaveBeenCalled();
    expect(mock.deleteByFilter).not.toHaveBeenCalled();

    const parsed = JSON.parse(stdoutData);
    expect(parsed).toEqual({
      scanned: 2,
      migrated: 2,
      skipped: 0,
      by_rule: { '1': 1, '2': 1 },
      dry_run: true,
    });
  });

  it('empty collection: zero write calls under --dry-run', async () => {
    const mock = createMockQdrant([]);
    await handleMigrate({ toV2: true, dryRun: true, json: true }, deps(mock));
    expect(mock.batchSetPayload).not.toHaveBeenCalled();
    expect(JSON.parse(stdoutData)).toEqual({
      scanned: 0,
      migrated: 0,
      skipped: 0,
      by_rule: {},
      dry_run: true,
    });
  });

  it('custom --rules file: zero write calls under --dry-run', async () => {
    const mock = createMockQdrant([[v1Point('a', { tags: ['x'] })]]);
    const readRulesFile = jest
      .fn()
      .mockResolvedValue(JSON.stringify([{ name: 'r', when: {}, set: { kind: 'semantic' } }]));
    await handleMigrate(
      { toV2: true, dryRun: true, rules: 'rules.json', json: true },
      { ...deps(mock), readRulesFile },
    );
    expect(mock.batchSetPayload).not.toHaveBeenCalled();
  });
});

describe('handleMigrate — AC3: real run and page-loop call count', () => {
  const deps = (mock: MockQdrant): MigrateDeps => ({
    createRepo: () => mock as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    loadCfg: loadCfgNotFound,
    now: () => '2026-09-22T00:00:00.000Z',
  });

  it('issues exactly one batchSetPayload call per non-empty page', async () => {
    const mock = createMockQdrant([[v1Point('a'), v1Point('b')], [v1Point('c')], [v1Point('d')]]);
    await handleMigrate({ toV2: true, json: true }, deps(mock));

    expect(mock.batchSetPayload).toHaveBeenCalledTimes(3);
    expect(mock.deleteById).not.toHaveBeenCalled();
    expect(mock.deleteByFilter).not.toHaveBeenCalled();

    const parsed = JSON.parse(stdoutData);
    expect(parsed.scanned).toBe(4);
    expect(parsed.migrated).toBe(4);
    expect(parsed.dry_run).toBe(false);
  });

  it('never includes a vector in the batchSetPayload ops', async () => {
    const mock = createMockQdrant([[v1Point('a')]]);
    await handleMigrate({ toV2: true, json: true }, deps(mock));
    const ops = mock.batchSetPayload.mock.calls[0]![0] as { id: string; payload: unknown }[];
    for (const op of ops) {
      expect(op).not.toHaveProperty('vector');
    }
  });

  it('a second run over an already-migrated fixture (empty page set) issues zero write calls', async () => {
    const mock = createMockQdrant([]);
    await handleMigrate({ toV2: true, json: true }, deps(mock));
    expect(mock.batchSetPayload).not.toHaveBeenCalled();
    const parsed = JSON.parse(stdoutData);
    expect(parsed).toEqual({ scanned: 0, migrated: 0, skipped: 0, by_rule: {}, dry_run: false });
  });
});

describe('handleMigrate — AC4: --rules validation happens before any scan', () => {
  const deps = (mock: MockQdrant, overrides: Partial<MigrateDeps> = {}): MigrateDeps => ({
    createRepo: () => mock as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    loadCfg: loadCfgNotFound,
    ...overrides,
  });

  it('CT-5/CT-6: a non-exhaustive rules file fails VALIDATION_FAILED with zero scrollAll calls', async () => {
    const mock = createMockQdrant([[v1Point('a')]]);
    const readRulesFile = jest
      .fn()
      .mockResolvedValue(
        JSON.stringify([{ name: '1', when: { tags_any: ['x'] }, set: { kind: 'semantic' } }]),
      );

    await expect(
      handleMigrate({ toV2: true, rules: 'rules.json' }, deps(mock, { readRulesFile })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mock.scrollAll).not.toHaveBeenCalled();
  });

  it('EC-10: a rules file that is not a JSON array fails VALIDATION_FAILED with zero scrollAll calls', async () => {
    const mock = createMockQdrant([[v1Point('a')]]);
    const readRulesFile = jest.fn().mockResolvedValue(JSON.stringify({ not: 'an array' }));

    await expect(
      handleMigrate({ toV2: true, rules: 'rules.json' }, deps(mock, { readRulesFile })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mock.scrollAll).not.toHaveBeenCalled();
  });

  it('EC-10: malformed JSON in the rules file fails VALIDATION_FAILED with zero scrollAll calls', async () => {
    const mock = createMockQdrant([[v1Point('a')]]);
    const readRulesFile = jest.fn().mockResolvedValue('{ not valid json');

    await expect(
      handleMigrate({ toV2: true, rules: 'rules.json' }, deps(mock, { readRulesFile })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mock.scrollAll).not.toHaveBeenCalled();
  });

  it('an unreadable rules file (fs error) fails VALIDATION_FAILED with zero scrollAll calls', async () => {
    const mock = createMockQdrant([[v1Point('a')]]);
    const readRulesFile = jest.fn().mockRejectedValue(new Error('ENOENT'));

    await expect(
      handleMigrate({ toV2: true, rules: 'missing.json' }, deps(mock, { readRulesFile })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mock.scrollAll).not.toHaveBeenCalled();
  });

  it('SC-4: a valid custom rules file replaces the defaults entirely', async () => {
    const mock = createMockQdrant([[v1Point('a', { tags: ['intent'] })]]);
    const readRulesFile = jest
      .fn()
      .mockResolvedValue(JSON.stringify([{ name: 'only', when: {}, set: { kind: 'semantic' } }]));
    await handleMigrate(
      { toV2: true, dryRun: true, rules: 'rules.json', json: true },
      deps(mock, { readRulesFile, now: () => '2026-09-22T00:00:00.000Z' }),
    );
    const parsed = JSON.parse(stdoutData);
    expect(parsed.by_rule).toEqual({ only: 1 });
  });
});

describe('handleMigrate — AC5: progress reporting and exit-0 no-op', () => {
  const deps = (mock: MockQdrant): MigrateDeps => ({
    createRepo: () => mock as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    loadCfg: loadCfgNotFound,
  });

  it('SC-2: human mode writes at least one progress line per page to stderr', async () => {
    const mock = createMockQdrant([[v1Point('a')], [v1Point('b')]]);
    await handleMigrate({ toV2: true }, deps(mock));
    const lines = stderrData.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('SC-2: --json mode writes zero stderr progress lines; stdout is parseable JSON with exactly the documented keys', async () => {
    const mock = createMockQdrant([[v1Point('a')], [v1Point('b')]]);
    await handleMigrate({ toV2: true, json: true }, deps(mock));
    expect(stderrData).toBe('');
    const parsed = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ['by_rule', 'dry_run', 'migrated', 'scanned', 'skipped'].sort(),
    );
  });

  it('SC-3: exit-0 no-op on an empty collection (empty collection, or already fully v2)', async () => {
    const mock = createMockQdrant([]);
    await expect(handleMigrate({ toV2: true, json: true }, deps(mock))).resolves.toBeUndefined();
    const parsed = JSON.parse(stdoutData);
    expect(parsed).toEqual({ scanned: 0, migrated: 0, skipped: 0, by_rule: {}, dry_run: false });
  });
});
