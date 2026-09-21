import {
  computeRecencyScore,
  computeSourceScore,
  computeCompositeScore,
  computeTagBoost,
  computeConfidenceTier,
  rankResults,
  DEFAULT_RANKING_WEIGHTS,
  DEFAULT_TAG_BOOST_FACTOR,
  DEFAULT_CONFIDENCE_THRESHOLDS,
} from '../../../src/lib/ranking';
import type { RankableEntry } from '../../../src/lib/ranking';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-20T00:00:00Z');

function isoAgeDays(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

describe('computeRecencyScore', () => {
  it('returns 1.0 at age 0', () => {
    expect(computeRecencyScore(isoAgeDays(0), NOW, 90)).toBeCloseTo(1.0, 4);
  });

  it('returns ~0.7071 at half of the half-life (45 days)', () => {
    expect(computeRecencyScore(isoAgeDays(45), NOW, 90)).toBeCloseTo(0.7071, 4);
  });

  it('returns ~0.5 at exactly one half-life (90 days)', () => {
    expect(computeRecencyScore(isoAgeDays(90), NOW, 90)).toBeCloseTo(0.5, 4);
  });

  it('returns ~0.25 at two half-lives (180 days)', () => {
    expect(computeRecencyScore(isoAgeDays(180), NOW, 90)).toBeCloseTo(0.25, 4);
  });

  // DEF-2: at exactly 3x half-life, recency_score is ~0.125, NOT < 0.1.
  it('returns ~0.125 at three half-lives (270 days), not < 0.1 (DEF-2)', () => {
    const score = computeRecencyScore(isoAgeDays(270), NOW, 90);
    expect(score).toBeCloseTo(0.125, 4);
    expect(score).toBeGreaterThanOrEqual(0.1);
  });

  it('returns < 0.1 only at four half-lives (360 days) or more (DEF-2)', () => {
    const score = computeRecencyScore(isoAgeDays(360), NOW, 90);
    expect(score).toBeCloseTo(0.0625, 4);
    expect(score).toBeLessThan(0.1);
  });

  it('clamps a future timestamp (clock skew) to 1.0 (R4)', () => {
    const future = new Date(NOW + 30 * DAY_MS).toISOString();
    expect(computeRecencyScore(future, NOW, 90)).toBe(1.0);
  });

  it('returns 0 for a missing timestamp (D4)', () => {
    expect(computeRecencyScore(undefined, NOW, 90)).toBe(0);
    expect(computeRecencyScore(null, NOW, 90)).toBe(0);
    expect(computeRecencyScore('', NOW, 90)).toBe(0);
  });

  it('returns 0 for a malformed timestamp (D4, R5)', () => {
    expect(computeRecencyScore('not-a-date', NOW, 90)).toBe(0);
    expect(computeRecencyScore('2026-13-45T99:99:99Z', NOW, 90)).toBe(0);
  });

  it('returns 0 for a non-positive or non-finite half-life rather than dividing by zero (R10)', () => {
    expect(computeRecencyScore(isoAgeDays(0), NOW, 0)).toBe(0);
    expect(computeRecencyScore(isoAgeDays(0), NOW, -1)).toBe(0);
    expect(computeRecencyScore(isoAgeDays(0), NOW, Infinity)).toBe(0);
  });

  it('uses the default now and half-life when not supplied', () => {
    const score = computeRecencyScore(new Date().toISOString());
    expect(score).toBeCloseTo(1, 1);
  });

  it('handles extreme age without producing NaN or a negative score', () => {
    const veryOld = new Date(NOW - 100_000 * 365 * DAY_MS).toISOString();
    const score = computeRecencyScore(veryOld, NOW, 90);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('underflows to exactly 0, never NaN, for an age near the epoch/date range limit', () => {
    const score = computeRecencyScore(new Date(0).toISOString(), NOW, 90);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('computeSourceScore', () => {
  it('maps agent to 1.0', () => {
    expect(computeSourceScore('agent')).toBe(1.0);
  });

  it('maps manual to 0.8', () => {
    expect(computeSourceScore('manual')).toBe(0.8);
  });

  it('maps scan to 0.5', () => {
    expect(computeSourceScore('scan')).toBe(0.5);
  });

  it('maps an unknown string source to 0.5 (D5)', () => {
    expect(computeSourceScore('future-source')).toBe(0.5);
  });

  it('maps a wrong-case known value to 0.5, never throws (EC-4)', () => {
    expect(computeSourceScore('AGENT')).toBe(0.5);
  });

  it('maps undefined and null to 0.5 (D5)', () => {
    expect(computeSourceScore(undefined)).toBe(0.5);
    expect(computeSourceScore(null)).toBe(0.5);
  });

  it('maps a hostile non-string type to 0.5, never throws', () => {
    expect(computeSourceScore(42)).toBe(0.5);
    expect(computeSourceScore({})).toBe(0.5);
    expect(computeSourceScore([])).toBe(0.5);
  });
});

describe('computeCompositeScore', () => {
  it('composes the AC2 scenario exactly under default weights', () => {
    // Entry A: similarity 0.90, 180 days old, source agent -> 0.7150
    const recencyA = computeRecencyScore(isoAgeDays(180), NOW, 90);
    const scoreA = computeCompositeScore(
      { similarity: 0.9, recencyScore: recencyA, sourceScore: computeSourceScore('agent') },
      DEFAULT_RANKING_WEIGHTS,
    );
    expect(scoreA).toBeCloseTo(0.715, 3);

    // Entry B: similarity 0.82, 5 days old, source agent -> 0.8807
    const recencyB = computeRecencyScore(isoAgeDays(5), NOW, 90);
    const scoreB = computeCompositeScore(
      { similarity: 0.82, recencyScore: recencyB, sourceScore: computeSourceScore('agent') },
      DEFAULT_RANKING_WEIGHTS,
    );
    expect(scoreB).toBeCloseTo(0.8807, 3);
    expect(scoreB).toBeGreaterThan(scoreA);
  });

  it('gives agent exactly 0.05 more than scan at equal similarity and recency (AC3)', () => {
    const agentScore = computeCompositeScore({
      similarity: 0.7,
      recencyScore: 0.6,
      sourceScore: computeSourceScore('agent'),
    });
    const scanScore = computeCompositeScore({
      similarity: 0.7,
      recencyScore: 0.6,
      sourceScore: computeSourceScore('scan'),
    });
    expect(agentScore - scanScore).toBeCloseTo(0.05, 9);
  });

  it('supports custom weights', () => {
    const score = computeCompositeScore(
      { similarity: 1, recencyScore: 0, sourceScore: 0 },
      { w_similarity: 0.5, w_recency: 0.4, w_source: 0.1 },
    );
    expect(score).toBeCloseTo(0.5, 9);
  });

  it('is always bounded in [0, 1], including negative similarity (D8, AC4)', () => {
    const score = computeCompositeScore({ similarity: -1, recencyScore: -1, sourceScore: -1 });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('clamps a spurious similarity slightly above 1.0', () => {
    const score = computeCompositeScore({ similarity: 1.0000001, recencyScore: 1, sourceScore: 1 });
    expect(score).toBeLessThanOrEqual(1);
  });

  it('treats a non-finite similarity as 0 rather than propagating NaN', () => {
    const score = computeCompositeScore({ similarity: NaN, recencyScore: 0.5, sourceScore: 0.5 });
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);

    const infScore = computeCompositeScore({
      similarity: Infinity,
      recencyScore: 0.5,
      sourceScore: 0.5,
    });
    expect(infScore).toBeLessThanOrEqual(1);
  });

  it('leaves the final score unaffected by neutral factor defaults', () => {
    const withDefaults = computeCompositeScore({
      similarity: 0.5,
      recencyScore: 0.5,
      sourceScore: 0.5,
    });
    const withExplicitNeutrals = computeCompositeScore({
      similarity: 0.5,
      recencyScore: 0.5,
      sourceScore: 0.5,
      tagBoost: 0,
      lexicalBoost: 0,
      retentionFactor: 1,
      useRatioFactor: 1,
      linkFactor: 1,
    });
    expect(withExplicitNeutrals).toBeCloseTo(withDefaults, 9);
  });
});

describe('rankResults', () => {
  it('orders results by final_score descending (AC1)', () => {
    const entries: RankableEntry[] = [
      { id: 'low', similarity: 0.5, timestampUtc: isoAgeDays(365), source: 'scan' },
      { id: 'high', similarity: 0.9, timestampUtc: isoAgeDays(1), source: 'agent' },
    ];
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW);
    expect(ranked.map((r) => r.id)).toEqual(['high', 'low']);
    expect(ranked[0]?.final_score).toBeGreaterThan(ranked[1]?.final_score ?? 0);
  });

  it('ranks the newer, lower-similarity entry above the older, higher-similarity one (AC2)', () => {
    const entries: RankableEntry[] = [
      { id: 'A', similarity: 0.9, timestampUtc: isoAgeDays(180), source: 'agent' },
      { id: 'B', similarity: 0.82, timestampUtc: isoAgeDays(5), source: 'agent' },
    ];
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW);
    expect(ranked[0]?.id).toBe('B');
    expect(ranked[1]?.id).toBe('A');
    expect(ranked[0]?.final_score).toBeCloseTo(0.8807, 3);
    expect(ranked[1]?.final_score).toBeCloseTo(0.715, 3);
  });

  it('applies the documented tiebreak: final_score desc, timestamp_utc desc, id asc (R9)', () => {
    const entries: RankableEntry[] = [
      { id: 'b', similarity: 0.5, timestampUtc: isoAgeDays(10), source: 'agent' },
      { id: 'a', similarity: 0.5, timestampUtc: isoAgeDays(10), source: 'agent' },
      { id: 'newer', similarity: 0.5, timestampUtc: isoAgeDays(1), source: 'agent' },
    ];
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW);
    expect(ranked.map((r) => r.id)).toEqual(['newer', 'a', 'b']);
  });

  it('falls back to id ascending when the tiebreak timestamp is absent on both sides (EC-10)', () => {
    const entries: RankableEntry[] = [
      { id: 'zebra', similarity: 0.5, source: 'agent' },
      { id: 'apple', similarity: 0.5, source: 'agent' },
    ];
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW);
    expect(ranked.map((r) => r.id)).toEqual(['apple', 'zebra']);
  });

  it('breaks an id tie the other direction too (id asc regardless of input order)', () => {
    const entries: RankableEntry[] = [
      { id: 'apple', similarity: 0.5, source: 'agent' },
      { id: 'zebra', similarity: 0.5, source: 'agent' },
    ];
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW);
    expect(ranked.map((r) => r.id)).toEqual(['apple', 'zebra']);
  });

  it('prefers the entry with a valid timestamp over one with none, at equal final_score', () => {
    // w_recency: 0 keeps final_score identical regardless of recency, so the
    // comparator must fall through to the timestamp-presence tiebreak rungs.
    const zeroRecencyWeights = { w_similarity: 0.9, w_recency: 0, w_source: 0.1 };
    const withTime: RankableEntry[] = [
      { id: 'no-time', similarity: 0.5, source: 'agent' },
      { id: 'has-time', similarity: 0.5, source: 'agent', timestampUtc: isoAgeDays(10) },
    ];
    const ranked = rankResults(withTime, zeroRecencyWeights, 90, NOW);
    expect(ranked[0]?.final_score).toBe(ranked[1]?.final_score);
    expect(ranked[0]?.id).toBe('has-time');

    const reversed: RankableEntry[] = [
      { id: 'has-time', similarity: 0.5, source: 'agent', timestampUtc: isoAgeDays(10) },
      { id: 'no-time', similarity: 0.5, source: 'agent' },
    ];
    const rankedReversed = rankResults(reversed, zeroRecencyWeights, 90, NOW);
    expect(rankedReversed[0]?.id).toBe('has-time');
  });

  it('returns an empty array for empty input (R7)', () => {
    expect(rankResults([], DEFAULT_RANKING_WEIGHTS, 90, NOW)).toEqual([]);
  });

  it('returns the single input entry unchanged in length for a single-element input', () => {
    const entries: RankableEntry[] = [{ id: 'only', similarity: 0.5, source: 'agent' }];
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.id).toBe('only');
  });

  it('preserves extra fields carried on each entry (e.g. payload) through ranking', () => {
    const entries = [{ id: 'x', similarity: 0.5, source: 'agent', payload: { repo: 'memo-cli' } }];
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW);
    expect(ranked[0]?.payload).toEqual({ repo: 'memo-cli' });
  });

  it('does not mutate the input array', () => {
    const entries: RankableEntry[] = [{ id: 'x', similarity: 0.5, source: 'agent' }];
    const before = JSON.stringify(entries);
    rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW);
    expect(JSON.stringify(entries)).toBe(before);
  });

  it('falls back to default weights, half-life, and now when called with only entries', () => {
    const ranked = rankResults([{ id: 'x', similarity: 0.5, source: 'agent' }]);
    expect(ranked).toHaveLength(1);
    expect(Number.isFinite(ranked[0]?.final_score)).toBe(true);
  });

  it('attaches a resolved neutral factor bag to every entry (AC19)', () => {
    const ranked = rankResults(
      [{ id: 'x', similarity: 0.5, source: 'agent' }],
      DEFAULT_RANKING_WEIGHTS,
      90,
      NOW,
    );
    expect(ranked[0]?.factors).toEqual({
      tag_boost: 0,
      lexical_boost: 0,
      retention_factor: 1,
      use_ratio_factor: 1,
      link_factor: 1,
    });
  });

  it('passes through non-neutral factors when the entry supplies them', () => {
    const ranked = rankResults(
      [{ id: 'x', similarity: 0.5, source: 'agent', tagBoost: 0.05, retentionFactor: 0.9 }],
      DEFAULT_RANKING_WEIGHTS,
      90,
      NOW,
    );
    expect(ranked[0]?.factors.tag_boost).toBe(0.05);
    expect(ranked[0]?.factors.retention_factor).toBe(0.9);
  });

  it('treats two entries with the same id as fully tied (defensive; ids are expected unique)', () => {
    const entries: RankableEntry[] = [
      { id: 'dup', similarity: 0.5, source: 'agent' },
      { id: 'dup', similarity: 0.5, source: 'agent' },
    ];
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.final_score).toBe(ranked[1]?.final_score);
  });
});

