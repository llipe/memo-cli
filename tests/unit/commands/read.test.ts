import { handleRead } from '../../../src/commands/read.js';
import type { ReadDeps } from '../../../src/commands/read.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  getById: jest.fn(),
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
  mockQdrant.getById.mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function deps(): ReadDeps {
  return {
    createRepo: () => mockQdrant as unknown as ReturnType<NonNullable<ReadDeps['createRepo']>>,
  };
}

describe('handleRead', () => {
  it('throws VALIDATION_FAILED when --id is missing', async () => {
    await expect(handleRead({}, deps())).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Missing required --id value.',
    });
  });

  it('throws ENTRY_NOT_FOUND when id does not exist', async () => {
    await expect(handleRead({ id: 'missing-id' }, deps())).rejects.toMatchObject({
      code: 'ENTRY_NOT_FOUND',
      message: 'Entry not found: missing-id',
    });
  });

  it('renders human-readable entry output in stable order and omits empty fields', async () => {
    mockQdrant.getById.mockResolvedValueOnce({
      id: 'entry-123',
      payload: {
        repo: 'memo-cli',
        org: 'llipe',
        tags: ['read', 'entry'],
        rationale: 'Read one exact entry by id',
        timestamp_utc: '2026-07-09T12:00:00.000Z',
        files_modified: [],
        story: '',
      },
    });

    await handleRead({ id: 'entry-123' }, deps());

    expect(mockQdrant.ensureCollection).toHaveBeenCalled();
    expect(mockQdrant.getById).toHaveBeenCalledWith('entry-123');
    expect(stdoutData).toContain('id: entry-123');
    expect(stdoutData).toContain('repo: memo-cli');
    expect(stdoutData).toContain('org: llipe');
    expect(stdoutData).toContain('tags: read, entry');
    expect(stdoutData).toContain('rationale: Read one exact entry by id');
    expect(stdoutData).toContain('timestamp_utc: 2026-07-09T12:00:00.000Z');
    expect(stdoutData).not.toContain('files_modified:');
    expect(stdoutData).not.toContain('story:');
    expect(stdoutData.indexOf('id: entry-123')).toBeLessThan(stdoutData.indexOf('repo: memo-cli'));
  });

  it('returns flat payload JSON with id when --json is set', async () => {
    mockQdrant.getById.mockResolvedValueOnce({
      id: 'entry-999',
      payload: {
        repo: 'memo-cli',
        entry_type: 'decision',
        rationale: 'Machine-readable response',
      },
    });

    await handleRead({ id: 'entry-999', json: true }, deps());

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result).toEqual({
      id: 'entry-999',
      repo: 'memo-cli',
      entry_type: 'decision',
      rationale: 'Machine-readable response',
    });
  });
});
