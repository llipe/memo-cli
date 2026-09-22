import { handleWrite } from '../../../src/commands/write.js';
import type { WriteDeps } from '../../../src/commands/write.js';
import { MemoError } from '../../../src/lib/errors.js';
import {
  DEFAULT_KB_EPISODIC_POLICY,
  DEFAULT_KB_SEMANTIC_POLICY,
  DEFAULT_PRIVATE_EPISODIC_POLICY,
  DEFAULT_PRIVATE_SELF_SOFT_CAP,
  DEFAULT_PRIVATE_SEMANTIC_POLICY,
} from '../../../src/types/config.js';

function fullConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: '2',
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
    repo: 'my-repo',
    org: 'my-org',
    domain: 'backend',
    relates_to: [],
    defaults: { source: 'agent', search_scope: 'repo' },
    ...overrides,
  };
}

interface MockQdrant {
  ensureCollection: jest.Mock;
  upsert: jest.Mock;
  getByDedupeKey: jest.Mock;
  getById: jest.Mock;
  setPayload: jest.Mock;
  count: jest.Mock;
  scrollOrdered: jest.Mock;
  search: jest.Mock;
  scroll: jest.Mock;
}

function createMockQdrant(): MockQdrant {
  return {
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
}

const mockEmbeddings = () => ({
  embed: jest.fn().mockResolvedValue(new Array<number>(1536).fill(0.1)),
  dimensions: 1536,
});

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
let mockQdrant: MockQdrant;

beforeEach(() => {
  stdoutData = '';
  stderrData = '';
  mockQdrant = createMockQdrant();
  jest.spyOn(process.stdout, 'write').mockImplementation((data: any) => {
    stdoutData += String(data);
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation((data: any) => {
    stderrData += String(data);
    return true;
  });
  delete process.env['MEMO_BANK'];
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env['MEMO_BANK'];
});

function deps(overrides: Partial<WriteDeps> = {}): WriteDeps {
  return {
    loadCfg: jest.fn().mockResolvedValue(fullConfig()),
    createRepo: () => mockQdrant as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    createEmbeddings: () => mockEmbeddings() as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    ...overrides,
  };
}

function noCfgDeps(overrides: Partial<WriteDeps> = {}): WriteDeps {
  return deps({
    loadCfg: jest.fn().mockRejectedValue(new MemoError('CONFIG_NOT_FOUND', 'not found')),
    ...overrides,
  });
}

function jsonResult(): Record<string, unknown> {
  return JSON.parse(stdoutData) as Record<string, unknown>;
}

describe('handleWrite — v1 regression (pre-existing behavior)', () => {
  it('writes a new entry successfully (JSON mode)', async () => {
    await handleWrite({ ...BASE_FLAGS, manual: true, json: true }, deps());

    const result = jsonResult();
    expect(result['created']).toBe(true);
    expect(result['updated']).toBe(false);
    expect(result['duplicate_detected']).toBe(false);
    expect(result['repo']).toBe('my-repo');
    expect(result['tags']).toEqual(['qdrant', 'storage']);
  });

  it('throws REPO_CONTEXT_UNRESOLVED when no config and no flags', async () => {
    await expect(
      handleWrite({ rationale: 'test', tags: 'a,b' }, noCfgDeps()),
    ).rejects.toMatchObject({ code: 'REPO_CONTEXT_UNRESOLVED' });
  });

  it('throws VALIDATION_FAILED for too few tags', async () => {
    await expect(
      handleWrite({ ...BASE_FLAGS, manual: true, tags: 'only-one' }, deps()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('applies --on-duplicate consolidate when duplicate found', async () => {
    const existing = {
      id: '00000000-0000-0000-0000-000000000001',
      bank: 'kb',
      kind: 'semantic',
      schema_version: '2',
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
      dedupe_key_version: 'v2',
    };
    mockQdrant.getByDedupeKey.mockResolvedValue({ id: existing.id, payload: existing });

    await handleWrite(
      { ...BASE_FLAGS, manual: true, onDuplicate: 'consolidate', json: true },
      deps(),
    );

    const result = jsonResult();
    expect(result['duplicate_detected']).toBe(true);
    expect(result['updated']).toBe(true);
  });

  it('applies --on-duplicate create-new when duplicate found', async () => {
    mockQdrant.getByDedupeKey.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      payload: { id: '00000000-0000-0000-0000-000000000001', rationale: 'x', tags: ['a', 'b'] },
    });

    await handleWrite(
      { ...BASE_FLAGS, manual: true, onDuplicate: 'create-new', json: true },
      deps(),
    );

    const result = jsonResult();
    expect(result['duplicate_detected']).toBe(true);
    expect(result['created']).toBe(true);
  });

  it('outputs VALIDATION_FAILED JSON on duplicate without --on-duplicate in JSON mode', async () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    mockQdrant.getByDedupeKey.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      payload: { id: '00000000-0000-0000-0000-000000000001', rationale: 'x', tags: ['a', 'b'] },
    });

    await expect(handleWrite({ ...BASE_FLAGS, manual: true, json: true }, deps())).rejects.toThrow(
      'process.exit called',
    );
    expect(stderrData).toContain('VALIDATION_FAILED');
    mockExit.mockRestore();
  });

  it('uses promptDuplicate callback in non-JSON mode', async () => {
    mockQdrant.getByDedupeKey.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      payload: { id: '00000000-0000-0000-0000-000000000001', rationale: 'x', tags: ['a', 'b'] },
    });
    const promptDuplicate = jest.fn().mockResolvedValue('replace');

    await handleWrite({ ...BASE_FLAGS, manual: true }, deps({ promptDuplicate }));
    expect(promptDuplicate).toHaveBeenCalled();
  });
});

