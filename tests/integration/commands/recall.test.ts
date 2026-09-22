import { handleRecall } from '../../../src/commands/recall.js';
import type { RecallDeps } from '../../../src/commands/recall.js';
import { MemoConfigSchema } from '../../../src/types/config.js';

const config = MemoConfigSchema.parse({
  schema_version: '2',
  repo: 'memo-cli',
  org: 'llipe',
  domain: 'developer-tools',
});

interface Clause {
  key?: string;
  match?: { value?: unknown; any?: unknown[] };
  should?: Clause[];
  is_empty?: { key: string };
}

interface Filter {
  must?: Clause[];
  must_not?: Clause[];
  should?: Clause[];
}

function hasClause(filter: Filter, key: string, value?: unknown): boolean {
  return (filter.must ?? []).some((c) => {
    if (c.key === key) return value === undefined || c.match?.value === value;
    return false;
  });
}

// Two banks: `kb` (shared) and `alpha` (private). One superseded `self`
// entry (excluded by buildBaseFilter's default must_not, so it never
// reaches the mocked scroll response - matching real Qdrant behavior). One
// `policy` entry in `kb`. A two-session episodic history in `alpha`
// (`ISSUE-1` older, `ISSUE-2` most recent).
const selfEntries = [
  { id: 'self-2', payload: { kind: 'self', bank: 'alpha', rationale: 'Second self fact.' } },
  { id: 'self-1', payload: { kind: 'self', bank: 'alpha', rationale: 'First self fact.' } },
  // 'self-superseded' intentionally omitted here - a real superseded=true
  // point would never pass buildBaseFilter's must_not clause.
];

const policyEntry = {
  id: 'policy-1',
  score: 0.9,
  payload: {
    kind: 'semantic',
    bank: 'kb',
    entry_type: 'policy',
    rationale: 'Always write tests first.',
    tags: ['policy', 'testing'],
    source: 'manual',
    timestamp_utc: '2026-01-01T00:00:00.000Z',
  },
};

const sharedEntry = {
  id: 'shared-1',
  score: 0.85,
  payload: {
    kind: 'semantic',
    bank: 'kb',
    entry_type: 'decision',
    rationale: 'Use QdrantRepository for all storage access.',
    tags: ['qdrant', 'storage'],
    source: 'agent',
    repo: 'memo-cli',
    timestamp_utc: '2026-02-01T00:00:00.000Z',
  },
};

const mineEntry = {
  id: 'mine-1',
  score: 0.8,
  payload: {
    kind: 'semantic',
    bank: 'alpha',
    entry_type: 'decision',
    rationale: 'Prefer small, composable helper functions.',
    tags: ['style', 'helpers'],
    source: 'agent',
    timestamp_utc: '2026-02-05T00:00:00.000Z',
  },
};

const latestEpisodic = {
  id: 'issue2-2',
  payload: {
    kind: 'episodic',
    bank: 'alpha',
    session_id: 'ISSUE-2',
    seq: 2,
    rationale: 'Outcome: story S2-07 landed.',
    timestamp_utc: '2026-03-02T00:00:00.000Z',
  },
};

const session2Entries = [
  {
    id: 'issue2-1',
    payload: {
      kind: 'episodic',
      bank: 'alpha',
      session_id: 'ISSUE-2',
      seq: 1,
      rationale: 'Intent: start S2-07.',
      timestamp_utc: '2026-03-01T00:00:00.000Z',
    },
  },
  latestEpisodic,
];

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  setPayload: jest.fn().mockResolvedValue(undefined),
  batchSetPayload: jest.fn().mockResolvedValue(undefined),
  fetchStalenessCorpus: jest.fn().mockResolvedValue([]),
  search: jest.fn((_vector: number[], filter: Filter) => {
    if (hasClause(filter, 'entry_type', 'policy')) return Promise.resolve([policyEntry]);
    if (hasClause(filter, 'bank', 'alpha')) return Promise.resolve([mineEntry]);
    return Promise.resolve([sharedEntry]);
  }),
  scroll: jest.fn((filter: Filter, _limit: number) => {
    if (hasClause(filter, 'kind', 'self')) return Promise.resolve(selfEntries);
    if (hasClause(filter, 'pending_contradiction')) return Promise.resolve([]);
    if (hasClause(filter, 'kind', 'episodic')) return Promise.resolve([latestEpisodic]);
    return Promise.resolve([]);
  }),
  scrollOrdered: jest.fn().mockResolvedValue(session2Entries),
};

