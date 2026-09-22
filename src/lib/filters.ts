import { DEFAULT_BANK_ID } from '../types/config.js';
import type { EntryKind } from '../types/entry.js';
import type { QdrantFilter } from './qdrant.js';

export interface BuildBaseFilterInput {
  bank: string;
  kind: EntryKind | 'all';
  /** Lifts the default `archived != true` exclusion. Default `false`. */
  includeArchived?: boolean;
  /** Lifts the default `superseded != true` exclusion. Default `false`. Implied `true` by `asOf`. */
  includeSuperseded?: boolean;
  /** ISO 8601 timestamp for point-in-time reads (spec §8.1). Implies `includeSuperseded`. */
  asOf?: string;
  session?: string;
}

type FilterClause = Record<string, unknown>;

/**
 * Builds the §8.1 bank/kind/state base filter shared by every read command
 * (PRD B1, R3; spec §8.1, §18.5). This is the one shared definition of
 * "which points a bank/kind/state combination is allowed to see" - no
 * downstream command or builder restates this shape.
 *
 * - `bank = 'kb'`: matches points whose `bank` field is explicitly `'kb'`
 *   *or* absent (pre-Phase-2 v1 points have no `bank` field and are
 *   implicitly `kb` - PRD B1). Any other bank: an exact match, no fallback.
 * - `kind = 'all'`: excludes `self` (`self` is opt-in only, PRD K4). Any
 *   specific kind: an exact match.
 * - Default exclusions: `archived != true` and `superseded != true`, each
 *   liftable independently via `includeArchived`/`includeSuperseded`.
 * - `session`: adds an exact `session_id` match, additive to every other
 *   clause.
 * - `asOf`: adds `valid_from <= asOf` plus a `should` group admitting
 *   points with no `valid_to` (still current) or `valid_to > asOf`
 *   (inclusive start, exclusive end). Implies `includeSuperseded = true` -
 *   a point-in-time read must be able to see what was superseded after
 *   `asOf`, and this implication cannot be overridden back off.
 */
export function buildBaseFilter(input: BuildBaseFilterInput): QdrantFilter {
  const must: FilterClause[] = [];
  const mustNot: FilterClause[] = [];
  const should: FilterClause[] = [];

  if (input.bank === DEFAULT_BANK_ID) {
    must.push({
      should: [{ key: 'bank', match: { value: DEFAULT_BANK_ID } }, { is_empty: { key: 'bank' } }],
    });
  } else {
    must.push({ key: 'bank', match: { value: input.bank } });
  }

  if (input.kind === 'all') {
    mustNot.push({ key: 'kind', match: { value: 'self' } });
  } else {
    must.push({ key: 'kind', match: { value: input.kind } });
  }

  const includeSuperseded = input.includeSuperseded === true || input.asOf !== undefined;
  const includeArchived = input.includeArchived === true;

  if (!includeArchived) {
    mustNot.push({ key: 'archived', match: { value: true } });
  }
  if (!includeSuperseded) {
    mustNot.push({ key: 'superseded', match: { value: true } });
  }

  if (input.session !== undefined) {
    must.push({ key: 'session_id', match: { value: input.session } });
  }

  if (input.asOf !== undefined) {
    must.push({ key: 'valid_from', range: { lte: input.asOf } });
    should.push({ is_empty: { key: 'valid_to' } }, { key: 'valid_to', range: { gt: input.asOf } });
  }

  return {
    ...(must.length > 0 ? { must } : {}),
    ...(mustNot.length > 0 ? { must_not: mustNot } : {}),
    ...(should.length > 0 ? { should } : {}),
  };
}

/**
 * Merges two Qdrant filters by concatenating `must`/`must_not`/`should`
 * arrays in `base`-then-`addition` order - never nesting one filter inside
 * the other (spec §8.1, §18.5, AC5). Never mutates either input; a key is
 * omitted from the result entirely when its concatenation is empty,
 * matching the existing builders' convention.
 */
export function mergeFilters(
  base: QdrantFilter | undefined,
  addition: QdrantFilter | undefined,
): QdrantFilter {
  const baseFilter = (base ?? {}) as {
    must?: FilterClause[];
    must_not?: FilterClause[];
    should?: FilterClause[];
  };
  const additionFilter = (addition ?? {}) as {
    must?: FilterClause[];
    must_not?: FilterClause[];
    should?: FilterClause[];
  };

  const must = [...(baseFilter.must ?? []), ...(additionFilter.must ?? [])];
  const mustNot = [...(baseFilter.must_not ?? []), ...(additionFilter.must_not ?? [])];
  const should = [...(baseFilter.should ?? []), ...(additionFilter.should ?? [])];

  return {
    ...(must.length > 0 ? { must } : {}),
    ...(mustNot.length > 0 ? { must_not: mustNot } : {}),
    ...(should.length > 0 ? { should } : {}),
  };
}
