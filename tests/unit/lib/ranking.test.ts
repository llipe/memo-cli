import {
  computeRecencyScore,
  computeSourceScore,
  computeCompositeScore,
  rankResults,
  DEFAULT_RANKING_WEIGHTS,
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
