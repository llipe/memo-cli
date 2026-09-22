/**
 * Offline replay guard (AC6, AC9, SC-7, CT-5) and AC21 regression gate
 * (`workstream/user-stories-prd-004-phase-1.md:170`).
 *
 * Replays the committed `candidates.json` through issue #34's `rankResults`
 * (see `rankTop3` below) and `computeTop3HitRate` — with no network access —
 * and asserts the recomputed hit rate is >= the recorded
 * `baseline.json.overall_top3`. Must pass with no `QDRANT_URL` or
 * `EMBEDDINGS_API_KEY` set (AC9); this file imports no Qdrant client and no
 * embeddings adapter, so there is nothing here that could reach the network
 * even if those variables were present.
 *
 * AC21 history (S1-02, issue #34): landing composite ranking at the
 * originally-proposed `recency_half_life_days: 90` regressed the recorded
 * S1-01 floor (92.9%, pre-ranking identity/similarity ordering, per
 * `user-stories-prd-004-phase-1.md:96`) down to 85.7% — a genuine AC21
 * failure that was deliberately left failing, not papered over, while
 * routed for a real decision. It was resolved by applying the task 8.0
 * tuning-sweep methodology to this story: a one-factor sweep over
 * `recency_half_life_days` (weights held at their spec values, 0.6/0.3/0.1)
 * found a wide, robust plateau from ~260 to 700+ days all measuring 96.4%;
 * `365` was chosen as the simplest value inside it (see
 * `DEFAULT_RECENCY_HALF_LIFE_DAYS` in `src/lib/ranking.ts`). `baseline.json`
 * and `candidates.json` were then re-recorded for real against live Qdrant
 * Cloud at that new default, so this is the legitimate 96.4% floor for
 * every later story (#36 onward), not a downgraded one. Full sweep grid and
 * before/after numbers are in PR #67.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeTop3HitRate } from '../../src/lib/eval';
import type { QueryResult } from '../../src/lib/eval';
import { buildBaseFilter } from '../../src/lib/filters';
import type { QdrantFilter } from '../../src/lib/qdrant';
import {
  rankResults,
  DEFAULT_RANKING_WEIGHTS,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
  DEFAULT_TAG_BOOST_FACTOR,
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
 *
 * #36: also passes the real query text and each candidate's recorded
 * `tags` through to `rankResults` at the default `tag_boost_factor`, so
 * this replay genuinely exercises tag-overlap boosting against the fixture
 * set (AC7) instead of leaving it permanently neutral.
 */
