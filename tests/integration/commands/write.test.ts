import { handleWrite } from '../../../src/commands/write.js';
import type { WriteDeps } from '../../../src/commands/write.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  upsert: jest.fn().mockResolvedValue(undefined),
  getByDedupeKey: jest.fn().mockResolvedValue(null),
  search: jest.fn().mockResolvedValue([]),
  scroll: jest.fn().mockResolvedValue([]),
};

const mockEmbeddings = {
  embed: jest.fn().mockResolvedValue(new Array<number>(1536).fill(0.1)),
  dimensions: 1536,
};

const mockConfig = {
  schema_version: '1' as const,
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('write integration', () => {
  it('full write flow: validates, embeds, upserts, and returns JSON', async () => {
    await handleWrite(
      {
        rationale: 'We chose Qdrant for its native payload filtering capabilities.',
        tags: 'qdrant,storage,filtering',
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
    expect(result['created']).toBe(true);
    expect(result['confidence']).toBe('high');
    expect(result['dedupe_key_sha256']).toHaveLength(64);
  });

  it('applies --on-duplicate update when duplicate returned', async () => {
    const existingEntry = {
      id: '00000000-0000-0000-0000-000000000001',
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
      dedupe_key_version: 'v1',
    };
    mockQdrant.getByDedupeKey.mockResolvedValue({ id: existingEntry.id, payload: existingEntry });

    await handleWrite(
      {
        rationale: 'Old rationale.',
        tags: 'qdrant,storage',
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

    await expect(handleWrite({ rationale: 'test', tags: 'a,b' }, noCfgDeps)).rejects.toMatchObject({
      code: 'REPO_CONTEXT_UNRESOLVED',
    });
  });
});
