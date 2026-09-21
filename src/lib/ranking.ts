/**
 * Composite ranking score for `memo search` results (issue #34).
 *
 * Pure and side-effect free per the binding refinement's Architecture
 * constraint: no I/O, no clock reads inside the scoring functions. `now` is
 * always an injected parameter (defaulting to `Date.now()`) so callers and
 * tests stay deterministic without fake timers.
 *
 * Implements only the `similarity` / `recency` / `source` signals of the
 * PRD §8.2 unified ranking formula. `tag_boost`, `lexical_boost`, and the
 * multiplicative retention/use-ratio/link factors belong to later stories
 * (#36, FR-1.3, #54, #55, #56); this module exposes neutral defaults for
 * them (0 for additive boosts, 1 for multiplicative factors) so `rankResults`
 * already has the extension point those stories will fill in, per PRD §8.2:
 * "Factors not yet implemented ... evaluate to their neutral value so every
 * phase ships independently."
 */

export interface RankingWeights {
  w_similarity: number;
  w_recency: number;
  w_source: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  w_similarity: 0.6,
  w_recency: 0.3,
  w_source: 0.1,
};

export const DEFAULT_RECENCY_HALF_LIFE_DAYS = 90;

const KNOWN_SOURCE_SCORES: Record<string, number> = {
  agent: 1.0,
  manual: 0.8,
  scan: 0.5,
};

/** Default for unknown, missing, or malformed `source` values (D5). */
const UNKNOWN_SOURCE_SCORE = 0.5;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Parses `timestamp_utc` to epoch milliseconds, or `null` when missing,
 * non-string, or unparseable (D4). Absolute-UTC parsing via `Date.parse`
 * means results are independent of the host's timezone/DST (EC-7).
 */
function parseTimestampMs(timestampUtc: string | null | undefined): number | null {
  if (typeof timestampUtc !== 'string' || timestampUtc.trim().length === 0) return null;
  const parsed = Date.parse(timestampUtc);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Exponential recency decay: `0.5 ** (ageDays / halfLifeDays)`.
 *
 * - Missing or unparseable `timestamp_utc` -> `0` (D4).
 * - Future timestamps (clock skew) -> negative age is clamped to `0`, so the
 *   score clamps to `1.0` rather than exceeding it (R4).
 * - Result is always clamped to `[0, 1]` as a final guard against float
 *   underflow/edge cases.
 */
export function computeRecencyScore(
  timestampUtc: string | null | undefined,
  now: number = Date.now(),
  halfLifeDays: number = DEFAULT_RECENCY_HALF_LIFE_DAYS,
): number {
  const parsedMs = parseTimestampMs(timestampUtc);
  if (parsedMs === null) return 0;
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 0;

  const ageDays = Math.max(0, (now - parsedMs) / (1000 * 60 * 60 * 24));
  const score = Math.pow(0.5, ageDays / halfLifeDays);
  return clamp01(score);
}

/**
 * Maps `source` to its reliability tier. Unknown, missing, wrong-cased, or
 * hostile-typed values all default to `0.5` (D5) - this function never
 * throws.
 */
export function computeSourceScore(source: unknown): number {
  if (typeof source !== 'string') return UNKNOWN_SOURCE_SCORE;
  return KNOWN_SOURCE_SCORES[source] ?? UNKNOWN_SOURCE_SCORE;
}

export interface RankingFactors {
  similarity: number;
  recencyScore: number;
  sourceScore: number;
  /** Additive boost from tag overlap (#36). Neutral default: `0`. */
  tagBoost?: number;
  /** Additive boost from lexical matching (FR-1.3). Neutral default: `0`. */
  lexicalBoost?: number;
  /** Multiplicative retention factor (#54). Neutral default: `1`. */
  retentionFactor?: number;
  /** Multiplicative use-ratio factor (#55). Neutral default: `1`. */
  useRatioFactor?: number;
  /** Multiplicative link factor (#56). Neutral default: `1`. */
  linkFactor?: number;
}

/**
 * Composes the final score from its component signals.
 *
 * `similarity` is clamped to `[0, 1]` before compositing (D8) because cosine
 * distance can theoretically return a negative value. The result is always
 * within `[0, 1]` inclusive (AC4).
 */
export function computeCompositeScore(
  factors: RankingFactors,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): number {
  const similarity = clamp01(factors.similarity);
  const recencyScore = clamp01(factors.recencyScore);
  const sourceScore = clamp01(factors.sourceScore);

  const base =
    weights.w_similarity * similarity +
    weights.w_recency * recencyScore +
    weights.w_source * sourceScore;

  const boosted = Math.min(1, base + (factors.tagBoost ?? 0) + (factors.lexicalBoost ?? 0));
  const multiplier =
    (factors.retentionFactor ?? 1) * (factors.useRatioFactor ?? 1) * (factors.linkFactor ?? 1);

  return clamp01(boosted * multiplier);
}

export interface RankableEntry {
  id: string | number;
  /** Raw similarity score as returned by the vector store, pre-clamp. */
  similarity: number;
  timestampUtc?: string | null;
  source?: unknown;
}

export type RankedEntry<T extends RankableEntry = RankableEntry> = T & {
  final_score: number;
  recency_score: number;
  source_score: number;
};

function compareIds(a: string | number, b: string | number): number {
  const aStr = String(a);
  const bStr = String(b);
  if (aStr === bStr) return 0;
  return aStr < bStr ? -1 : 1;
}

/**
 * Stable tiebreak per R9: `final_score` desc, then `timestamp_utc` desc,
 * then `id` asc. When neither entry has a valid `timestamp_utc` (EC-10), the
 * chain falls straight through to the `id` comparison so ordering never
 * depends on the store's return order.
 */
function compareRanked(a: RankedEntry, b: RankedEntry): number {
  if (b.final_score !== a.final_score) return b.final_score - a.final_score;

  const aTime = parseTimestampMs(a.timestampUtc);
  const bTime = parseTimestampMs(b.timestampUtc);

  if (aTime !== null && bTime !== null && aTime !== bTime) return bTime - aTime;
  if (aTime !== null && bTime === null) return -1;
  if (aTime === null && bTime !== null) return 1;

  return compareIds(a.id, b.id);
}

/**
 * Scores and orders candidates by `final_score` descending.
 *
 * Pure: no I/O, no ambient clock reads. Returns a new array; the input is
 * never mutated. Ranking never drops entries - the output is always a
 * permutation of the input, same length, by `id` (RT-2).
 */
export function rankResults<T extends RankableEntry>(
  entries: readonly T[],
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
  recencyHalfLifeDays: number = DEFAULT_RECENCY_HALF_LIFE_DAYS,
  now: number = Date.now(),
): RankedEntry<T>[] {
  const scored: RankedEntry<T>[] = entries.map((entry) => {
    const recency_score = computeRecencyScore(entry.timestampUtc, now, recencyHalfLifeDays);
    const source_score = computeSourceScore(entry.source);
    const final_score = computeCompositeScore(
      { similarity: entry.similarity, recencyScore: recency_score, sourceScore: source_score },
      weights,
    );
    return { ...entry, final_score, recency_score, source_score };
  });

  return scored.sort(compareRanked);
}
