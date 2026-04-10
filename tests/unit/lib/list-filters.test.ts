import { MemoError } from '../../../src/lib/errors.js';
import { buildListFilters, normalizeListDateRange } from '../../../src/lib/list-filters.js';

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