describe('computeTagBoost (#36)', () => {
  it('computes a single exact tag match (AC1)', () => {
    // total_query_terms: rate, limiting, strategy (3); matched_tags: 1
    const boost = computeTagBoost('rate limiting strategy', ['rate'], 0.05);
    expect(boost).toBeCloseTo((1 / 3) * 0.05, 9);
  });

  it('computes multiple tag matches (AC1)', () => {
    const boost = computeTagBoost('rate limiting strategy', ['rate', 'limiting'], 0.05);
    expect(boost).toBeCloseTo((2 / 3) * 0.05, 9);
  });

  it('returns 0 when no tag matches any query term', () => {
    expect(computeTagBoost('rate limiting strategy', ['unrelated'], 0.05)).toBe(0);
  });

  it('returns 0 and never divides by zero for a stopword-only query (AC6)', () => {
    expect(computeTagBoost('the a is', ['rate'], 0.05)).toBe(0);
  });

  it('matches case-insensitively (AC3)', () => {
    const boost = computeTagBoost('Rate Limiting', ['RATE'], 0.05);
    expect(boost).toBeCloseTo((1 / 2) * 0.05, 9);
  });

  it('strips surrounding punctuation before matching (AC3)', () => {
    const boost = computeTagBoost('rate, limiting!', ['rate', 'limiting'], 0.05);
    expect(boost).toBeCloseTo(0.05, 9);
  });

  it('matches a hyphenated tag only on its whole token, not the bare prefix', () => {
    // "rate-limiting" is a single query term matching the whole kebab tag.
    const withHyphen = computeTagBoost('rate-limiting strategy', ['rate-limiting'], 0.05);
    expect(withHyphen).toBeCloseTo((1 / 2) * 0.05, 9);

    // A bare "rate" tag must NOT match the "rate-limiting" query token.
    const bareTagNoMatch = computeTagBoost('rate-limiting strategy', ['rate'], 0.05);
    expect(bareTagNoMatch).toBe(0);
  });

  it('does not match a substring of a query term (whole-word matching, AC3)', () => {
    expect(computeTagBoost('ratelimiting strategy', ['rate'], 0.05)).toBe(0);
  });

  it('excludes stopwords from total_query_terms (AC3)', () => {
    // "for", "the" are stopwords; only "rate" and "limiting" count.
    const boost = computeTagBoost('for the rate limiting', ['rate'], 0.05);
    expect(boost).toBeCloseTo((1 / 2) * 0.05, 9);
  });

  it('returns 0 when boost_factor is 0, disabling boosting entirely (AC2)', () => {
    expect(computeTagBoost('rate limiting', ['rate'], 0)).toBe(0);
  });

  it('returns exactly the factor when every term matches (ratio caps at 1)', () => {
    expect(computeTagBoost('rate limiting', ['rate', 'limiting'], 0.05)).toBeCloseTo(0.05, 9);
  });

  it('returns 0 for an empty tags array', () => {
    expect(computeTagBoost('rate limiting', [], 0.05)).toBe(0);
  });

  it('returns 0 for an empty or whitespace-only query', () => {
    expect(computeTagBoost('', ['rate'], 0.05)).toBe(0);
    expect(computeTagBoost('   ', ['rate'], 0.05)).toBe(0);
  });

  it('defaults boost_factor to DEFAULT_TAG_BOOST_FACTOR (0.05) when omitted', () => {
    expect(computeTagBoost('rate limiting', ['rate', 'limiting'])).toBeCloseTo(
      DEFAULT_TAG_BOOST_FACTOR,
      9,
    );
  });

  it('handles a single-term query (edge case)', () => {
    expect(computeTagBoost('rate', ['rate'], 0.05)).toBeCloseTo(0.05, 9);
  });

  it('handles a 50-term query without error', () => {
    const query = Array.from({ length: 49 }, (_, i) => `term${String(i)}`).join(' ') + ' rate';
    expect(computeTagBoost(query, ['rate'], 0.05)).toBeCloseTo((1 / 50) * 0.05, 9);
  });

  it('handles the 5-tag maximum', () => {
    const boost = computeTagBoost(
      'rate limiting strategy for retries',
      ['rate', 'limiting', 'strategy', 'retries', 'unmatched'],
      0.05,
    );
    // total_query_terms excludes "for" (stopword): rate, limiting, strategy, retries = 4
    // matched tags: rate, limiting, strategy, retries = 4
    expect(boost).toBeCloseTo((4 / 4) * 0.05, 9);
  });

  it('handles unicode characters in the query', () => {
    const boost = computeTagBoost('café résumé', ['café'], 0.05);
    expect(boost).toBeCloseTo((1 / 2) * 0.05, 9);
  });
});