const mockEmbeddings = {
  embed: jest.fn().mockResolvedValue(new Array<number>(1536).fill(0.2)),
  dimensions: 1536,
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

describe('recall integration', () => {
  const deps: RecallDeps = {
    loadCfg: jest.fn().mockResolvedValue(config),
    createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  it('assembles the full JSON bundle for a private bank: SELF (superseded excluded), POLICIES, SHARED, MINE, LAST SESSION (ISSUE-2, seq asc), CONFLICTS', async () => {
    await handleRecall({ task: 'plan the next story', bank: 'alpha', json: true }, deps);

    const bundle = JSON.parse(stdoutData);

    expect(bundle.bank).toBe('alpha');
    expect(bundle.sections.self.map((e: any) => e.id)).toEqual(['self-2', 'self-1']);
    expect(bundle.sections.self.some((e: any) => e.id === 'self-superseded')).toBe(false);

    expect(bundle.sections.policies).toHaveLength(1);
    expect(bundle.sections.policies[0].id).toBe('policy-1');
    expect(bundle.sections.policies[0].entry_type).toBe('policy');

    expect(bundle.sections.shared).toHaveLength(1);
    expect(bundle.sections.shared[0].id).toBe('shared-1');
    expect(bundle.sections.shared[0]).toHaveProperty('final_score');
    expect(bundle.sections.shared[0]).toHaveProperty('confidence_tier');

    expect(bundle.sections.mine).toHaveLength(1);
    expect(bundle.sections.mine[0].id).toBe('mine-1');

    expect(bundle.sections.last_session.session_id).toBe('ISSUE-2');
    expect(bundle.sections.last_session.entries.map((e: any) => e.id)).toEqual([
      'issue2-1',
      'issue2-2',
    ]);
    expect(bundle.sections.last_session.entries.map((e: any) => e.seq)).toEqual([1, 2]);

    expect(bundle.sections.conflicts).toEqual([]);

    expect(bundle.truncated).toEqual([]);
    expect(bundle.query_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('kb bank omits self/mine/last_session and only returns POLICIES, SHARED, CONFLICTS', async () => {
    await handleRecall({ task: 'plan the next story', bank: 'kb', json: true }, deps);

    const bundle = JSON.parse(stdoutData);

    expect(bundle.bank).toBe('kb');
    expect(bundle.sections).not.toHaveProperty('self');
    expect(bundle.sections).not.toHaveProperty('mine');
    expect(bundle.sections).not.toHaveProperty('last_session');
    expect(bundle.sections.policies).toHaveLength(1);
    expect(bundle.sections.shared).toHaveLength(1);
    expect(bundle.sections.conflicts).toEqual([]);
  });

  it('zero write calls across the full gather (CT-06, A14)', async () => {
    await handleRecall({ task: 'plan the next story', bank: 'alpha', json: true }, deps);
    expect(mockQdrant.setPayload).not.toHaveBeenCalled();
    expect(mockQdrant.batchSetPayload).not.toHaveBeenCalled();
  });

  it('embeds exactly once for the whole invocation (AC8)', async () => {
    await handleRecall({ task: 'plan the next story', bank: 'alpha', json: true }, deps);
    expect(mockEmbeddings.embed).toHaveBeenCalledTimes(1);
  });
});
