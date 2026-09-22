import { handleRead } from '../../../src/commands/read.js';
import type { ReadDeps } from '../../../src/commands/read.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  getById: jest.fn(),
  scroll: jest.fn().mockResolvedValue([]),
};

let stdoutData = '';

beforeEach(() => {
  stdoutData = '';
  jest.spyOn(process.stdout, 'write').mockImplementation((data: unknown) => {
    stdoutData += String(data);
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function deps(): ReadDeps {
  return {
    createRepo: () => mockQdrant as unknown as ReturnType<NonNullable<ReadDeps['createRepo']>>,
  };
}

describe('read integration', () => {
  it('reads one entry by id in human mode', async () => {
    mockQdrant.getById.mockResolvedValueOnce({
      id: 'entry-1',
      payload: {
        repo: 'memo-cli',
        org: 'llipe',
        entry_type: 'decision',
        source: 'agent',
        rationale: 'Use read command for direct lookup.',
      },
    });

    await handleRead({ id: 'entry-1' }, deps());

    expect(mockQdrant.ensureCollection).toHaveBeenCalled();
    expect(mockQdrant.getById).toHaveBeenCalledWith('entry-1');
    expect(stdoutData).toContain('id: entry-1');
    expect(stdoutData).toContain('repo: memo-cli');
    expect(stdoutData).toContain('entry_type: decision');
  });

  it('reads one entry by id in JSON mode', async () => {
    mockQdrant.getById.mockResolvedValueOnce({
      id: 'entry-2',
      payload: {
        repo: 'memo-cli',
        tags: ['read', 'json'],
        rationale: 'Return flat object in JSON mode.',
      },
    });

    await handleRead({ id: 'entry-2', json: true }, deps());

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result).toEqual({
      id: 'entry-2',
      repo: 'memo-cli',
      tags: ['read', 'json'],
      rationale: 'Return flat object in JSON mode.',
      bank: 'kb',
      kind: 'semantic',
      schema_version: '1',
      archived: false,
      superseded: false,
      consolidated: false,
      pinned: false,
      pending_contradiction: false,
    });
  });

  it('returns ENTRY_NOT_FOUND for unknown id', async () => {
    mockQdrant.getById.mockResolvedValueOnce(null);

    await expect(handleRead({ id: 'missing-id' }, deps())).rejects.toMatchObject({
      code: 'ENTRY_NOT_FOUND',
      message: 'Entry not found: missing-id',
    });
  });

  // S2-05 AC9 — story's explicit integration scenario: provenance naming a
  // deleted id.
  it('AC9: memo read --id on a semantic entry whose provenance names a deleted id', async () => {
    mockQdrant.getById.mockResolvedValueOnce({
      id: 'semantic-entry',
      payload: {
        repo: 'memo-cli',
        kind: 'semantic',
        rationale: 'A semantic entry with mixed provenance',
        provenance: ['live-episodic-1', 'deleted-episodic-2'],
      },
    });
    mockQdrant.scroll.mockResolvedValueOnce([{ id: 'live-episodic-1', payload: {} }]);

    await handleRead({ id: 'semantic-entry', json: true }, deps());

    const result = JSON.parse(stdoutData) as {
      provenance: { id: string; deleted: boolean }[];
    };
    expect(result.provenance).toEqual([
      { id: 'live-episodic-1', deleted: false },
      { id: 'deleted-episodic-2', deleted: true },
    ]);
    expect(mockQdrant.scroll).toHaveBeenCalledTimes(1);
  });
});