describe('rankResults tag boost integration (#36)', () => {
  it('attaches tag_boost to the resolved factor bag and composes it into final_score (AC1, AC5)', () => {
    const entries: RankableEntry[] = [
      { id: 'x', similarity: 0.5, source: 'agent', tags: ['rate', 'limiting'] },
    ];
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW, 'rate limiting', 0.05);
    expect(ranked[0]?.factors.tag_boost).toBeCloseTo(0.05, 9);
  });

  it('ranks a tag-matching entry above an equal-similarity non-matching one', () => {
    const entries: RankableEntry[] = [
      { id: 'no-match', similarity: 0.6, source: 'agent', tags: ['unrelated'] },
      { id: 'match', similarity: 0.6, source: 'agent', tags: ['rate', 'limiting'] },
    ];
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW, 'rate limiting', 0.05);
    expect(ranked[0]?.id).toBe('match');
    expect(ranked[0]?.final_score).toBeGreaterThan(ranked[1]?.final_score ?? 0);
  });

  it('defaults tag_boost to 0 when no query is supplied (backward compatible)', () => {
    const entries: RankableEntry[] = [
      { id: 'x', similarity: 0.5, source: 'agent', tags: ['rate'] },
    ];
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW);
    expect(ranked[0]?.factors.tag_boost).toBe(0);
  });

  it('caps the boosted score at 1.0 even with a large tag boost (AC5)', () => {
    const entries: RankableEntry[] = [
      { id: 'x', similarity: 1, source: 'agent', tags: ['rate', 'limiting'] },
    ];
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW, 'rate limiting', 1);
    expect(ranked[0]?.final_score).toBe(1);
  });

  it('an explicit entry.tagBoost still takes precedence over query-derived computation (backward compat)', () => {
    const entries = [
      { id: 'x', similarity: 0.5, source: 'agent', tags: ['unrelated'], tagBoost: 0.05 },
    ];
    const ranked = rankResults(
      entries,
      DEFAULT_RANKING_WEIGHTS,
      90,
      NOW,
      'no matching terms',
      0.05,
    );
    expect(ranked[0]?.factors.tag_boost).toBe(0.05);
  });
});