function rankTop3(query: string, candidates: CandidateEntry[]): (string | number)[] {
  const ranked = rankResults(
    candidates.map((c) => ({
      id: c.id,
      similarity: c.score,
      timestampUtc:
        typeof c.payload?.['timestamp_utc'] === 'string' ? c.payload['timestamp_utc'] : undefined,
      source: c.payload?.['source'],
      tags: Array.isArray(c.payload?.['tags']) ? c.payload['tags'] : undefined,
    })),
    DEFAULT_RANKING_WEIGHTS,
    DEFAULT_RECENCY_HALF_LIFE_DAYS,
    Date.now(),
    query,
    DEFAULT_TAG_BOOST_FACTOR,
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
      top3Ids: rankTop3(q.query, candidatesByQueryId.get(q.id) ?? []),
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
      top3Ids: rankTop3(q.query, candidatesByQueryId.get(q.id) ?? []),
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

/**
 * Story S2-05, AC2 (PRD AC-2.3, regression gate) — test plan §7.
 *
 * Today's replay (above) feeds `candidates.json` straight into `rankResults`
 * with no filter step at all: a ranking-identity guard, not a filter-identity
 * guard. This block routes each recorded candidate's payload through the
 * exact same `base`-filter predicate `search.ts`/`list.ts` apply at query
 * time (constructed with **no flags supplied** — the default/v1-compatible
 * `base`) and asserts:
 *
 *   1. no false exclusion — every id in a query's recorded candidate list
 *      still passes the v2 filter (v1-shaped payloads have no
 *      `bank`/`kind`/`archived`/`superseded` fields, so the `is_empty`
 *      fallback and the `kind != self` exclusion must both no-op on them);
 *   2. no false inclusion — the filter step never adds an id that was not in
 *      the recorded candidate list (trivially true for a pure `Array#filter`,
 *      asserted explicitly here rather than assumed);
 *   3. ordering identity — the ranked top-N id order computed from the
 *      filtered candidate set exactly matches the ranked top-N order computed
 *      from the raw recorded candidate set, for every query.
 *
 * `candidates.json`/`baseline.json` are the fixtures of record and MUST NOT
 * be regenerated to make this test pass — regenerating either file to paper
 * over a real filter-path regression is itself a Critical-severity finding
 * (test plan §7).
 */
describe('AC2 / AC-2.3: v2 filter-path identity (regression gate)', () => {
  const queries = readJson<EvalQuery[]>('queries.json');
  const candidates = readJson<QueryCandidates[]>('candidates.json');
  const baseline = readJson<BaselineArtifact>('baseline.json');

  /**
   * A minimal, test-only Qdrant filter evaluator supporting exactly the
   * clause shapes `buildBaseFilter` produces (`must`/`must_not`/`should`,
   * `key`+`match.value`/`match.any`, `key`+`range`, `is_empty`, and nested
   * `should` groups) — not a general-purpose Qdrant filter engine. This is
   * deliberately independent of any production code path so it can act as
   * an oracle, not a mirror of the implementation under test.
   */
  function matchesClause(
    clause: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): boolean {
    if ('is_empty' in clause) {
      const key = (clause['is_empty'] as { key: string }).key;
      const value = payload[key];
      return (
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      );
    }

    if ('should' in clause) {
      const nested = clause['should'] as Record<string, unknown>[];
      return nested.some((c) => matchesClause(c, payload));
    }

    if ('key' in clause) {
      const key = clause['key'] as string;
      const value = payload[key];

      if ('match' in clause) {
        const match = clause['match'] as { value?: unknown; any?: unknown[] };
        if (match.value !== undefined) return value === match.value;
        if (match.any !== undefined) {
          return Array.isArray(value)
            ? value.some((v) => match.any?.includes(v))
            : match.any.includes(value);
        }
        return false;
      }

      if ('range' in clause) {
        const range = clause['range'] as {
          lte?: string;
          gte?: string;
          gt?: string;
          lt?: string;
        };
        if (typeof value !== 'string') return false;
        if (range.lte !== undefined && !(value <= range.lte)) return false;
        if (range.gte !== undefined && !(value >= range.gte)) return false;
        if (range.gt !== undefined && !(value > range.gt)) return false;
        if (range.lt !== undefined && !(value < range.lt)) return false;
        return true;
      }
    }

    return false;
  }

  function evaluateBaseFilter(filter: QdrantFilter, payload: Record<string, unknown>): boolean {
    const f = filter as {
      must?: Record<string, unknown>[];
      must_not?: Record<string, unknown>[];
      should?: Record<string, unknown>[];
    };

    if (f.must && !f.must.every((clause) => matchesClause(clause, payload))) return false;
    if (f.must_not && !f.must_not.every((clause) => !matchesClause(clause, payload))) {
      return false;
    }
    if (
      f.should &&
      f.should.length > 0 &&
      !f.should.some((clause) => matchesClause(clause, payload))
    ) {
      return false;
    }
    return true;
  }

  function rankIds(candidateEntries: CandidateEntry[], query: string): (string | number)[] {
    const ranked = rankResults(
      candidateEntries.map((c) => ({
        id: c.id,
        similarity: c.score,
        timestampUtc:
          typeof c.payload?.['timestamp_utc'] === 'string' ? c.payload['timestamp_utc'] : undefined,
        source: c.payload?.['source'],
        tags: Array.isArray(c.payload?.['tags']) ? c.payload['tags'] : undefined,
      })),
      DEFAULT_RANKING_WEIGHTS,
      DEFAULT_RECENCY_HALF_LIFE_DAYS,
      Date.now(),
      query,
      DEFAULT_TAG_BOOST_FACTOR,
    );
    return ranked.map((r) => r.id);
  }

  // The default/v1-compatible base: no flags supplied at all (bank = 'kb',
  // kind = 'all' minus self, archived/superseded excluded, no session/as-of).
  const defaultBase = buildBaseFilter({ bank: 'kb', kind: 'all' });

  it('no false exclusion: every recorded candidate id still passes the v2 default filter', () => {
    for (const queryCandidates of candidates) {
      const filteredIds = queryCandidates.candidates
        .filter((c) => evaluateBaseFilter(defaultBase, c.payload ?? {}))
        .map((c) => c.id);
      const recordedIds = queryCandidates.candidates.map((c) => c.id);
      expect(filteredIds).toEqual(recordedIds);
    }
  });

  it('no false inclusion: the filter step never introduces an id absent from the recorded set', () => {
    for (const queryCandidates of candidates) {
      const filtered = queryCandidates.candidates.filter((c) =>
        evaluateBaseFilter(defaultBase, c.payload ?? {}),
      );
      const recordedIdSet = new Set(queryCandidates.candidates.map((c) => c.id));
      for (const c of filtered) {
        expect(recordedIdSet.has(c.id)).toBe(true);
      }
      expect(filtered.length).toBe(queryCandidates.candidates.length);
    }
  });

  it('ordering identity: ranked top-N order is unchanged after routing candidates through the v2 filter', () => {
    const candidatesByQueryId = new Map(candidates.map((c) => [c.query_id, c.candidates]));

    for (const q of queries) {
      const raw = candidatesByQueryId.get(q.id) ?? [];
      const filtered = raw.filter((c) => evaluateBaseFilter(defaultBase, c.payload ?? {}));

      const rawOrder = rankIds(raw, q.query);
      const filteredOrder = rankIds(filtered, q.query);

      expect(filteredOrder).toEqual(rawOrder);
    }
  });

  it('the filter is not vacuously true: it actually excludes archived/superseded/self-kind synthetic candidates', () => {
    const synthetic: CandidateEntry[] = [
      { id: 'kept-v1', score: 0.5, payload: { timestamp_utc: '2026-01-01T00:00:00.000Z' } },
      {
        id: 'kept-kb-explicit',
        score: 0.5,
        payload: { bank: 'kb', kind: 'semantic', timestamp_utc: '2026-01-01T00:00:00.000Z' },
      },
      {
        id: 'excluded-archived',
        score: 0.9,
        payload: { archived: true, timestamp_utc: '2026-01-01T00:00:00.000Z' },
      },
      {
        id: 'excluded-superseded',
        score: 0.9,
        payload: { superseded: true, timestamp_utc: '2026-01-01T00:00:00.000Z' },
      },
      {
        id: 'excluded-self-kind',
        score: 0.9,
        payload: { kind: 'self', timestamp_utc: '2026-01-01T00:00:00.000Z' },
      },
      {
        id: 'excluded-other-bank',
        score: 0.9,
        payload: { bank: 'jarvis-memory', timestamp_utc: '2026-01-01T00:00:00.000Z' },
      },
    ];

    const kept = synthetic
      .filter((c) => evaluateBaseFilter(defaultBase, c.payload ?? {}))
      .map((c) => c.id);

    expect(kept).toEqual(['kept-v1', 'kept-kb-explicit']);
  });

  it('recomputed overall top-3 hit rate through the v2 filter path meets the recorded baseline floor', () => {
    const candidatesByQueryId = new Map(candidates.map((c) => [c.query_id, c.candidates]));
    const results: QueryResult[] = queries.map((q) => {
      const raw = candidatesByQueryId.get(q.id) ?? [];
      const filtered = raw.filter((c) => evaluateBaseFilter(defaultBase, c.payload ?? {}));
      return {
        category: q.category,
        expectedIds: q.expected_ids,
        top3Ids: rankIds(filtered, q.query).slice(0, 3),
      };
    });

    const report = computeTop3HitRate(results);
    expect(report.overall_top3).toBeGreaterThanOrEqual(baseline.overall_top3);
  });
});
