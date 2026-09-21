import { MemoError } from '../../../src/lib/errors.js';
import { buildBaseFilter } from '../../../src/lib/filters.js';
import { buildListFilters, normalizeListDateRange } from '../../../src/lib/list-filters.js';

interface FilterShape {
  must?: Record<string, unknown>[];
  must_not?: Record<string, unknown>[];
  should?: Record<string, unknown>[];
}

function shape(filter: unknown): FilterShape {
  return filter as FilterShape;
}

describe('normalizeListDateRange', () => {
  it('normalizes bare dates to inclusive UTC day boundaries', () => {
    expect(normalizeListDateRange({ from: '2026-01-01', to: '2026-01-31' })).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T23:59:59.999Z',
    });
  });

  it('throws when from is later than to', () => {
    expect(() =>
      normalizeListDateRange({
        from: '2026-02-01T00:00:00.000Z',
        to: '2026-01-31T23:59:59.999Z',
      }),
    ).toThrow(MemoError);
  });
});

describe('buildListFilters', () => {
  it('builds repo-scoped filters with date range, entry type, and source clauses', () => {
    expect(
      buildListFilters({
        repo: 'memo-cli',
        scope: 'repo',
        org: 'llipe',
        entryTypes: ['decision', 'structure'],
        sources: ['agent'],
        from: '2026-01-01',
        to: '2026-01-31',
      }),
    ).toEqual({
      must: [
        { key: 'repo', match: { value: 'memo-cli' } },
        { key: 'org', match: { value: 'llipe' } },
        { key: 'entry_type', match: { any: ['decision', 'structure'] } },
        { key: 'source', match: { value: 'agent' } },
        {
          key: 'timestamp_utc',
          range: {
            gte: '2026-01-01T00:00:00.000Z',
            lte: '2026-01-31T23:59:59.999Z',
          },
        },
      ],
    });
  });

  it('builds related-scope filters using repo should clauses', () => {
    expect(
      buildListFilters({
        repo: 'memo-cli',
        scope: 'related',
        relatedRepos: ['platform-docs', 'agent-sdk'],
      }),
    ).toEqual({
      should: [
        { key: 'repo', match: { value: 'memo-cli' } },
        { key: 'repo', match: { value: 'platform-docs' } },
        { key: 'repo', match: { value: 'agent-sdk' } },
      ],
    });
  });
});

describe('buildListFilters — base merge semantics (AC5, CT-3/CT-4)', () => {
  it('CT-4: merges must/must_not/should by concatenation, base first, never nesting', () => {
    const base = shape(buildBaseFilter({ bank: 'kb', kind: 'all' }));
    const filter = shape(buildListFilters({ repo: 'memo-cli', scope: 'repo', bank: 'kb' }, base));

    expect(filter).toEqual({
      must: [...(base.must ?? []), { key: 'repo', match: { value: 'memo-cli' } }],
      must_not: base.must_not,
    });
    for (const clause of filter.must ?? []) {
      expect(Object.keys(clause)).not.toContain('must');
    }
  });

  it('EC-37: base present, builder produces no clauses of its own — merged result equals base verbatim', () => {
    const base = buildBaseFilter({ bank: 'kb', kind: 'semantic' });
    const filter = buildListFilters({ repo: '', scope: 'repo', bank: 'private-x' }, base);
    expect(filter).toEqual(base);
  });

  it('EC-36: an empty base object merges cleanly, no empty arrays left dangling', () => {
    const filter = buildListFilters({ repo: 'memo-cli', scope: 'repo' }, {});
    expect(filter).toEqual({ must: [{ key: 'repo', match: { value: 'memo-cli' } }] });
  });

  it('CT-3: retains its existing parameter list when called with only one argument (Phase 1 compatibility)', () => {
    const filter = buildListFilters({ repo: 'memo-cli', scope: 'repo' });
    expect(filter).toEqual({ must: [{ key: 'repo', match: { value: 'memo-cli' } }] });
  });
});

describe('buildListFilters — conditional repo clause (AC5, CT-5)', () => {
  it('EC-38: bank="kb" with no explicit --repo still adds the repo clause', () => {
    const filter = shape(buildListFilters({ repo: 'memo-cli', scope: 'repo', bank: 'kb' }));
    expect(filter.must).toContainEqual({ key: 'repo', match: { value: 'memo-cli' } });
  });

  it('EC-39: a private bank with no explicit --repo omits the repo clause entirely', () => {
    const filter = shape(
      buildListFilters({ repo: 'memo-cli', scope: 'repo', bank: 'jarvis-memory' }),
    );
    expect(filter.must ?? []).not.toContainEqual({ key: 'repo', match: { value: 'memo-cli' } });
  });

  it('EC-40: a private bank with an explicit --repo still adds the repo clause', () => {
    const filter = shape(
      buildListFilters({
        repo: 'memo-cli',
        scope: 'repo',
        bank: 'jarvis-memory',
        explicitRepo: true,
      }),
    );
    expect(filter.must).toContainEqual({ key: 'repo', match: { value: 'memo-cli' } });
  });

  it('EC-41: does not mutate the base object across two calls with the same base reference', () => {
    const base = shape(buildBaseFilter({ bank: 'kb', kind: 'all' }));
    const beforeMustLength = (base.must ?? []).length;
    buildListFilters({ repo: 'memo-cli', scope: 'repo', bank: 'kb' }, base);
    buildListFilters({ repo: 'other-repo', scope: 'repo', bank: 'kb' }, base);
    expect((base.must ?? []).length).toBe(beforeMustLength);
  });
});
