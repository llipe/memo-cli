import { handleWrite } from '../../../src/commands/write.js';
import type { WriteDeps } from '../../../src/commands/write.js';
import {
  DEFAULT_KB_EPISODIC_POLICY,
  DEFAULT_KB_SEMANTIC_POLICY,
  DEFAULT_PRIVATE_EPISODIC_POLICY,
  DEFAULT_PRIVATE_SELF_SOFT_CAP,
  DEFAULT_PRIVATE_SEMANTIC_POLICY,
} from '../../../src/types/config.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  upsert: jest.fn().mockResolvedValue(undefined),
  getByDedupeKey: jest.fn().mockResolvedValue(null),
  getById: jest.fn().mockResolvedValue(null),
  setPayload: jest.fn().mockResolvedValue(undefined),
  count: jest.fn().mockResolvedValue(0),
  scrollOrdered: jest.fn().mockResolvedValue([]),
  search: jest.fn().mockResolvedValue([]),
  scroll: jest.fn().mockResolvedValue([]),
};

const mockEmbeddings = {
  embed: jest.fn().mockResolvedValue(new Array<number>(1536).fill(0.1)),
  dimensions: 1536,
};

const mockConfig = {
  schema_version: '2' as const,
  bank: { default: 'kb' },
  banks: {
    kb: { episodic: DEFAULT_KB_EPISODIC_POLICY, semantic: DEFAULT_KB_SEMANTIC_POLICY },
    private: {
      self: { soft_cap: DEFAULT_PRIVATE_SELF_SOFT_CAP },
      episodic: DEFAULT_PRIVATE_EPISODIC_POLICY,
      semantic: DEFAULT_PRIVATE_SEMANTIC_POLICY,
    },
  },
  recall: { max_tokens: 2000 },
  repo: 'test-repo',
  org: 'test-org',
  domain: 'backend',
  relates_to: [],
  defaults: { source: 'agent' as const, search_scope: 'repo' as const },
};

const DEPS: WriteDeps = {
  loadCfg: jest.fn().mockResolvedValue(mockConfig),
  createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  createEmbeddings: () => mockEmbeddings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
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
  mockQdrant.getByDedupeKey.mockResolvedValue(null);
  mockQdrant.getById.mockResolvedValue(null);
  mockQdrant.count.mockResolvedValue(0);
  mockQdrant.scrollOrdered.mockResolvedValue([]);
  delete process.env['MEMO_BANK'];
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env['MEMO_BANK'];
});