describe('handleWrite — AC1: --kind self in kb rejected; succeeds in a private bank', () => {
  it('rejects --kind self in bank kb with VALIDATION_FAILED before any I/O', async () => {
    await expect(handleWrite({ ...BASE_FLAGS, kind: 'self' }, deps())).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(mockQdrant.ensureCollection).not.toHaveBeenCalled();
    expect(mockQdrant.upsert).not.toHaveBeenCalled();
  });

  it('succeeds in a private bank via MEMO_BANK with no --repo/--org/--domain', async () => {
    process.env['MEMO_BANK'] = 'jarvis-memory';

    await handleWrite(
      {
        rationale: 'The owner prefers concise answers.',
        tags: 'persona,preference',
        kind: 'self',
        json: true,
      },
      noCfgDeps(),
    );

    const result = jsonResult();
    expect(result['bank']).toBe('jarvis-memory');
    expect(result['kind']).toBe('self');
    expect(result['schema_version']).toBe('2');
    expect(typeof result['valid_from']).toBe('string');
    expect(result['stability']).toBeUndefined();
    expect(result['stability_since']).toBeUndefined();
    expect(result['expires_at']).toBeUndefined();
    expect(result['retrieval_count']).toBeUndefined();
    expect(result['used_count']).toBeUndefined();
  });
});

describe('handleWrite — AC2: default --kind resolves by bank type', () => {
  it('defaults to episodic in a private bank and semantic in kb', async () => {
    process.env['MEMO_BANK'] = 'jarvis-memory';
    await handleWrite(
      {
        rationale: 'Investigated the schema shape.',
        tags: 'investigation,schema',
        session: 's-1',
        json: true,
      },
      noCfgDeps(),
    );
    const privateResult = jsonResult();
    expect(privateResult['kind']).toBe('episodic');

    delete process.env['MEMO_BANK'];
    stdoutData = '';
    mockQdrant = createMockQdrant();
    await handleWrite({ ...BASE_FLAGS, manual: true, json: true }, deps());
    const kbResult = jsonResult();
    expect(kbResult['kind']).toBe('semantic');
  });
});

