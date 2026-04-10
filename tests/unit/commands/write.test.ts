import { handleWrite } from '../../../src/commands/write.js';
import type { WriteDeps } from '../../../src/commands/write.js';
import { MemoError } from '../../../src/lib/errors.js';
import type { EntryPayload } from '../../../src/types/entry.js';

const makeMockQdrant = (existing?: EntryPayload): WriteDeps['createRepo'] => {
  return () =>
    ({
      ensureCollection: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn().mockResolvedValue(undefined),
      getByDedupeKey: jest
        .fn()
        .mockResolvedValue(existing ? { id: existing.id, payload: existing } : null),
      search: jest.fn().mockResolvedValue([]),
      scroll: jest.fn().mockResolvedValue([]),
    }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const mockEmbeddings = () => ({
  embed: jest.fn().mockResolvedValue(new Array<number>(1536).fill(0.1)),
  dimensions: 1536,
});

const BASE_EXISTING: EntryPayload = {
  id: '00000000-0000-0000-0000-000000000001',
  repo: 'my-repo',
  org: 'my-org',
  domain: 'backend',
  rationale: 'Existing rationale.',
  tags: ['qdrant', 'storage'],
  entry_type: 'decision',
  source: 'agent',
  confidence: 'high',
  timestamp_utc: '2025-01-01T00:00:00.000Z',
  dedupe_key_sha256: 'existing-sha',
  dedupe_key_version: 'v1',
};

const BASE_FLAGS = {
  rationale: 'We chose Qdrant for filtering.',
  tags: 'qdrant,storage',
  repo: 'my-repo',
  org: 'my-org',
  domain: 'backend',
  source: 'agent' as const,
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('handleWrite', () => {
  it('writes a new entry successfully (JSON mode)', async () => {
    const deps: WriteDeps = {
      loadCfg: jest
        .fn()
        .mockResolvedValue({
          repo: 'my-repo',
          org: 'my-org',
          domain: 'backend',
          relates_to: [],
          defaults: { source: 'agent', search_scope: 'repo' },
        }),
      createRepo: makeMockQdrant(),
      createEmbeddings: () => mockEmbeddings() as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    await handleWrite({ ...BASE_FLAGS, json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['created']).toBe(true);
    expect(result['updated']).toBe(false);
    expect(result['duplicate_detected']).toBe(false);
    expect(result['repo']).toBe('my-repo');
    expect(result['tags']).toEqual(['qdrant', 'storage']);
  });

  it('throws REPO_CONTEXT_UNRESOLVED when no config and no flags', async () => {
    const deps: WriteDeps = {
      loadCfg: jest.fn().mockRejectedValue(new MemoError('CONFIG_NOT_FOUND', 'not found')),
      createRepo: makeMockQdrant(),
      createEmbeddings: () => mockEmbeddings() as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    await expect(handleWrite({ rationale: 'test', tags: 'a,b' }, deps)).rejects.toMatchObject({
      code: 'REPO_CONTEXT_UNRESOLVED',
    });
  });

  it('throws VALIDATION_FAILED for too few tags', async () => {
    const deps: WriteDeps = {
      loadCfg: jest
        .fn()
        .mockResolvedValue({
          repo: 'r',
          org: 'o',
          domain: 'd',
          relates_to: [],
          defaults: { source: 'agent', search_scope: 'repo' },
        }),
      createRepo: makeMockQdrant(),
      createEmbeddings: () => mockEmbeddings() as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    await expect(handleWrite({ ...BASE_FLAGS, tags: 'only-one' }, deps)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('applies --on-duplicate consolidate when duplicate found', async () => {
    const deps: WriteDeps = {
      loadCfg: jest
        .fn()
        .mockResolvedValue({
          repo: 'my-repo',
          org: 'my-org',
          domain: 'backend',
          relates_to: [],
          defaults: { source: 'agent', search_scope: 'repo' },
        }),
      createRepo: makeMockQdrant(BASE_EXISTING),
      createEmbeddings: () => mockEmbeddings() as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    await handleWrite({ ...BASE_FLAGS, onDuplicate: 'consolidate', json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['duplicate_detected']).toBe(true);
    expect(result['updated']).toBe(true);
  });

  it('applies --on-duplicate create-new when duplicate found', async () => {
    const deps: WriteDeps = {
      loadCfg: jest
        .fn()
        .mockResolvedValue({
          repo: 'my-repo',
          org: 'my-org',
          domain: 'backend',
          relates_to: [],
          defaults: { source: 'agent', search_scope: 'repo' },
        }),
      createRepo: makeMockQdrant(BASE_EXISTING),
      createEmbeddings: () => mockEmbeddings() as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    await handleWrite({ ...BASE_FLAGS, onDuplicate: 'create-new', json: true }, deps);

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['duplicate_detected']).toBe(true);
    expect(result['created']).toBe(true);
  });

  it('outputs VALIDATION_FAILED JSON on duplicate without --on-duplicate in JSON mode', async () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const deps: WriteDeps = {
      loadCfg: jest
        .fn()
        .mockResolvedValue({
          repo: 'my-repo',
          org: 'my-org',
          domain: 'backend',
          relates_to: [],
          defaults: { source: 'agent', search_scope: 'repo' },
        }),
      createRepo: makeMockQdrant(BASE_EXISTING),
      createEmbeddings: () => mockEmbeddings() as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    await expect(handleWrite({ ...BASE_FLAGS, json: true }, deps)).rejects.toThrow(
      'process.exit called',
    );
    expect(stderrData).toContain('VALIDATION_FAILED');
    mockExit.mockRestore();
  });

  it('uses promptDuplicate callback in non-JSON mode', async () => {
    const deps: WriteDeps = {
      loadCfg: jest
        .fn()
        .mockResolvedValue({
          repo: 'my-repo',
          org: 'my-org',
          domain: 'backend',
          relates_to: [],
          defaults: { source: 'agent', search_scope: 'repo' },
        }),
      createRepo: makeMockQdrant(BASE_EXISTING),
      createEmbeddings: () => mockEmbeddings() as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      promptDuplicate: jest.fn().mockResolvedValue('replace'),
    };

    await handleWrite({ ...BASE_FLAGS }, deps);
    expect(deps.promptDuplicate).toHaveBeenCalled();
  });
});
