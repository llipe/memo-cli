/**
 * Pure hit-rate computation and baseline report shaping for the relevance
 * evaluation harness (`scripts/eval-relevance.ts`).
 *
 * No I/O, no wall-clock reads except through the injected `now` parameter of
 * `buildBaselineArtifact` — everything here is a plain function over data so
 * it is unit-testable without a live Qdrant instance or embeddings provider,
 * and so `tests/relevance/replay.test.ts` can call it offline.
 */

export interface QueryResult {
  /** The query's category (`concept` | `identifier` | `cross-repo` | `recency`), not enforced here. */
  category: string;
  /** Ground-truth ids from `queries.json`. Duplicates and empty arrays are both valid input. */
  expectedIds: string[];
  /** The candidate ids ranked into positions 1-3 for this query (already sliced/ordered by the caller). */
  top3Ids: (string | number)[];
}

export interface HitRateReport {
  /** Overall top-3 hit rate across every evaluable query, in [0,1]. */
  overall_top3: number;
  /** Per-category top-3 hit rate, in [0,1]. */
  by_category: Record<string, number>;
}

export interface BaselineArtifact {
  recorded_at: string;
  overall_top3: number;
  by_category: Record<string, number>;
  ranking_config: Record<string, unknown>;
}

/**
 * Computes the overall and per-category top-3 hit rate.
 *
 * A query is "evaluable" only when it declares at least one expected id;
 * queries with an empty `expected_ids` array are excluded from both the
 * numerator and denominator (there is nothing to check a hit against), which
 * avoids a `0/0` division producing `NaN` (see the story's EC-3 edge case).
 * Duplicate ids within `expectedIds` are deduplicated via `Set` membership,
 * so a repeated id never counts as more than one hit.
 */
export function computeTop3HitRate(results: QueryResult[]): HitRateReport {
  const categoryTotals = new Map<string, { hits: number; evaluable: number }>();
  let overallHits = 0;
  let overallEvaluable = 0;

  for (const result of results) {
    const expected = new Set(result.expectedIds);
    if (expected.size === 0) continue;

    const top3 = new Set(result.top3Ids.map(String));
    const hit = [...expected].some((id) => top3.has(id)) ? 1 : 0;

    overallHits += hit;
    overallEvaluable += 1;

    const bucket = categoryTotals.get(result.category) ?? { hits: 0, evaluable: 0 };
    bucket.hits += hit;
    bucket.evaluable += 1;
    categoryTotals.set(result.category, bucket);
  }

  const by_category: Record<string, number> = {};
  for (const [category, { hits, evaluable }] of categoryTotals) {
    by_category[category] = evaluable === 0 ? 0 : hits / evaluable;
  }

  return {
    overall_top3: overallEvaluable === 0 ? 0 : overallHits / overallEvaluable,
    by_category,
  };
}

/**
 * Shapes a computed report into the documented `baseline.json` contract:
 * `{ recorded_at, overall_top3, by_category, ranking_config }`.
 *
 * `now` is injected (defaulting to the real clock) so the function stays
 * pure and testable, and so two back-to-back `--record` runs against
 * unchanged data can be asserted to differ only in `recorded_at` (EC-5).
 */
export function buildBaselineArtifact(
  report: HitRateReport,
  rankingConfig: Record<string, unknown>,
  now: () => string = () => new Date().toISOString(),
): BaselineArtifact {
  return {
    recorded_at: now(),
    overall_top3: report.overall_top3,
    by_category: report.by_category,
    ranking_config: rankingConfig,
  };
}
