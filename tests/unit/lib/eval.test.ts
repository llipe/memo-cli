import { buildBaselineArtifact, computeTop3HitRate } from '../../../src/lib/eval';
import type { QueryResult } from '../../../src/lib/eval';

describe('computeTop3HitRate', () => {
  it('reports 1.0 overall and per-category when every query hits', () => {
    const results: QueryResult[] = [
      { category: 'concept', expectedIds: ['a'], top3Ids: ['a', 'b', 'c'] },
      { category: 'concept', expectedIds: ['x'], top3Ids: ['z', 'x', 'y'] },
    ];

    const report = computeTop3HitRate(results);

    expect(report.overall_top3).toBe(1);
    expect(report.by_category).toEqual({ concept: 1 });
  });

  it('reports 0 overall and per-category when no query hits', () => {
    const results: QueryResult[] = [
      { category: 'concept', expectedIds: ['a'], top3Ids: ['x', 'y', 'z'] },
      { category: 'identifier', expectedIds: ['b'], top3Ids: ['m', 'n', 'o'] },
    ];

    const report = computeTop3HitRate(results);

    expect(report.overall_top3).toBe(0);
    expect(report.by_category).toEqual({ concept: 0, identifier: 0 });
  });

  it('computes a partial hit rate across mixed hits and misses', () => {
    const results: QueryResult[] = [
      { category: 'concept', expectedIds: ['a'], top3Ids: ['a', 'b', 'c'] },
      { category: 'concept', expectedIds: ['x'], top3Ids: ['m', 'n', 'o'] },
      { category: 'identifier', expectedIds: ['p'], top3Ids: ['p', 'q', 'r'] },
      { category: 'identifier', expectedIds: ['s'], top3Ids: ['t', 'u', 'v'] },
    ];

    const report = computeTop3HitRate(results);

    expect(report.overall_top3).toBe(0.5);
    expect(report.by_category).toEqual({ concept: 0.5, identifier: 0.5 });
  });

  it('deduplicates duplicate expected ids without inflating the hit count', () => {
    const results: QueryResult[] = [
      { category: 'concept', expectedIds: ['a', 'a', 'a'], top3Ids: ['a', 'b', 'c'] },
    ];

    const report = computeTop3HitRate(results);

    expect(report.overall_top3).toBe(1);
  });

  it('treats a query with an empty expected_ids array as not evaluable (no divide-by-zero, no NaN)', () => {
    const results: QueryResult[] = [
      { category: 'concept', expectedIds: [], top3Ids: ['a', 'b', 'c'] },
      { category: 'concept', expectedIds: ['a'], top3Ids: ['a', 'b', 'c'] },
    ];

    const report = computeTop3HitRate(results);

    expect(report.overall_top3).toBe(1);
    expect(Number.isNaN(report.overall_top3)).toBe(false);
    expect(report.by_category['concept']).toBe(1);
  });

  it('omits a category entirely (no NaN, no phantom row) when every query in it is non-evaluable', () => {
    const results: QueryResult[] = [{ category: 'concept', expectedIds: [], top3Ids: ['a'] }];

    const report = computeTop3HitRate(results);

    expect(report.overall_top3).toBe(0);
    expect(report.by_category).toEqual({});
    expect(Number.isNaN(report.overall_top3)).toBe(false);
  });

  it('returns 0 for an entirely empty result set', () => {
    const report = computeTop3HitRate([]);

    expect(report.overall_top3).toBe(0);
    expect(report.by_category).toEqual({});
  });

  it('is bounded in [0,1] at both boundaries (EC-11)', () => {
    const allHit: QueryResult[] = Array.from({ length: 7 }, (_, i) => ({
      category: 'concept',
      expectedIds: [`e${String(i)}`],
      top3Ids: [`e${String(i)}`, 'x', 'y'],
    }));
    const perfectReport = computeTop3HitRate(allHit);
    expect(perfectReport.overall_top3).toBe(1);

    const noneHit: QueryResult[] = Array.from({ length: 7 }, (_, i) => ({
      category: 'concept',
      expectedIds: [`e${String(i)}`],
      top3Ids: ['x', 'y', 'z'],
    }));
    const zeroReport = computeTop3HitRate(noneHit);
    expect(zeroReport.overall_top3).toBe(0);
  });

  it('coerces top3Ids to string so numeric Qdrant ids still match string expected_ids', () => {
    const results: QueryResult[] = [{ category: 'concept', expectedIds: ['42'], top3Ids: [42] }];

    const report = computeTop3HitRate(results);

    expect(report.overall_top3).toBe(1);
  });
});

describe('buildBaselineArtifact', () => {
  it('shapes the report into the documented baseline.json contract', () => {
    const report = { overall_top3: 0.75, by_category: { concept: 0.8, identifier: 0.7 } };
    const rankingConfig = { w_similarity: 1 };

    const artifact = buildBaselineArtifact(report, rankingConfig, () => '2026-01-01T00:00:00.000Z');

    expect(artifact).toEqual({
      recorded_at: '2026-01-01T00:00:00.000Z',
      overall_top3: 0.75,
      by_category: { concept: 0.8, identifier: 0.7 },
      ranking_config: { w_similarity: 1 },
    });
  });

  it('uses a fresh recorded_at on each call while the hit-rate fields stay stable (EC-5)', () => {
    const report = { overall_top3: 0.5, by_category: {} };
    const first = buildBaselineArtifact(report, {}, () => '2026-01-01T00:00:00.000Z');
    const second = buildBaselineArtifact(report, {}, () => '2026-01-01T00:00:05.000Z');

    expect(first.recorded_at).not.toBe(second.recorded_at);
    expect(first.overall_top3).toBe(second.overall_top3);
    expect(first.by_category).toEqual(second.by_category);
  });
});
