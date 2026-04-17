import type { QdrantFilter, ScrollResult } from './qdrant.js';

export interface FacetEntry {
  name: string;
  count: number;
}

export interface RepoFacetEntry {
  name: string;
  org?: string;
  domain?: string;
  count: number;
}

export interface MultiFacetResult {
  orgs: FacetEntry[];
  repos: RepoFacetEntry[];
  domains: FacetEntry[];
}

export type FacetScrollFn = (filter?: QdrantFilter, limit?: number) => Promise<ScrollResult[]>;

const FACET_SCROLL_LIMIT = 10_000;

/**
 * Scrolls all entries matching the optional filter and aggregates unique values
 * for the given payload field with their occurrence counts.
 *
 * Array fields (e.g. tags) have each element counted individually.
 * Null, undefined, and empty-string values are skipped.
 */
export async function aggregateField(
  field: string,
  scroll: FacetScrollFn,
  filter?: QdrantFilter,
): Promise<FacetEntry[]> {
  const results = await scroll(filter, FACET_SCROLL_LIMIT);
  const counts = new Map<string, number>();

  for (const result of results) {
    const value = result.payload?.[field];
    if (value === null || value === undefined) continue;

    const values: string[] = Array.isArray(value)
      ? (value as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
      : typeof value === 'string' && value.length > 0
        ? [value]
        : [];

    for (const v of values) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
}

/**
 * Scrolls all entries in a single pass and simultaneously aggregates counts for
 * the `org`, `repo`, and `domain` payload fields.
 *
 * For repos, the first observed `org` and `domain` values are captured to enrich
 * the output without requiring additional scroll passes.
 */
export async function aggregateMultipleFields(scroll: FacetScrollFn): Promise<MultiFacetResult> {
  const results = await scroll(undefined, FACET_SCROLL_LIMIT);

  const orgCounts = new Map<string, number>();
  const repoCounts = new Map<string, number>();
  const repoMeta = new Map<string, { org?: string; domain?: string }>();
  const domainCounts = new Map<string, number>();

  for (const result of results) {
    const p = result.payload;
    if (!p) continue;

    const orgVal = typeof p['org'] === 'string' && p['org'].length > 0 ? p['org'] : undefined;
    const repoVal = typeof p['repo'] === 'string' && p['repo'].length > 0 ? p['repo'] : undefined;
    const domainVal =
      typeof p['domain'] === 'string' && p['domain'].length > 0 ? p['domain'] : undefined;

    if (orgVal) {
      orgCounts.set(orgVal, (orgCounts.get(orgVal) ?? 0) + 1);
    }

    if (repoVal) {
      repoCounts.set(repoVal, (repoCounts.get(repoVal) ?? 0) + 1);
      if (!repoMeta.has(repoVal)) {
        repoMeta.set(repoVal, { org: orgVal, domain: domainVal });
      }
    }

    if (domainVal) {
      domainCounts.set(domainVal, (domainCounts.get(domainVal) ?? 0) + 1);
    }
  }

  const orgs: FacetEntry[] = Array.from(orgCounts.entries()).map(([name, count]) => ({
    name,
    count,
  }));

  const repos: RepoFacetEntry[] = Array.from(repoCounts.entries()).map(([name, count]) => {
    const meta = repoMeta.get(name);
    const entry: RepoFacetEntry = { name, count };
    if (meta?.org) entry.org = meta.org;
    if (meta?.domain) entry.domain = meta.domain;
    return entry;
  });

  const domains: FacetEntry[] = Array.from(domainCounts.entries()).map(([name, count]) => ({
    name,
    count,
  }));

  return { orgs, repos, domains };
}
