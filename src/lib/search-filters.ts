import { mergeFilters } from './filters.js';
import type { QdrantFilter } from './qdrant.js';

export interface BuildSearchFiltersInput {
  repo: string;
  scope: 'repo' | 'related';
  relatedRepos?: string[];
  org?: string;
  tags?: string[];
  entryTypes?: string[];
  sources?: string[];
  /**
   * Bank this search targets (spec §18.5, AC5). Defaults to `'kb'` when
   * omitted, preserving Phase 1 behavior (the `repo` clause was always
   * added unconditionally before Phase 2 introduced private banks).
   */
  bank?: string;
  /** Set when the caller passed an explicit `--repo` flag (AC5). */
  explicitRepo?: boolean;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function buildAnyMatch(key: string, values: string[]): { key: string; match: { any: string[] } } {
  return { key, match: { any: values } };
}

export function buildSearchFilters(
  input: BuildSearchFiltersInput,
  base: QdrantFilter = {},
): QdrantFilter {
  const must: Record<string, unknown>[] = [];
  const should: Record<string, unknown>[] = [];

  const repoClauseAllowed = (input.bank ?? 'kb') === 'kb' || input.explicitRepo === true;

  if (repoClauseAllowed) {
    if (input.scope === 'related') {
      for (const repo of unique([input.repo, ...(input.relatedRepos ?? [])])) {
        should.push({ key: 'repo', match: { value: repo } });
      }
    } else {
      must.push({ key: 'repo', match: { value: input.repo } });
    }
  }

  if (input.org) {
    must.push({ key: 'org', match: { value: input.org } });
  }

  for (const tag of unique(input.tags ?? [])) {
    must.push({ key: 'tags', match: { value: tag } });
  }

  const entryTypes = unique(input.entryTypes ?? []);
  if (entryTypes.length === 1) {
    must.push({ key: 'entry_type', match: { value: entryTypes[0] } });
  } else if (entryTypes.length > 1) {
    must.push(buildAnyMatch('entry_type', entryTypes));
  }

  const sources = unique(input.sources ?? []);
  if (sources.length === 1) {
    must.push({ key: 'source', match: { value: sources[0] } });
  } else if (sources.length > 1) {
    must.push(buildAnyMatch('source', sources));
  }

  const builderFilter: QdrantFilter = {
    ...(must.length > 0 ? { must } : {}),
    ...(should.length > 0 ? { should } : {}),
  };

  return mergeFilters(base, builderFilter);
}