describe('handleWrite — AC3: repo-context enforcement differs by bank', () => {
  it('kb missing repo/org/domain fails REPO_CONTEXT_UNRESOLVED', async () => {
    await expect(
      handleWrite({ rationale: 'x', tags: 'a,b', manual: true }, noCfgDeps()),
    ).rejects.toMatchObject({ code: 'REPO_CONTEXT_UNRESOLVED' });
  });

  it('private bank has no repo/org/domain requirement and stores none when omitted', async () => {
    process.env['MEMO_BANK'] = 'jarvis-memory';
    await handleWrite({ rationale: 'x', tags: 'a,b', kind: 'self', json: true }, noCfgDeps());
    const result = jsonResult();
    expect(result['repo']).toBeUndefined();
    expect(result['org']).toBeUndefined();
    expect(result['domain']).toBeUndefined();
  });

  it('private bank stores exactly the supplied optional scope field', async () => {
    process.env['MEMO_BANK'] = 'jarvis-memory';
    await handleWrite(
      { rationale: 'x', tags: 'a,b', kind: 'self', repo: 'foo', json: true },
      noCfgDeps(),
    );
    const result = jsonResult();
    expect(result['repo']).toBe('foo');
    expect(result['org']).toBeUndefined();
    expect(result['domain']).toBeUndefined();
  });
});

