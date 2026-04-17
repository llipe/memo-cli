import { handleDelete } from '../../../src/commands/delete.js';
import type { DeleteDeps } from '../../../src/commands/delete.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  scroll: jest.fn(),
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

function deps(confirmResult = true): DeleteDeps {
  return {
    createRepo: () => mockQdrant as unknown as ReturnType<NonNullable<DeleteDeps['createRepo']>>,
    confirm: jest.fn().mockResolvedValue(confirmResult),
  };
}

describe('delete integration', () => {
  it('single delete by id completes end-to-end', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      {
        id: 'entry-1',
        payload: { repo: 'memo-cli', org: 'llipe', rationale: 'Remove stale decision' },
      },
    ]);

    await handleDelete({ id: 'entry-1', yes: true }, deps());

    expect(mockQdrant.ensureCollection).toHaveBeenCalled();
    expect(mockQdrant.deleteById).toHaveBeenCalledWith('entry-1');
    expect(stdoutData).toContain('Deleted 1 entry (id: entry-1)');
  });

  it('bulk delete by repo completes end-to-end', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { repo: 'memo-cli' } },
      { id: '2', payload: { repo: 'memo-cli' } },
    ]);
    mockQdrant.deleteByFilter.mockResolvedValueOnce(2);

    await handleDelete({ allByRepo: 'memo-cli', yes: true }, deps());

    expect(mockQdrant.deleteByFilter).toHaveBeenCalledWith({
      must: [{ key: 'repo', match: { value: 'memo-cli' } }],
    });
    expect(stdoutData).toContain('Deleted 2 entries (repo: memo-cli)');
  });

  it('bulk delete by org completes end-to-end', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([
      { id: '1', payload: { org: 'llipe' } },
      { id: '2', payload: { org: 'llipe' } },
      { id: '3', payload: { org: 'llipe' } },
    ]);
    mockQdrant.deleteByFilter.mockResolvedValueOnce(3);

    await handleDelete({ allByOrg: 'llipe', yes: true }, deps());

    expect(mockQdrant.deleteByFilter).toHaveBeenCalledWith({
      must: [{ key: 'org', match: { value: 'llipe' } }],
    });
    expect(stdoutData).toContain('Deleted 3 entries (org: llipe)');
  });

  it('rejects bulk delete in agent mode', async () => {
    await expect(handleDelete({ allByRepo: 'memo-cli', json: true }, deps())).rejects.toEqual(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        message: 'Bulk delete is not supported in agent mode (--json)',
      }),
    );
  });

  it('handles non-existent id with ENTRY_NOT_FOUND', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await expect(handleDelete({ id: 'missing-id' }, deps())).rejects.toEqual(
      expect.objectContaining({
        code: 'ENTRY_NOT_FOUND',
        message: 'Entry not found: missing-id',
      }),
    );
  });

  it('handles empty match set for bulk safely', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([]);

    await handleDelete({ allByOrg: 'ghost-org' }, deps());

    expect(stdoutData).toContain('No entries found for org ghost-org');
    expect(mockQdrant.deleteByFilter).not.toHaveBeenCalled();
  });

  it('--yes bypasses prompt for interactive flows', async () => {
    mockQdrant.scroll.mockResolvedValueOnce([{ id: '1', payload: { repo: 'memo-cli' } }]);
    mockQdrant.deleteByFilter.mockResolvedValueOnce(1);
    const d = deps(false);

    await handleDelete({ allByRepo: 'memo-cli', yes: true }, d);

    expect(d.confirm).not.toHaveBeenCalled();
    expect(mockQdrant.deleteByFilter).toHaveBeenCalled();
  });
});
