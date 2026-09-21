import {
  computeJaccardOverlap,
  detectStaleness,
  DEFAULT_STALENESS_THRESHOLD_DAYS,
  DEFAULT_STALENESS_TAG_OVERLAP_THRESHOLD,
} from '../../../src/lib/staleness';
import type { StalenessCandidate, StalenessDetectionConfig } from '../../../src/lib/staleness';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-20T00:00:00Z');

function isoAgeDays(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

const DEFAULT_CONFIG: StalenessDetectionConfig = {
  staleness_threshold_days: DEFAULT_STALENESS_THRESHOLD_DAYS,
  staleness_tag_overlap_threshold: DEFAULT_STALENESS_TAG_OVERLAP_THRESHOLD,
};

describe('computeJaccardOverlap', () => {
  it('returns 1.0 for identical tag sets', () => {
    expect(computeJaccardOverlap(['auth', 'rate-limiting'], ['rate-limiting', 'auth'])).toBe(1);
  });

  it('returns 0.0 for disjoint tag sets', () => {
    expect(computeJaccardOverlap(['auth'], ['billing'])).toBe(0);
  });

  it('returns the intersection/union ratio for partial overlap', () => {
    // {a, b, c} vs {b, c, d} -> intersection {b, c} = 2, union {a, b, c, d} = 4 -> 0.5
    expect(computeJaccardOverlap(['a', 'b', 'c'], ['b', 'c', 'd'])).toBeCloseTo(0.5, 6);
  });

  it('returns 0.0 when only one side is empty', () => {
    expect(computeJaccardOverlap([], ['auth'])).toBe(0);
    expect(computeJaccardOverlap(['auth'], [])).toBe(0);
  });

  it('returns 0.0 when both sides are empty', () => {
    expect(computeJaccardOverlap([], [])).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(computeJaccardOverlap(['Auth'], ['auth'])).toBe(1);
  });

  it('treats missing/null/non-array tags as empty', () => {
    expect(computeJaccardOverlap(undefined, null)).toBe(0);
    expect(computeJaccardOverlap(undefined, ['auth'])).toBe(0);
  });

  it('ignores non-string tag entries', () => {
    expect(computeJaccardOverlap(['auth', 42, null], ['auth'])).toBe(1);
  });
});

describe('detectStaleness', () => {
  function candidate(
    id: string,
    ageDays: number,
    tags: string[] = ['auth', 'rate-limiting'],
  ): StalenessCandidate {
    return { id, timestampUtc: isoAgeDays(ageDays), tags };
  }

  it('flags older-with-overlapping-newer as stale (AC1)', () => {
    const target = candidate('old', 200);
    const newer = candidate('new', 10);
    const flags = detectStaleness([target], [target, newer], DEFAULT_CONFIG, NOW);
    expect(flags.get('old')).toBe('new');
  });

  it('does not flag older-with-non-overlapping-newer', () => {
    const target = candidate('old', 200, ['auth']);
    const newer = candidate('new', 10, ['billing']);
    const flags = detectStaleness([target], [target, newer], DEFAULT_CONFIG, NOW);
    expect(flags.has('old')).toBe(false);
  });

  it('does not flag an entry that is newer than everything in the corpus', () => {
    const target = candidate('new', 1);
    const older = candidate('old', 200);
    const flags = detectStaleness([target], [target, older], DEFAULT_CONFIG, NOW);
    expect(flags.has('new')).toBe(false);
  });

  it('flags when overlap is exactly at the threshold (>=)', () => {
    // {a, b} vs {a, c} -> intersection 1, union 3 -> overlap 1/3, use a
    // config threshold that lands exactly on that ratio.
    const target: StalenessCandidate = {
      id: 'old',
      timestampUtc: isoAgeDays(200),
      tags: ['a', 'b'],
    };
    const newer: StalenessCandidate = { id: 'new', timestampUtc: isoAgeDays(10), tags: ['a', 'c'] };
    const config: StalenessDetectionConfig = {
      staleness_threshold_days: 120,
      staleness_tag_overlap_threshold: 1 / 3,
    };
    const flags = detectStaleness([target], [target, newer], config, NOW);
    expect(flags.get('old')).toBe('new');
  });

  it('does not flag when age is exactly at the threshold (strict >)', () => {
    const target = candidate('old', 120);
    const newer = candidate('new', 10);
    const flags = detectStaleness([target], [target, newer], DEFAULT_CONFIG, NOW);
    expect(flags.has('old')).toBe(false);
  });

  it('flags when age is just past the threshold', () => {
    const target = candidate('old', 120.0001);
    const newer = candidate('new', 10);
    const flags = detectStaleness([target], [target, newer], DEFAULT_CONFIG, NOW);
    expect(flags.get('old')).toBe('new');
  });

  it('picks the newest superseder when multiple overlapping newer entries exist', () => {
    const target = candidate('old', 200);
    const newer1 = candidate('newer-1', 50);
    const newer2 = candidate('newer-2', 10);
    const flags = detectStaleness([target], [target, newer1, newer2], DEFAULT_CONFIG, NOW);
    expect(flags.get('old')).toBe('newer-2');
  });

  it('does not flag same-timestamp ties', () => {
    const sameTime = isoAgeDays(200);
    const target: StalenessCandidate = { id: 'old', timestampUtc: sameTime, tags: ['auth'] };
    const sameTimestampEntry: StalenessCandidate = {
      id: 'sibling',
      timestampUtc: sameTime,
      tags: ['auth'],
    };
    const flags = detectStaleness([target], [target, sameTimestampEntry], DEFAULT_CONFIG, NOW);
    expect(flags.has('old')).toBe(false);
  });

  it('never flags an entry as stale by itself', () => {
    const target = candidate('old', 200);
    const flags = detectStaleness([target], [target], DEFAULT_CONFIG, NOW);
    expect(flags.has('old')).toBe(false);
  });

  it('never throws and never flags on a malformed candidate timestamp', () => {
    const target: StalenessCandidate = { id: 'bad', timestampUtc: 'not-a-date', tags: ['auth'] };
    const newer = candidate('new', 1);
    expect(() => detectStaleness([target], [target, newer], DEFAULT_CONFIG, NOW)).not.toThrow();
    const flags = detectStaleness([target], [target, newer], DEFAULT_CONFIG, NOW);
    expect(flags.has('bad')).toBe(false);
  });

  it('ignores corpus entries with malformed timestamps as superseders', () => {
    const target = candidate('old', 200);
    const malformedNewer: StalenessCandidate = {
      id: 'malformed',
      timestampUtc: 'not-a-date',
      tags: ['auth', 'rate-limiting'],
    };
    const flags = detectStaleness([target], [target, malformedNewer], DEFAULT_CONFIG, NOW);
    expect(flags.has('old')).toBe(false);
  });

  it('never flags a superseder with no tags (AC9)', () => {
    const target = candidate('old', 200);
    const noTagsNewer: StalenessCandidate = {
      id: 'no-tags',
      timestampUtc: isoAgeDays(10),
      tags: [],
    };
    const config: StalenessDetectionConfig = {
      staleness_threshold_days: 120,
      staleness_tag_overlap_threshold: 0,
    };
    const flags = detectStaleness([target], [target, noTagsNewer], config, NOW);
    expect(flags.has('old')).toBe(false);
  });

  it('returns an empty map for an empty candidate list', () => {
    const flags = detectStaleness([], [], DEFAULT_CONFIG, NOW);
    expect(flags.size).toBe(0);
  });

  it('returns an empty map for an empty corpus', () => {
    const target = candidate('old', 200);
    const flags = detectStaleness([target], [], DEFAULT_CONFIG, NOW);
    expect(flags.size).toBe(0);
  });

  it('is pure - does not mutate its inputs', () => {
    const target = candidate('old', 200);
    const newer = candidate('new', 10);
    const candidatesCopy = [target];
    const corpusCopy = [target, newer];
    detectStaleness(candidatesCopy, corpusCopy, DEFAULT_CONFIG, NOW);
    expect(candidatesCopy).toEqual([target]);
    expect(corpusCopy).toEqual([target, newer]);
  });
});
