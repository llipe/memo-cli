/**
 * Composite ranking score for `memo search` results (issue #34, #36).
 *
 * Pure and side-effect free per the binding refinement's Architecture
 * constraint: no I/O, no clock reads inside the scoring functions. `now` is
 * always an injected parameter (defaulting to `Date.now()`) so callers and
 * tests stay deterministic without fake timers.
 *
 * Implements the `similarity` / `recency` / `source` signals of the PRD
 * §8.2 unified ranking formula, plus the `tag_boost` additive signal (#36).
 * `lexical_boost`, and the multiplicative retention/use-ratio/link factors
 * belong to later stories (FR-1.3, #54, #55, #56); this module exposes
 * neutral defaults for them (0 for additive boosts, 1 for multiplicative
 * factors) so `rankResults` already has the extension point those stories
 * will fill in, per PRD §8.2: "Factors not yet implemented ... evaluate to
 * their neutral value so every phase ships independently."
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

/**
 * Tuned per the task 8.0 exit-gate methodology (`workstream/tasks-prd-004-phase-1-plan.md`
 * §8.3-8.4), applied to this story after AC21's relevance replay failed at
 * the spec-documented `90` (85.7% vs the 92.9% S1-01 floor). A one-factor
 * sweep over `recency_half_life_days` at the unchanged spec weights
 * (0.6/0.3/0.1) found a wide, robust plateau (every value from ~260 to 700+
 * days measured 96.4% against the fixture set) — `365` is the simplest,
 * most legible value inside that plateau, well clear of its edges. Weights
 * were intentionally left untouched; see PR #67 for the full sweep results.
 */
export const DEFAULT_RECENCY_HALF_LIFE_DAYS = 365;

/**
 * Default `tag_boost_factor` per AC1 (#36): `0.05`. `0` disables tag
 * boosting entirely (AC2).
 */
export const DEFAULT_TAG_BOOST_FACTOR = 0.05;

/**
 * Fixed stopword list excluded from `total_query_terms` (AC3). Not
 * configurable - the story's binding scope is a fixed list only.
 */
const TAG_BOOST_STOPWORDS = new Set(['a', 'the', 'is', 'for', 'of', 'in', 'to', 'with']);

/**
 * Strips leading/trailing punctuation/symbols (but not internal hyphens, so
 * kebab-case tokens like `rate-limiting` stay intact) from a single term,
 * unicode-aware so accented query terms (`café`) normalize correctly.
 */
function stripPunctuation(term: string): string {
  return term.replace(/^[^\p{L}\p{N}-]+|[^\p{L}\p{N}-]+$/gu, '');
}

/**
 * Tokenizes and normalizes a raw query string into its non-stopword terms,
 * lowercased, with duplicates preserved (order does not matter to the
 * caller; only length and membership do). Called once per `rankResults`
 * invocation (#36 task 3.3), never per candidate.
 *
 * Missing/non-string/whitespace-only queries normalize to `[]` (AC6): no
 * term list means `computeTagBoost`'s `total_query_terms` is `0`, which
 * short-circuits to a `0` boost before any division happens.
 */
export function normalizeQueryTerms(query: string | null | undefined): string[] {
  if (typeof query !== 'string') return [];
  return query
    .split(/\s+/)
    .map((term) => stripPunctuation(term.toLowerCase()))
    .filter((term) => term.length > 0 && !TAG_BOOST_STOPWORDS.has(term));
}

/**
 * Core tag-boost computation given an already-normalized query term set
 * (built once per `rankResults` invocation) and a candidate's raw tags.
 *
 * `matched_tags` counts distinct tags (case-insensitive) that appear as a
 * whole query term; `total_query_terms` is the normalized query's length.
 * Because every matched tag must appear in `queryTerms`, `matched_tags` can
 * never exceed `queryTerms.size` - the resulting ratio is always `<= 1`, so
 * `tag_boost` is always `<= factor` (D-analogous to AC5's cap, enforced
 * again downstream by `computeCompositeScore`'s `min(1, ...)`).
 */
