/**
 * Staleness detection for `memo search` results (issue #38).
 *
 * Pure and side-effect free, mirroring `src/lib/ranking.ts`'s architecture
 * constraint: no I/O, no ambient clock reads - `now` is always an injected
 * parameter so callers and tests stay deterministic.
 *
 * A result is flagged stale (AC1) when both hold, same-repo only:
 *   - `age_in_days > staleness_threshold_days` (strict), and
 *   - a strictly *newer* entry in the corpus has Jaccard tag overlap
 *     `>= staleness_tag_overlap_threshold` with it.
 *
 * When flagged, the result carries `stale_by` = the id of the *newest*
 * qualifying superseder (AC2). Ties on `timestamp_utc` never supersede -
 * only strictly newer entries qualify. An entry is never marked stale by
 * itself. This is an annotation only (D-1: the output field is `stale_by`,
 * never `superseded_by` - see the task list's note on Phase 2's distinct,
 * stored `superseded_by` payload field) - it never changes `final_score` or
 * ordering (AC4).
 */

export interface StalenessDetectionConfig {
  staleness_threshold_days: number;
  staleness_tag_overlap_threshold: number;
}

/** Mirrors `src/types/config.ts`'s `DEFAULT_STALENESS_THRESHOLD_DAYS` (#38 AC1). */
export const DEFAULT_STALENESS_THRESHOLD_DAYS = 120;
/** Mirrors `src/types/config.ts`'s `DEFAULT_STALENESS_TAG_OVERLAP_THRESHOLD` (#38 AC1). */
export const DEFAULT_STALENESS_TAG_OVERLAP_THRESHOLD = 0.5;

export const DEFAULT_STALENESS_CONFIG: StalenessDetectionConfig = {
  staleness_threshold_days: DEFAULT_STALENESS_THRESHOLD_DAYS,
  staleness_tag_overlap_threshold: DEFAULT_STALENESS_TAG_OVERLAP_THRESHOLD,
};

/**
 * A single entry (either a ranked candidate or a corpus member fetched via
 * `QdrantRepository.fetchByRepo`) as seen by staleness detection. Both sides
 * of the comparison share this shape - a candidate can also appear as (or
 * alongside) a corpus member.
 */
export interface StalenessCandidate {
  id: string | number;
  timestampUtc?: string | null;
  tags?: readonly unknown[] | null;
}

/**
 * `candidateId` (stringified) -> the id of the newest qualifying superseder,
 * for every flagged candidate only. Non-stale candidates are never present
 * as keys (AC3: "omitted entirely", enforced by callers reading this map
 * with `.has`/`.get` rather than a boolean field).
 */
export type StalenessFlags = ReadonlyMap<string, string | number>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parses `timestamp_utc` to epoch milliseconds, or `null` when missing,
 * non-string, or unparseable - never throws. Duplicated (not imported) from
 * `ranking.ts`'s private helper of the same semantics, keeping this module
 * dependency-free per its pure-module contract.
 */
function parseTimestampMs(timestampUtc: string | null | undefined): number | null {
  if (typeof timestampUtc !== 'string' || timestampUtc.trim().length === 0) return null;
  const parsed = Date.parse(timestampUtc);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalizes a raw tag list to a lowercased, deduped `Set<string>`.
 * Non-string entries and missing/non-array input normalize to an empty set.
 */
function normalizeTags(tags: readonly unknown[] | null | undefined): Set<string> {
  const set = new Set<string>();
  if (!Array.isArray(tags)) return set;
  for (const tag of tags) {
    if (typeof tag === 'string' && tag.length > 0) set.add(tag.toLowerCase());
  }
  return set;
}

/**
 * Jaccard overlap of two tag sets: `|intersection| / |union|` (AC9).
 *
 * - Identical sets -> `1.0`.
 * - Disjoint sets -> `0.0`.
 * - Empty on one or both sides -> `0.0` (an entry with no tags is never a
 *   superseder, since `0` never meets a `>= threshold` check unless the
 *   configured threshold is itself `0`, at which point every entry
 *   qualifies purely on age - a caller's explicit choice, not a bug here).
 */
export function computeJaccardOverlap(
  a: readonly unknown[] | null | undefined,
  b: readonly unknown[] | null | undefined,
): number {
  const setA = normalizeTags(a);
  const setB = normalizeTags(b);
  if (setA.size === 0 && setB.size === 0) return 0;

  let intersectionSize = 0;
  for (const tag of setA) {
    if (setB.has(tag)) intersectionSize += 1;
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  if (unionSize === 0) return 0;
  return intersectionSize / unionSize;
}

/**
 * Flags every candidate whose age exceeds `staleness_threshold_days` and
 * that has at least one strictly newer, same-corpus entry with tag overlap
 * `>= staleness_tag_overlap_threshold` (AC1). When several entries qualify,
 * the newest one wins (AC2's business rule). Corpus entries are expected to
 * already be scoped to the candidates' repo(s) by the caller (AC6) - this
 * function does no repo filtering itself, staying pure and I/O-free.
 *
 * Called once per `memo search` invocation over the full candidate/corpus
 * sets (AC5), not per candidate - this is a batch function, not a
 * per-candidate one.
 */
export function detectStaleness(
  candidates: readonly StalenessCandidate[],
  corpus: readonly StalenessCandidate[],
  config: StalenessDetectionConfig = DEFAULT_STALENESS_CONFIG,
  now: number = Date.now(),
): StalenessFlags {
  const flags = new Map<string, string | number>();

  for (const candidate of candidates) {
    const candidateMs = parseTimestampMs(candidate.timestampUtc);
    // Malformed/missing timestamp: age can't be computed - never stale,
    // never throws.
    if (candidateMs === null) continue;

    const ageDays = (now - candidateMs) / MS_PER_DAY;
    if (!(ageDays > config.staleness_threshold_days)) continue;

    let bestSuperseder: { id: string | number; ms: number } | null = null;
    for (const entry of corpus) {
      if (String(entry.id) === String(candidate.id)) continue; // never stale by itself

      const entryMs = parseTimestampMs(entry.timestampUtc);
      if (entryMs === null) continue; // malformed corpus timestamp: never a superseder
      if (!(entryMs > candidateMs)) continue; // strictly newer only; ties never supersede
      // AC9: an entry with no tags is never a superseder, even when the
      // configured overlap threshold is `0` (at which point Jaccard's
      // empty-on-one-side `0` would otherwise satisfy `>= 0`).
      if (normalizeTags(entry.tags).size === 0) continue;

      const overlap = computeJaccardOverlap(candidate.tags, entry.tags);
      if (overlap < config.staleness_tag_overlap_threshold) continue;

      if (bestSuperseder === null || entryMs > bestSuperseder.ms) {
        bestSuperseder = { id: entry.id, ms: entryMs };
      }
    }

    if (bestSuperseder !== null) {
      flags.set(String(candidate.id), bestSuperseder.id);
    }
  }

  return flags;
}
