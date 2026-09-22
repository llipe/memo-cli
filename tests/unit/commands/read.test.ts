import { handleRead } from '../../../src/commands/read.js';
import type { ReadDeps } from '../../../src/commands/read.js';

const mockQdrant = {
  ensureCollection: jest.fn().mockResolvedValue(undefined),
  getById: jest.fn(),
  scroll: jest.fn(),
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
  mockQdrant.scroll.mockResolvedValue([]);
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
    // S2-05 AC9/EC-10: normalizeEntry's v1-fallback defaults are always
    // present (bank/kind/schema_version/archived/superseded/consolidated/
    // pinned/pending_contradiction); `valid_from` is absent here because
    // both it and `timestamp_utc` are absent from the source payload.
    expect(result).toEqual({
      id: 'entry-999',
      repo: 'memo-cli',
      entry_type: 'decision',
      rationale: 'Machine-readable response',
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

  // #35 AC4: the write-path `confidence` field stays on `memo read` output
  // (only `memo search` drops it).
  it('still includes the stored confidence field in human output (#35 AC4)', async () => {
    mockQdrant.getById.mockResolvedValueOnce({
      id: 'entry-321',
      payload: {
        repo: 'memo-cli',
        rationale: 'Confidence stays on read',
        confidence: 'high',
      },
    });

    await handleRead({ id: 'entry-321' }, deps());

    expect(stdoutData).toContain('confidence: high');
  });

  it('still includes the stored confidence field in --json output (#35 AC4)', async () => {
    mockQdrant.getById.mockResolvedValueOnce({
      id: 'entry-322',
      payload: {
        repo: 'memo-cli',
        rationale: 'Confidence stays on read',
        confidence: 'medium',
      },
    });

    await handleRead({ id: 'entry-322', json: true }, deps());

    const result = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(result['confidence']).toBe('medium');
  });

  describe('S2-05: read-side flags and v2 fields (spec §18.7)', () => {
    it('AC1/EC-12: --bank is rejected — an id is explicit, disambiguation flags do not apply', async () => {
      await expect(handleRead({ id: 'entry-1', bank: 'a-memory' }, deps())).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('AC1/EC-12: --kind is rejected', async () => {
      await expect(handleRead({ id: 'entry-1', kind: 'episodic' }, deps())).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('AC1/EC-12: --session is rejected', async () => {
      await expect(handleRead({ id: 'entry-1', session: 's-1' }, deps())).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('AC1/EC-12: --as-of is rejected', async () => {
      await expect(handleRead({ id: 'entry-1', asOf: '2026-01-01' }, deps())).rejects.toMatchObject(
        { code: 'VALIDATION_FAILED' },
      );
    });

    it('AC1: --include-archived and --include-superseded are accepted (the one pair `read` allows)', async () => {
      mockQdrant.getById.mockResolvedValueOnce({
        id: 'entry-1',
        payload: { repo: 'memo-cli', rationale: 'ok', archived: true },
      });

      await expect(
        handleRead({ id: 'entry-1', includeArchived: true }, deps()),
      ).resolves.toBeUndefined();
    });

    it('AC9: prints v2 fields present on the entry (human mode)', async () => {
      mockQdrant.getById.mockResolvedValueOnce({
        id: 'entry-v2',
        payload: {
          repo: 'memo-cli',
          rationale: 'A v2 entry',
          bank: 'jarvis-memory',
          kind: 'episodic',
          session_id: 'ISSUE-84',
          seq: 3,
          archived: true,
        },
      });

      await handleRead({ id: 'entry-v2' }, deps());
      expect(stdoutData).toContain('bank: jarvis-memory');
      expect(stdoutData).toContain('kind: episodic');
      expect(stdoutData).toContain('session_id: ISSUE-84');
      expect(stdoutData).toContain('seq: 3');
      expect(stdoutData).toContain('archived: true');
    });

    describe('provenance (AC9)', () => {
      it('issues exactly one scroll({ has_id }) call, sized to the provenance array', async () => {
        mockQdrant.getById.mockResolvedValueOnce({
          id: 'entry-prov',
          payload: {
            repo: 'memo-cli',
            rationale: 'Has provenance',
            provenance: ['prov-1', 'prov-2'],
          },
        });
        mockQdrant.scroll.mockResolvedValue([{ id: 'prov-1', payload: {} }]);

        await handleRead({ id: 'entry-prov', json: true }, deps());

        expect(mockQdrant.scroll).toHaveBeenCalledTimes(1);
        expect(mockQdrant.scroll).toHaveBeenCalledWith(
          { must: [{ has_id: ['prov-1', 'prov-2'] }] },
          2,
        );
      });

      it('JSON gives provenance: [{ id, deleted }], suffixing a missing id (deleted)', async () => {
        mockQdrant.getById.mockResolvedValueOnce({
          id: 'entry-prov',
          payload: {
            repo: 'memo-cli',
            rationale: 'Has provenance',
            provenance: ['prov-1', 'prov-2'],
          },
        });
        mockQdrant.scroll.mockResolvedValue([{ id: 'prov-1', payload: {} }]);

        await handleRead({ id: 'entry-prov', json: true }, deps());
        const result = JSON.parse(stdoutData) as {
          provenance: { id: string; deleted: boolean }[];
        };
        expect(result.provenance).toEqual([
          { id: 'prov-1', deleted: false },
          { id: 'prov-2', deleted: true },
        ]);
      });

      it('human mode suffixes a missing provenance id with (deleted)', async () => {
        mockQdrant.getById.mockResolvedValueOnce({
          id: 'entry-prov',
          payload: {
            repo: 'memo-cli',
            rationale: 'Has provenance',
            provenance: ['prov-1', 'prov-2'],
          },
        });
        mockQdrant.scroll.mockResolvedValue([{ id: 'prov-1', payload: {} }]);

        await handleRead({ id: 'entry-prov' }, deps());
        expect(stdoutData).toContain('prov-2 (deleted)');
        expect(stdoutData).not.toContain('prov-1 (deleted)');
      });

      it('never calls scroll when the entry has no provenance field', async () => {
        mockQdrant.getById.mockResolvedValueOnce({
          id: 'entry-no-prov',
          payload: { repo: 'memo-cli', rationale: 'No provenance' },
        });
        mockQdrant.scroll.mockClear();

        await handleRead({ id: 'entry-no-prov', json: true }, deps());
        expect(mockQdrant.scroll).not.toHaveBeenCalled();
      });

      it('EC-14: a large provenance array (200 ids) still issues exactly one scroll call, capped at its own length', async () => {
        const provenance = Array.from({ length: 200 }, (_, i) => `prov-${String(i)}`);
        mockQdrant.getById.mockResolvedValueOnce({
          id: 'entry-big-prov',
          payload: { repo: 'memo-cli', rationale: 'Big provenance', provenance },
        });
        mockQdrant.scroll.mockResolvedValue([]);

        await handleRead({ id: 'entry-big-prov', json: true }, deps());

        expect(mockQdrant.scroll).toHaveBeenCalledTimes(1);
        expect(mockQdrant.scroll).toHaveBeenCalledWith({ must: [{ has_id: provenance }] }, 200);
      });
    });

    it('EC-10: a v1 point (no schema_version/bank/v2 fields) normalizes without crashing', async () => {
      mockQdrant.getById.mockResolvedValueOnce({
        id: 'v1-entry',
        payload: {
          repo: 'memo-cli',
          rationale: 'A v1 point',
          timestamp_utc: '2025-01-01T00:00:00.000Z',
        },
      });

      await expect(handleRead({ id: 'v1-entry', json: true }, deps())).resolves.toBeUndefined();
      const result = JSON.parse(stdoutData) as Record<string, unknown>;
      expect(result).toMatchObject({ bank: 'kb', kind: 'semantic', schema_version: '1' });
    });
  });
});
