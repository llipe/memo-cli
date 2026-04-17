import type { QdrantFilter, ScrollResult } from './qdrant.js';

export interface FacetEntry {
  name: string;
  count: number;
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
