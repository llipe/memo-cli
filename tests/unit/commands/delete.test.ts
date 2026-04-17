import { handleDelete } from '../../../src/commands/delete.js';
import type { DeleteDeps } from '../../../src/commands/delete.js';
import { MemoError } from '../../../src/lib/errors.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  scroll: jest.fn().mockResolvedValue([]),
  deleteById: jest.fn().mockResolvedValue(undefined),
  deleteByFilter: jest.fn().mockResolvedValue(0),
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
  mockQdrant.scroll.mockResolvedValue([]);
  mockQdrant.deleteById.mockResolvedValue(undefined);
  mockQdrant.deleteByFilter.mockResolvedValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeDeps(confirmResult = true): DeleteDeps {
  return {
    createRepo: () => mockQdrant as unknown as ReturnType<NonNullable<DeleteDeps['createRepo']>>,
    confirm: jest.fn().mockResolvedValue(confirmResult),
  };
}

describe('handleDelete', () => {
  it('rejects mixing --id with bulk flags', async () => {
    await expect(
      handleDelete({ id: 'abc', allByRepo: 'memo-cli' }, makeDeps()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects combining --all-by-repo and --all-by-org', async () => {
    await expect(
      handleDelete({ allByRepo: 'memo-cli', allByOrg: 'llipe' }, makeDeps()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects bulk mode with --json', async () => {
    await expect(handleDelete({ allByRepo: 'memo-cli', json: true }, makeDeps())).rejects.toEqual(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        message: 'Bulk delete is not supported in agent mode (--json)',
      }),
    );
  });

  it('single delete accepted confirmation calls deleteById', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([{ id: 'entry-1', payload: { repo: 'memo-cli' } }]);
    const deps = makeDeps(true);

    await handleDelete({ id: 'entry-1' }, deps);

    expect(deps.confirm).toHaveBeenCalledWith('Are you sure? (y/N)');
    expect(mockQdrant.deleteById).toHaveBeenCalledWith('entry-1');
    expect(stdoutData).toContain('Deleted 1 entry (id: entry-1)');
  });

  it('single delete declined confirmation cancels and does not delete', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([{ id: 'entry-1', payload: {} }]);
    const deps = makeDeps(false);

    await handleDelete({ id: 'entry-1' }, deps);

    expect(mockQdrant.deleteById).not.toHaveBeenCalled();
    expect(stdoutData).toContain('Deletion cancelled.');
  });

  it('--yes bypasses confirmation for single delete', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([{ id: 'entry-1', payload: {} }]);
    const deps = makeDeps(false);

    await handleDelete({ id: 'entry-1', yes: true }, deps);

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(mockQdrant.deleteById).toHaveBeenCalledWith('entry-1');
  });

  it('--id --json skips prompt and returns machine-readable payload', async () => {
    const deps = makeDeps(true);

    await handleDelete({ id: 'entry-1', json: true }, deps);

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(mockQdrant.deleteById).toHaveBeenCalledWith('entry-1');
    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result).toEqual({ deleted: true, id: 'entry-1', scope: 'single', count: 1 });
  });

  it('bulk delete accepted confirmation calls deleteByFilter', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { repo: 'memo-cli' } },
      { id: '2', payload: { repo: 'memo-cli' } },
    ]);
    mockQdrant.deleteByFilter.mockResolvedValueOnce(2);
    const deps = makeDeps(true);

    await handleDelete({ allByRepo: 'memo-cli' }, deps);

    expect(deps.confirm).toHaveBeenCalled();
    expect(mockQdrant.deleteByFilter).toHaveBeenCalledWith({
      must: [{ key: 'repo', match: { value: 'memo-cli' } }],
    });
    expect(stdoutData).toContain('Deleted 2 entries (repo: memo-cli)');
  });

  it('bulk delete declined confirmation cancels without deleting', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([{ id: '1', payload: { org: 'llipe' } }]);
    const deps = makeDeps(false);

    await handleDelete({ allByOrg: 'llipe' }, deps);

    expect(mockQdrant.deleteByFilter).not.toHaveBeenCalled();
    expect(stdoutData).toContain('Deletion cancelled.');
  });

  it('bulk delete with --yes bypasses confirmation', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([{ id: '1', payload: { org: 'llipe' } }]);
    mockQdrant.deleteByFilter.mockResolvedValueOnce(1);
    const deps = makeDeps(false);

    await handleDelete({ allByOrg: 'llipe', yes: true }, deps);

    expect(deps.confirm).not.toHaveBeenCalled();
    expect(mockQdrant.deleteByFilter).toHaveBeenCalled();
  });

  it('returns empty-match message with exit-0 behavior for bulk', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await handleDelete({ allByRepo: 'missing-repo' }, makeDeps());

    expect(mockQdrant.deleteByFilter).not.toHaveBeenCalled();
    expect(stdoutData).toContain('No entries found for repo missing-repo');
  });

  it('propagates ENTRY_NOT_FOUND for missing single id', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await expect(handleDelete({ id: 'missing-id' }, makeDeps())).rejects.toEqual(
      expect.objectContaining({
        code: 'ENTRY_NOT_FOUND',
        message: 'Entry not found: missing-id',
      }),
    );
  });

  it('propagates ENTRY_NOT_FOUND from repository deleteById', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([{ id: 'entry-1', payload: {} }]);
    mockQdrant.deleteById.mockRejectedValueOnce(
      new MemoError('ENTRY_NOT_FOUND', 'Entry not found: entry-1'),
    );

    await expect(handleDelete({ id: 'entry-1' }, makeDeps())).rejects.toMatchObject({
      code: 'ENTRY_NOT_FOUND',
    });
  });
});