function computeTagBoostFromTerms(
  queryTerms: ReadonlySet<string>,
  totalQueryTerms: number,
  tags: readonly unknown[] | null | undefined,
  factor: number,
): number {
  if (!Number.isFinite(factor) || factor <= 0) return 0;
  if (totalQueryTerms === 0) return 0;
  if (!Array.isArray(tags) || tags.length === 0) return 0;

  let matched = 0;
  const seen = new Set<string>();
  for (const rawTag of tags) {
    if (typeof rawTag !== 'string') continue;
    const tag = rawTag.toLowerCase();
    if (seen.has(tag)) continue;
    seen.add(tag);
    if (queryTerms.has(tag)) matched += 1;
  }

  return (matched / totalQueryTerms) * factor;
}

/**
 * `tag_boost = matched_tags / total_query_terms * boost_factor` (AC1).
 *
 * Convenience wrapper around `computeTagBoostFromTerms` that normalizes
 * `query` itself; unit-tested directly, but `rankResults` calls
 * `normalizeQueryTerms` once per invocation and reuses the result across
 * every candidate instead of calling this function per entry (#36 task
 * 3.3).
 */
export function computeTagBoost(
  query: string | null | undefined,
  tags: readonly unknown[] | null | undefined,
  factor: number = DEFAULT_TAG_BOOST_FACTOR,
): number {
  const terms = normalizeQueryTerms(query);
  return computeTagBoostFromTerms(new Set(terms), terms.length, tags, factor);
}

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
  /** Raw tags used by the #36 tag-overlap boost when `tagBoost` is not pre-supplied. */
  tags?: readonly unknown[];
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
 * The resolved factor bag attached to every ranked entry (issue #34's
 * "Added acceptance criteria" AC19). Every factor this story does not
 * implement resolves to its documented neutral value (`0` for additive
 * boosts, `1` for multiplicative factors) so `rankResults`'s output shape
 * never changes again once #36/#54/#55/#56 start supplying real values.
 */
export interface ResolvedFactors {
  tag_boost: number;
  lexical_boost: number;
  retention_factor: number;
  use_ratio_factor: number;
  link_factor: number;
}

export type RankedEntry<T extends RankableEntry = RankableEntry> = T & {
  final_score: number;
  recency_score: number;
  source_score: number;
  factors: ResolvedFactors;
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
 *
 * `query` and `tagBoostFactor` (#36) drive `computeTagBoost` for every
 * candidate whose `tagBoost` is not explicitly pre-supplied; `query` is
 * normalized exactly once per call, not per candidate (task 3.3). Passing
 * no `query` (the default) keeps every entry's `tag_boost` at its neutral
 * `0`, so existing callers that only pass the first four positional
 * arguments are unaffected.
 */
export function rankResults<T extends RankableEntry>(
  entries: readonly T[],
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
  recencyHalfLifeDays: number = DEFAULT_RECENCY_HALF_LIFE_DAYS,
  now: number = Date.now(),
  query: string | null | undefined = '',
  tagBoostFactor: number = DEFAULT_TAG_BOOST_FACTOR,
): RankedEntry<T>[] {
  // Normalized once per invocation, not per candidate (#36 task 3.3).
  const queryTermsList = normalizeQueryTerms(query);
  const queryTerms = new Set(queryTermsList);
  const totalQueryTerms = queryTermsList.length;

  const scored: RankedEntry<T>[] = entries.map((entry) => {
    const recency_score = computeRecencyScore(entry.timestampUtc, now, recencyHalfLifeDays);
    const source_score = computeSourceScore(entry.source);
    const factors: ResolvedFactors = {
      tag_boost:
        entry.tagBoost ??
        computeTagBoostFromTerms(queryTerms, totalQueryTerms, entry.tags, tagBoostFactor),
      lexical_boost: entry.lexicalBoost ?? 0,
      retention_factor: entry.retentionFactor ?? 1,
      use_ratio_factor: entry.useRatioFactor ?? 1,
      link_factor: entry.linkFactor ?? 1,
    };
    const final_score = computeCompositeScore(
      {
        similarity: entry.similarity,
        recencyScore: recency_score,
        sourceScore: source_score,
        tagBoost: factors.tag_boost,
        lexicalBoost: factors.lexical_boost,
        retentionFactor: factors.retention_factor,
        useRatioFactor: factors.use_ratio_factor,
        linkFactor: factors.link_factor,
      },
      weights,
    );
    return { ...entry, final_score, recency_score, source_score, factors };
  });

  return scored.sort(compareRanked);
}
