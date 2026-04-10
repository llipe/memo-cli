import { buildSearchFilters } from '../../../src/lib/search-filters.js';

describe('buildSearchFilters', () => {
  it('builds repo-scoped filters with multi-tag AND semantics', () => {
    const filter = buildSearchFilters({
      repo: 'memo-cli',
      scope: 'repo',
      tags: ['qdrant', 'search'],
    });

    expect(filter).toEqual({
      must: [
        { key: 'repo', match: { value: 'memo-cli' } },
        { key: 'tags', match: { value: 'qdrant' } },
        { key: 'tags', match: { value: 'search' } },
      ],
    });
  });

  it('builds related scope filters with should repo clauses', () => {
    const filter = buildSearchFilters({
      repo: 'memo-cli',
      scope: 'related',
      relatedRepos: ['platform-docs', 'agent-sdk'],
    });

    expect(filter).toEqual({
      should: [
        { key: 'repo', match: { value: 'memo-cli' } },
        { key: 'repo', match: { value: 'platform-docs' } },
        { key: 'repo', match: { value: 'agent-sdk' } },
      ],
    });
  });

  it('uses match-any for multi-value entry_type and source filters', () => {
    const filter = buildSearchFilters({
      repo: 'memo-cli',
      scope: 'repo',
      entryTypes: ['decision', 'structure'],
      sources: ['agent', 'manual'],
    });

    expect(filter).toEqual({
      must: [
        { key: 'repo', match: { value: 'memo-cli' } },
        { key: 'entry_type', match: { any: ['decision', 'structure'] } },
        { key: 'source', match: { any: ['agent', 'manual'] } },
      ],
    });
  });

  it('includes org when provided', () => {
    const filter = buildSearchFilters({
      repo: 'memo-cli',
      scope: 'repo',
      org: 'llipe',
      entryTypes: ['decision'],
      sources: ['agent'],
    });

    expect(filter).toEqual({
      must: [
        { key: 'repo', match: { value: 'memo-cli' } },
        { key: 'org', match: { value: 'llipe' } },
        { key: 'entry_type', match: { value: 'decision' } },
        { key: 'source', match: { value: 'agent' } },
      ],
    });
  });
});
