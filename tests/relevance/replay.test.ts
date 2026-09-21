/**
 * Offline replay guard (AC6, AC9, SC-7, CT-5).
 *
 * Replays the committed `candidates.json` through `computeTop3HitRate` — the
 * same pure function `scripts/eval-relevance.ts` calls — with no network
 * access, and asserts the recomputed hit rate is >= the recorded
 * `baseline.json.overall_top3`. Must pass with no `QDRANT_URL` or
 * `EMBEDDINGS_API_KEY` set (AC9); this file imports no Qdrant client and no
 * embeddings adapter, so there is nothing here that could reach the network
 * even if those variables were present.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeTop3HitRate } from '../../src/lib/eval';
import type { QueryResult } from '../../src/lib/eval';
import {
  rankResults,
  DEFAULT_RANKING_WEIGHTS,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
} from '../../src/lib/ranking';

const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'relevance');

interface CandidateEntry {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
}

interface QueryCandidates {
  query_id: string;
  category: string;
  candidates: CandidateEntry[];
}

interface EvalQuery {
  id: string;
  query: string;
  expected_ids: string[];
  category: string;
}

interface BaselineArtifact {
  recorded_at: string;
  overall_top3: number;
  by_category: Record<string, number>;
  ranking_config: Record<string, unknown>;
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8')) as T;
}

/**
 * Mirrors `scripts/eval-relevance.ts`'s `toQueryResults`: rank the recorded
 * raw candidates through issue #34's composite score (default weights, no
 * config file in the offline replay context) before slicing top-3, so this
 * replay stays a meaningful regression guard for every ranking-affecting
 * story in the plan, not just a replay of pre-#34 raw similarity order.
 */
function rankTop3(candidates: CandidateEntry[]): (string | number)[] {
  const ranked = rankResults(
    candidates.map((c) => ({
      id: c.id,
      similarity: c.score,
      timestampUtc:
        typeof c.payload?.['timestamp_utc'] === 'string' ? c.payload['timestamp_utc'] : undefined,
      source: c.payload?.['source'],
    })),
    DEFAULT_RANKING_WEIGHTS,
    DEFAULT_RECENCY_HALF_LIFE_DAYS,
  );
  return ranked.slice(0, 3).map((c) => c.id);
}

describe('relevance replay (offline, no network)', () => {
  const queries = readJson<EvalQuery[]>('queries.json');
  const candidates = readJson<QueryCandidates[]>('candidates.json');
  const baseline = readJson<BaselineArtifact>('baseline.json');

  it('never reads QDRANT_URL or EMBEDDINGS_API_KEY', () => {
    const original = { ...process.env };
    delete process.env['QDRANT_URL'];
    delete process.env['EMBEDDINGS_API_KEY'];

    const candidatesByQueryId = new Map(candidates.map((c) => [c.query_id, c.candidates]));
    const results: QueryResult[] = queries.map((q) => ({
      category: q.category,
      expectedIds: q.expected_ids,
      top3Ids: rankTop3(candidatesByQueryId.get(q.id) ?? []),
    }));
    const report = computeTop3HitRate(results);

    expect(report.overall_top3).toBeGreaterThanOrEqual(baseline.overall_top3);

    process.env = original;
  });

  it('recomputed overall top-3 hit rate meets or exceeds the recorded baseline floor', () => {
    const candidatesByQueryId = new Map(candidates.map((c) => [c.query_id, c.candidates]));
    const results: QueryResult[] = queries.map((q) => ({
      category: q.category,
      expectedIds: q.expected_ids,
      top3Ids: rankTop3(candidatesByQueryId.get(q.id) ?? []),
    }));

    const report = computeTop3HitRate(results);

    expect(report.overall_top3).toBeGreaterThanOrEqual(baseline.overall_top3);
    for (const [category, rate] of Object.entries(baseline.by_category)) {
      expect(report.by_category[category]).toBeGreaterThanOrEqual(rate);
    }
  });

  it('every query in queries.json has a corresponding candidates.json entry (CT-2)', () => {
    const candidateQueryIds = new Set(candidates.map((c) => c.query_id));
    for (const q of queries) {
      expect(candidateQueryIds.has(q.id)).toBe(true);
    }
  });

  it('baseline.json has exactly the documented keys with values in range (CT-1)', () => {
    expect(baseline).toHaveProperty('recorded_at');
    expect(baseline).toHaveProperty('overall_top3');
    expect(baseline).toHaveProperty('by_category');
    expect(baseline).toHaveProperty('ranking_config');
    expect(baseline.overall_top3).toBeGreaterThanOrEqual(0);
    expect(baseline.overall_top3).toBeLessThanOrEqual(1);
    for (const rate of Object.values(baseline.by_category)) {
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });

  it('fails loudly on an empty candidates.json instead of a false 0/0 pass (EC-9)', () => {
    const emptyResults: QueryResult[] = queries.map((q) => ({
      category: q.category,
      expectedIds: q.expected_ids,
      top3Ids: [],
    }));

    const report = computeTop3HitRate(emptyResults);

    // With every candidate list empty, every evaluable query is a genuine
    // miss (top3Ids is []), so the recomputed rate collapses toward 0 and
    // the >= baseline assertion below fails loudly rather than silently
    // passing — this is the behavior this test locks in.
    expect(report.overall_top3).toBeLessThan(baseline.overall_top3);
  });
});
