import type { QdrantFilter } from './qdrant.js';

export interface BuildSearchFiltersInput {
  repo: string;
  scope: 'repo' | 'related';
  relatedRepos?: string[];
  org?: string;
  tags?: string[];
  entryTypes?: string[];
  sources?: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function buildAnyMatch(key: string, values: string[]): { key: string; match: { any: string[] } } {
  return { key, match: { any: values } };
}

export function buildSearchFilters(input: BuildSearchFiltersInput): QdrantFilter {
  const must: Record<string, unknown>[] = [];
  const should: Record<string, unknown>[] = [];

  if (input.scope === 'related') {
    for (const repo of unique([input.repo, ...(input.relatedRepos ?? [])])) {
      should.push({ key: 'repo', match: { value: repo } });
    }
  } else {
    must.push({ key: 'repo', match: { value: input.repo } });
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

  return {
    ...(must.length > 0 ? { must } : {}),
    ...(should.length > 0 ? { should } : {}),
  };
}