describe('computeConfidenceTier (#35)', () => {
  it('returns "exact" at and above the exact threshold (AC1)', () => {
    expect(computeConfidenceTier(0.95, DEFAULT_CONFIDENCE_THRESHOLDS)).toBe('exact');
    expect(computeConfidenceTier(1, DEFAULT_CONFIDENCE_THRESHOLDS)).toBe('exact');
  });

  it('returns "high" in the [0.75, 0.88) band (AC1)', () => {
    expect(computeConfidenceTier(0.8, DEFAULT_CONFIDENCE_THRESHOLDS)).toBe('high');
  });

  it('returns "medium" in the [0.60, 0.75) band (AC1)', () => {
    expect(computeConfidenceTier(0.65, DEFAULT_CONFIDENCE_THRESHOLDS)).toBe('medium');
  });

  it('returns "low" below the medium threshold (AC1)', () => {
    expect(computeConfidenceTier(0.1, DEFAULT_CONFIDENCE_THRESHOLDS)).toBe('low');
    expect(computeConfidenceTier(0, DEFAULT_CONFIDENCE_THRESHOLDS)).toBe('low');
  });

  it('lands exactly on "exact" at score 0.88 (AC6)', () => {
    expect(computeConfidenceTier(0.88, DEFAULT_CONFIDENCE_THRESHOLDS)).toBe('exact');
  });

  it('lands exactly on "high" at score 0.75 (AC6)', () => {
    expect(computeConfidenceTier(0.75, DEFAULT_CONFIDENCE_THRESHOLDS)).toBe('high');
  });

  it('lands exactly on "medium" at score 0.60 (AC6)', () => {
    expect(computeConfidenceTier(0.6, DEFAULT_CONFIDENCE_THRESHOLDS)).toBe('medium');
  });

  it('lands on "low" just below the medium threshold (AC6)', () => {
    expect(computeConfidenceTier(0.5999, DEFAULT_CONFIDENCE_THRESHOLDS)).toBe('low');
  });

  it('supports custom thresholds', () => {
    const thresholds = { exact: 0.95, high: 0.8, medium: 0.5 };
    expect(computeConfidenceTier(0.9, thresholds)).toBe('high');
    expect(computeConfidenceTier(0.96, thresholds)).toBe('exact');
    expect(computeConfidenceTier(0.5, thresholds)).toBe('medium');
    expect(computeConfidenceTier(0.49, thresholds)).toBe('low');
  });

  it('handles score 0 and score 1 at the default thresholds', () => {
    expect(computeConfidenceTier(0, DEFAULT_CONFIDENCE_THRESHOLDS)).toBe('low');
    expect(computeConfidenceTier(1, DEFAULT_CONFIDENCE_THRESHOLDS)).toBe('exact');
  });

  it('defaults to DEFAULT_CONFIDENCE_THRESHOLDS when omitted', () => {
    expect(computeConfidenceTier(0.88)).toBe('exact');
    expect(computeConfidenceTier(0.5999)).toBe('low');
  });
});