describe('write integration', () => {
  it('full write flow: validates, embeds, upserts, and returns JSON', async () => {
    await handleWrite(
      {
        rationale: 'We chose Qdrant for its native payload filtering capabilities.',
        tags: 'qdrant,storage,filtering',
        manual: true,
        json: true,
      },
      DEPS,
    );

    expect(mockQdrant.ensureCollection).toHaveBeenCalled();
    expect(mockEmbeddings.embed).toHaveBeenCalled();
    expect(mockQdrant.upsert).toHaveBeenCalled();

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['repo']).toBe('test-repo');
    expect(result['org']).toBe('test-org');
    expect(result['bank']).toBe('kb');
    expect(result['kind']).toBe('semantic');
    expect(result['schema_version']).toBe('2');
    expect(result['created']).toBe(true);
    expect(result['confidence']).toBe('medium');
    expect(result['dedupe_key_sha256']).toBeTruthy();
    expect(result['dedupe_key_version']).toBe('v2');
  });

  it('applies --on-duplicate update when duplicate returned', async () => {
    const existingEntry = {
      id: '00000000-0000-0000-0000-000000000001',
      bank: 'kb',
      kind: 'semantic',
      schema_version: '2',
      repo: 'test-repo',
      org: 'test-org',
      domain: 'backend',
      rationale: 'Old rationale.',
      tags: ['qdrant', 'storage'],
      entry_type: 'decision',
      source: 'agent',
      confidence: 'high',
      timestamp_utc: '2025-01-01T00:00:00.000Z',
      dedupe_key_sha256: 'existing',
      dedupe_key_version: 'v2',
    };
    mockQdrant.getByDedupeKey.mockResolvedValue({ id: existingEntry.id, payload: existingEntry });

    await handleWrite(
      {
        rationale: 'Old rationale.',
        tags: 'qdrant,storage',
        manual: true,
        json: true,
        onDuplicate: 'update',
        story: 'SP-1',
        files: 'src/main.ts,src/lib.ts',
      },
      DEPS,
    );

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['duplicate_detected']).toBe(true);
    expect(result['updated']).toBe(true);
  });

  it('returns REPO_CONTEXT_UNRESOLVED when no config and no flags', async () => {
    const { MemoError } = await import('../../../src/lib/errors.js');

    const noCfgDeps: WriteDeps = {
      ...DEPS,
      loadCfg: jest.fn().mockRejectedValue(new MemoError('CONFIG_NOT_FOUND', 'not found')),
    };

    await expect(
      handleWrite({ rationale: 'test', tags: 'a,b', manual: true }, noCfgDeps),
    ).rejects.toMatchObject({
      code: 'REPO_CONTEXT_UNRESOLVED',
    });
  });

  it('SC-8: --supersedes round-trip — write A, write B --supersedes A, A shows valid_to/superseded/superseded_by', async () => {
    const noCfgLikeDeps: WriteDeps = { ...DEPS };

    // Write A: a plain semantic --manual entry.
    await handleWrite(
      { rationale: 'Decision A.', tags: 'a,b', manual: true, kind: 'semantic', json: true },
      noCfgLikeDeps,
    );
    const entryA = JSON.parse(stdoutData) as Record<string, unknown>;
    const idA = entryA['id'] as string;

    // The store now "has" A: getById(A) returns it, not superseded.
    mockQdrant.getById.mockResolvedValue({
      id: idA,
      payload: { ...entryA, superseded: false },
    });

    stdoutData = '';
    await handleWrite(
      {
        rationale: 'Decision B supersedes A.',
        tags: 'a,b',
        manual: true,
        kind: 'semantic',
        supersedes: idA,
        json: true,
      },
      noCfgLikeDeps,
    );
    const entryB = JSON.parse(stdoutData) as Record<string, unknown>;

    expect(entryB['superseded']).toBe(idA);
    expect(mockQdrant.setPayload).toHaveBeenCalledWith(
      idA,
      expect.objectContaining({ superseded: true, superseded_by: entryB['id'] }),
    );
  });

  it('SC-12: two banks never share a dedupe hit even with identical content', async () => {
    mockQdrant.getByDedupeKey.mockResolvedValue(null);

    await handleWrite(
      {
        rationale: 'Same content.',
        tags: 'a,b',
        manual: true,
        kind: 'semantic',
        bank: 'bank-a',
        json: true,
      },
      DEPS,
    );
    const resultA = JSON.parse(stdoutData) as Record<string, unknown>;

    stdoutData = '';
    await handleWrite(
      {
        rationale: 'Same content.',
        tags: 'a,b',
        manual: true,
        kind: 'semantic',
        bank: 'bank-b',
        json: true,
      },
      DEPS,
    );
    const resultB = JSON.parse(stdoutData) as Record<string, unknown>;

    expect(resultA['duplicate_detected']).toBe(false);
    expect(resultB['duplicate_detected']).toBe(false);
  });

  it('SC-12: a kb semantic write catches a pre-migration v1-keyed duplicate', async () => {
    const v1Entry = {
      id: '00000000-0000-0000-0000-000000000002',
      repo: 'test-repo',
      org: 'test-org',
      domain: 'backend',
      rationale: 'Pre-migration decision.',
      tags: ['a', 'b'],
      entry_type: 'decision',
      source: 'manual',
      confidence: 'medium',
      timestamp_utc: '2025-01-01T00:00:00.000Z',
      dedupe_key_sha256: 'a'.repeat(64),
      dedupe_key_version: 'v1',
    };
    // First call (v2 key) misses; second call (v1 key) hits.
    mockQdrant.getByDedupeKey.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: v1Entry.id,
      payload: v1Entry,
    });

    await handleWrite(
      {
        rationale: 'Pre-migration decision.',
        tags: 'a,b',
        manual: true,
        onDuplicate: 'update',
        json: true,
      },
      DEPS,
    );

    expect(mockQdrant.getByDedupeKey).toHaveBeenCalledTimes(2);
    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['duplicate_detected']).toBe(true);
  });
});
