import { MemoError } from './errors.js';
import type { QdrantFilter } from './qdrant.js';

export interface BuildListFiltersInput {
  repo: string;
  scope: 'repo' | 'related';
  relatedRepos?: string[];
  org?: string;
  entryTypes?: string[];
  sources?: string[];
  from?: string;
  to?: string;
}

interface MatchCondition {
  key: string;
  match: { value: string } | { any: string[] };
}

interface RangeCondition {
  key: string;
  range: { gte?: string; lte?: string };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function buildAnyMatch(key: string, values: string[]): MatchCondition {
  return { key, match: { any: values } };
}

function normalizeIsoBoundary(value: string, boundary: 'from' | 'to'): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new MemoError('VALIDATION_FAILED', `--${boundary} must not be empty.`);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return boundary === 'from' ? `${trimmed}T00:00:00.000Z` : `${trimmed}T23:59:59.999Z`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new MemoError(
      'VALIDATION_FAILED',
      `--${boundary} must be a valid ISO 8601 date string. Received "${value}".`,
    );
  }

  return parsed.toISOString();
}

export function normalizeListDateRange(input: { from?: string; to?: string }): {
  from?: string;
  to?: string;
} {
  const from = input.from ? normalizeIsoBoundary(input.from, 'from') : undefined;
  const to = input.to ? normalizeIsoBoundary(input.to, 'to') : undefined;

  if (from && to && from > to) {
    throw new MemoError('VALIDATION_FAILED', '--from must be earlier than or equal to --to.');
  }

  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

export function buildListFilters(input: BuildListFiltersInput): QdrantFilter {
  const must: (MatchCondition | RangeCondition)[] = [];
  const should: MatchCondition[] = [];

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

  const entryTypes = unique(input.entryTypes ?? []);
  const entryType = entryTypes[0];
  if (entryTypes.length === 1) {
    if (entryType) {
      must.push({ key: 'entry_type', match: { value: entryType } });
    }
  } else if (entryTypes.length > 1) {
    must.push(buildAnyMatch('entry_type', entryTypes));
  }

  const sources = unique(input.sources ?? []);
  const source = sources[0];
  if (sources.length === 1) {
    if (source) {
      must.push({ key: 'source', match: { value: source } });
    }
  } else if (sources.length > 1) {
    must.push(buildAnyMatch('source', sources));
  }

  const range = normalizeListDateRange({ from: input.from, to: input.to });
  if (range.from || range.to) {
    must.push({
      key: 'timestamp_utc',
      range: {
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lte: range.to } : {}),
      },
    });
  }

  return {
    ...(must.length > 0 ? { must } : {}),
    ...(should.length > 0 ? { should } : {}),
  };
}