describe('rankResults confidence tier integration (#35)', () => {
  it('attaches confidence_tier to every ranked entry using the default thresholds', () => {
    const entries: RankableEntry[] = [
      { id: 'x', similarity: 1, source: 'agent', timestampUtc: isoAgeDays(0) },
    ];
    // final_score = 0.6*1 + 0.3*1 + 0.1*1 = 1.0 -> "exact".
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW);
    expect(ranked[0]?.confidence_tier).toBe('exact');
  });

  it('honors custom confidence thresholds passed through rankResults', () => {
    const entries: RankableEntry[] = [{ id: 'x', similarity: 0.5, source: 'agent' }];
    // final_score for similarity=0.5, recency=0 (no timestamp), source=1.0 (agent):
    // 0.6*0.5 + 0.3*0 + 0.1*1.0 = 0.4
    const ranked = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW, '', 0.05, {
      exact: 0.9,
      high: 0.6,
      medium: 0.3,
    });
    expect(ranked[0]?.confidence_tier).toBe('medium');
  });

  it('does not change ordering or final_score based on confidence tiers (AC7)', () => {
    const entries: RankableEntry[] = [
      { id: 'a', similarity: 0.9, source: 'agent' },
      { id: 'b', similarity: 0.3, source: 'agent' },
    ];
    const withDefaultThresholds = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW);
    const withCustomThresholds = rankResults(entries, DEFAULT_RANKING_WEIGHTS, 90, NOW, '', 0.05, {
      exact: 0.99,
      high: 0.98,
      medium: 0.97,
    });
    expect(withDefaultThresholds.map((r) => r.id)).toEqual(withCustomThresholds.map((r) => r.id));
    expect(withDefaultThresholds.map((r) => r.final_score)).toEqual(
      withCustomThresholds.map((r) => r.final_score),
    );
  });
});