describe('handleWrite — AC4: auto-seq and --expires-in', () => {
  it('increments seq per bank+session; explicit --seq is honored verbatim', async () => {
    process.env['MEMO_BANK'] = 'jarvis-memory';
    mockQdrant.scrollOrdered
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'a', payload: { seq: 0 } }])
      .mockResolvedValueOnce([{ id: 'a', payload: { seq: 1 } }]);

    await handleWrite(
      { rationale: 'first', tags: 'a,b', kind: 'episodic', session: 's-42', json: true },
      noCfgDeps(),
    );
    expect(jsonResult()['seq']).toBe(0);

    stdoutData = '';
    await handleWrite(
      { rationale: 'second', tags: 'a,b', kind: 'episodic', session: 's-42', json: true },
      noCfgDeps(),
    );
    expect(jsonResult()['seq']).toBe(1);

    stdoutData = '';
    await handleWrite(
      { rationale: 'third', tags: 'a,b', kind: 'episodic', session: 's-42', seq: 0, json: true },
      noCfgDeps(),
    );
    expect(jsonResult()['seq']).toBe(0);

    stdoutData = '';
    await handleWrite(
      { rationale: 'fourth', tags: 'a,b', kind: 'episodic', session: 's-42', json: true },
      noCfgDeps(),
    );
    expect(jsonResult()['seq']).toBe(2);

    // The third write (explicit --seq) never calls scrollOrdered.
    expect(mockQdrant.scrollOrdered).toHaveBeenCalledTimes(3);
  });

  it('applies the policy default expiry when --expires-in is omitted (private: 30d, kb: 90d)', async () => {
    process.env['MEMO_BANK'] = 'jarvis-memory';
    await handleWrite(
      { rationale: 'x', tags: 'a,b', kind: 'episodic', session: 's-1', json: true },
      noCfgDeps(),
    );
    const privateResult = jsonResult();
    const privateDeltaMs =
      Date.parse(privateResult['expires_at'] as string) -
      Date.parse(privateResult['timestamp_utc'] as string);
    expect(privateDeltaMs).toBe(30 * 24 * 60 * 60 * 1000);

    delete process.env['MEMO_BANK'];
    stdoutData = '';
    mockQdrant = createMockQdrant();
    await handleWrite({ ...BASE_FLAGS, kind: 'episodic', session: 's-1', json: true }, deps());
    const kbResult = jsonResult();
    const kbDeltaMs =
      Date.parse(kbResult['expires_at'] as string) -
      Date.parse(kbResult['timestamp_utc'] as string);
    expect(kbDeltaMs).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it.each([
    ['2d', 2 * 24 * 60 * 60 * 1000],
    ['12h', 12 * 60 * 60 * 1000],
    ['30m', 30 * 60 * 1000],
  ])('--expires-in %s overrides the policy default', async (duration, expectedMs) => {
    process.env['MEMO_BANK'] = 'jarvis-memory';
    await handleWrite(
      {
        rationale: 'x',
        tags: 'a,b',
        kind: 'episodic',
        session: 's-1',
        expiresIn: duration,
        json: true,
      },
      noCfgDeps(),
    );
    const result = jsonResult();
    const deltaMs =
      Date.parse(result['expires_at'] as string) - Date.parse(result['timestamp_utc'] as string);
    expect(deltaMs).toBe(expectedMs);
  });

  it('rejects an invalid --expires-in with VALIDATION_FAILED', async () => {
    process.env['MEMO_BANK'] = 'jarvis-memory';
    await expect(
      handleWrite(
        { rationale: 'x', tags: 'a,b', kind: 'episodic', session: 's-1', expiresIn: '0d' },
        noCfgDeps(),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('handleWrite — EC-2: --context is deduplicated', () => {
  it('deduplicates repeated identical --context values', async () => {
    await handleWrite(
      { ...BASE_FLAGS, manual: true, context: ['foo', 'foo', 'bar'], json: true },
      deps(),
    );
    expect(jsonResult()['contexts']).toEqual(['foo', 'bar']);
  });
});

describe('handleWrite — AC5: entry_type and source defaults/overrides', () => {
  it('defaults entry_type to observation for episodic, decision otherwise', async () => {
    process.env['MEMO_BANK'] = 'jarvis-memory';
    await handleWrite(
      { rationale: 'x', tags: 'a,b', kind: 'episodic', session: 's-1', json: true },
      noCfgDeps(),
    );
    expect(jsonResult()['entry_type']).toBe('observation');

    delete process.env['MEMO_BANK'];
    stdoutData = '';
    mockQdrant = createMockQdrant();
    await handleWrite({ ...BASE_FLAGS, manual: true, json: true }, deps());
    expect(jsonResult()['entry_type']).toBe('decision');
  });

  it('--manual forces source=manual even when --source agent is also given', async () => {
    await handleWrite({ ...BASE_FLAGS, manual: true, source: 'agent', json: true }, deps());
    expect(jsonResult()['source']).toBe('manual');
  });

  it('accepts --source scan (does not trigger the agent-only K3 provenance guard)', async () => {
    await handleWrite({ ...BASE_FLAGS, source: 'scan', json: true }, deps());
    expect(jsonResult()['source']).toBe('scan');
  });
});

describe('handleWrite — AC6: semantic + source agent requires provenance unless --manual', () => {
  it('rejects with VALIDATION_FAILED at provenance when neither is given', async () => {
    await expect(
      handleWrite({ ...BASE_FLAGS, kind: 'semantic', source: 'agent' }, deps()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mockQdrant.ensureCollection).not.toHaveBeenCalled();
  });

  it('succeeds with --provenance supplied', async () => {
    await handleWrite(
      {
        ...BASE_FLAGS,
        kind: 'semantic',
        source: 'agent',
        provenance: '00000000-0000-0000-0000-000000000099',
        json: true,
      },
      deps(),
    );
    expect(jsonResult()['provenance']).toEqual(['00000000-0000-0000-0000-000000000099']);
  });

  it('succeeds with --manual and no --provenance', async () => {
    await handleWrite(
      { ...BASE_FLAGS, kind: 'semantic', source: 'agent', manual: true, json: true },
      deps(),
    );
    expect(jsonResult()['source']).toBe('manual');
  });

  it('treats --provenance "" as no provenance supplied (EC-3)', async () => {
    await expect(
      handleWrite({ ...BASE_FLAGS, kind: 'semantic', source: 'agent', provenance: '' }, deps()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('handleWrite — AC7/AC8: --supersedes', () => {
  const TARGET_ID = '00000000-0000-0000-0000-0000000000aa';

  it('stores the new entry, then updates the target with valid_to/superseded/superseded_by', async () => {
    mockQdrant.getById.mockResolvedValue({
      id: TARGET_ID,
      payload: {
        id: TARGET_ID,
        bank: 'kb',
        kind: 'semantic',
        schema_version: '2',
        superseded: false,
      },
    });

    await handleWrite(
      { ...BASE_FLAGS, kind: 'semantic', manual: true, supersedes: TARGET_ID, json: true },
      deps(),
    );

    const result = jsonResult();
    // The envelope's `superseded` is the *target's* id (what this write
    // superseded), not the new entry's own id (AC11, SC-13/CT-4).
    expect(result['superseded']).toBe(TARGET_ID);
    expect(mockQdrant.setPayload).toHaveBeenCalledWith(
      TARGET_ID,
      expect.objectContaining({ superseded: true, superseded_by: result['id'] }),
    );

    const getByIdOrder = mockQdrant.getById.mock.invocationCallOrder[0]!;
    const upsertOrder = mockQdrant.upsert.mock.invocationCallOrder[0]!;
    const setPayloadOrder = mockQdrant.setPayload.mock.invocationCallOrder[0]!;
    expect(getByIdOrder).toBeLessThan(upsertOrder);
    expect(upsertOrder).toBeLessThan(setPayloadOrder);
  });

  it('rejects a target in a different bank/kind with VALIDATION_FAILED before any write', async () => {
    mockQdrant.getById.mockResolvedValue({
      id: TARGET_ID,
      payload: { id: TARGET_ID, bank: 'other-bank', kind: 'semantic', superseded: false },
    });

    await expect(
      handleWrite({ ...BASE_FLAGS, kind: 'semantic', manual: true, supersedes: TARGET_ID }, deps()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mockQdrant.upsert).not.toHaveBeenCalled();
    expect(mockQdrant.setPayload).not.toHaveBeenCalled();
  });

  it('rejects an already-superseded target with a message naming the superseder', async () => {
    mockQdrant.getById.mockResolvedValue({
      id: TARGET_ID,
      payload: {
        id: TARGET_ID,
        bank: 'kb',
        kind: 'semantic',
        superseded: true,
        superseded_by: 'some-other-id',
      },
    });

    await expect(
      handleWrite({ ...BASE_FLAGS, kind: 'semantic', manual: true, supersedes: TARGET_ID }, deps()),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('some-other-id'),
    });
    expect(mockQdrant.upsert).not.toHaveBeenCalled();
  });

  it('a missing target fails ENTRY_NOT_FOUND', async () => {
    mockQdrant.getById.mockResolvedValue(null);

    await expect(
      handleWrite({ ...BASE_FLAGS, kind: 'semantic', manual: true, supersedes: TARGET_ID }, deps()),
    ).rejects.toMatchObject({ code: 'ENTRY_NOT_FOUND', exitCode: 1 });
    expect(mockQdrant.upsert).not.toHaveBeenCalled();
  });

  it('rejects a self-reference --supersedes before any I/O (EC-6, F-3)', async () => {
    const FIXED_ID = '00000000-0000-0000-0000-0000000000ff';
    jest.doMock('node:crypto', () => ({
      ...jest.requireActual('node:crypto'),
      randomUUID: () => FIXED_ID,
    }));
    jest.resetModules();
    const { handleWrite: freshHandleWrite } = await import('../../../src/commands/write.js');

    await expect(
      freshHandleWrite(
        { ...BASE_FLAGS, kind: 'semantic', manual: true, supersedes: FIXED_ID },
        deps(),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mockQdrant.getById).not.toHaveBeenCalled();
    jest.dontMock('node:crypto');
    jest.resetModules();
  });

  it('AC8: target update failure after upsert exits 2 with QDRANT_OPERATION_FAILED naming both ids', async () => {
    mockQdrant.getById.mockResolvedValue({
      id: TARGET_ID,
      payload: { id: TARGET_ID, bank: 'kb', kind: 'semantic', superseded: false },
    });
    mockQdrant.setPayload.mockRejectedValue(new Error('boom'));

    let caught: MemoError | undefined;
    try {
      await handleWrite(
        { ...BASE_FLAGS, kind: 'semantic', manual: true, supersedes: TARGET_ID },
        deps(),
      );
    } catch (err) {
      caught = err as MemoError;
    }

    expect(caught).toBeInstanceOf(MemoError);
    expect(caught?.code).toBe('QDRANT_OPERATION_FAILED');
    expect(caught?.exitCode).toBe(2);
    expect(mockQdrant.upsert).toHaveBeenCalledTimes(1);
    const newId = (mockQdrant.upsert.mock.calls[0]?.[0] as string) ?? '';
    expect(caught?.message).toContain(newId);
    expect(caught?.message).toContain(TARGET_ID);
  });
});

describe('handleWrite — AC9: self soft-cap warning', () => {
  it('warns at exactly soft_cap and is silent one below it; never blocks', async () => {
    process.env['MEMO_BANK'] = 'jarvis-memory';
    mockQdrant.count.mockResolvedValueOnce(DEFAULT_PRIVATE_SELF_SOFT_CAP);

    await handleWrite({ rationale: 'x', tags: 'a,b', kind: 'self' }, noCfgDeps());
    expect(stderrData).toContain(
      `self entries in jarvis-memory: ${String(DEFAULT_PRIVATE_SELF_SOFT_CAP)} (soft cap ${String(
        DEFAULT_PRIVATE_SELF_SOFT_CAP,
      )})`,
    );

    stderrData = '';
    mockQdrant = createMockQdrant();
    mockQdrant.count.mockResolvedValueOnce(DEFAULT_PRIVATE_SELF_SOFT_CAP - 1);
    await handleWrite({ rationale: 'x', tags: 'a,b', kind: 'self' }, noCfgDeps());
    expect(stderrData).toBe('');
  });

  it('JSON mode carries the warning in warnings[] and still succeeds', async () => {
    process.env['MEMO_BANK'] = 'jarvis-memory';
    mockQdrant.count.mockResolvedValueOnce(DEFAULT_PRIVATE_SELF_SOFT_CAP + 5);

    await handleWrite({ rationale: 'x', tags: 'a,b', kind: 'self', json: true }, noCfgDeps());
    const result = jsonResult();
    expect(result['warnings']).toEqual([
      `self entries in jarvis-memory: ${String(DEFAULT_PRIVATE_SELF_SOFT_CAP + 5)} (soft cap ${String(
        DEFAULT_PRIVATE_SELF_SOFT_CAP,
      )})`,
    ]);
    expect(result['created']).toBe(true);
  });
});

describe('handleWrite — AC10: dedupe v2, v1 fallback, self never dedupes', () => {
  it('cross-bank writes never collide even with identical content', async () => {
    mockQdrant.getByDedupeKey.mockResolvedValue(null);
    await handleWrite({ ...BASE_FLAGS, manual: true, json: true }, deps());
    expect(jsonResult()['duplicate_detected']).toBe(false);
  });

  it('a kb semantic write also checks the v1 dedupe key', async () => {
    mockQdrant.getByDedupeKey.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000001',
      payload: {
        id: '00000000-0000-0000-0000-000000000001',
        rationale: 'old',
        tags: ['a', 'b'],
        confidence: 'high',
        timestamp_utc: '2025-01-01T00:00:00.000Z',
      },
    });

    await handleWrite(
      { ...BASE_FLAGS, kind: 'semantic', manual: true, onDuplicate: 'update', json: true },
      deps(),
    );

    expect(mockQdrant.getByDedupeKey).toHaveBeenCalledTimes(2);
    expect(jsonResult()['duplicate_detected']).toBe(true);
  });

  it('does not check the v1 key for episodic or private-bank semantic writes', async () => {
    process.env['MEMO_BANK'] = 'jarvis-memory';
    mockQdrant.getByDedupeKey.mockResolvedValue(null);
    await handleWrite(
      { rationale: 'x', tags: 'a,b', kind: 'episodic', session: 's-1' },
      noCfgDeps(),
    );
    expect(mockQdrant.getByDedupeKey).toHaveBeenCalledTimes(1);

    mockQdrant = createMockQdrant();
    await handleWrite({ rationale: 'x', tags: 'a,b', kind: 'semantic', manual: true }, noCfgDeps());
    expect(mockQdrant.getByDedupeKey).toHaveBeenCalledTimes(1);
  });

  it('self writes never call getByDedupeKey', async () => {
    process.env['MEMO_BANK'] = 'jarvis-memory';
    await handleWrite({ rationale: 'x', tags: 'a,b', kind: 'self' }, noCfgDeps());
    expect(mockQdrant.getByDedupeKey).not.toHaveBeenCalled();
  });
});

describe('handleWrite — AC11: JSON envelope shape', () => {
  it('carries full v2 payload plus created/updated/duplicate_detected, optional keys omitted when N/A', async () => {
    await handleWrite({ ...BASE_FLAGS, manual: true, json: true }, deps());
    const result = jsonResult();
    expect(result['created']).toBe(true);
    expect(result['updated']).toBe(false);
    expect(result['duplicate_detected']).toBe(false);
    expect('superseded' in result).toBe(false);
    expect('warnings' in result).toBe(false);
    // Pre-existing v1 keys remain present.
    for (const key of [
      'id',
      'rationale',
      'tags',
      'entry_type',
      'source',
      'confidence',
      'timestamp_utc',
      'dedupe_key_sha256',
    ]) {
      expect(result[key]).toBeDefined();
    }
  });
});
