import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { debugLog } from '../lib/debug.js';
import { createEmbeddingsAdapter } from '../lib/embeddings.js';
import { normalizeEntry, projectV2Fields } from '../lib/entry-normalize.js';
import { MemoError } from '../lib/errors.js';
import { buildBaseFilter, mergeFilters } from '../lib/filters.js';
import { cosine, computeLexicalBoost, extractIdentifierTokens } from '../lib/lexical.js';
import { output } from '../lib/output.js';
import type { ExplainFactors, UnrankedSearchHumanResult } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';
import { parseReadFlags } from '../lib/read-flags.js';
import type { RawReadFlags } from '../lib/read-flags.js';
import { resolveScopeRepos } from '../lib/registry.js';
import { buildSearchFilters } from '../lib/search-filters.js';
import {
  rankResults,
  DEFAULT_RANKING_WEIGHTS,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
  DEFAULT_TAG_BOOST_FACTOR,
  DEFAULT_CONFIDENCE_THRESHOLDS,
  DEFAULT_LEXICAL_BOOST_FACTOR,
} from '../lib/ranking.js';
import type { RankableEntry, ResolvedFactors, ConfidenceTier } from '../lib/ranking.js';
import {
  detectStaleness,
  DEFAULT_STALENESS_THRESHOLD_DAYS,
  DEFAULT_STALENESS_TAG_OVERLAP_THRESHOLD,
} from '../lib/staleness.js';
import type { StalenessCandidate } from '../lib/staleness.js';
import { DEFAULT_BANK_ID } from '../types/config.js';
import type { MemoConfig } from '../types/config.js';
import type { QdrantFilter, SearchResult, ScrollResult } from '../lib/qdrant.js';

/**
 * Default `lexical` enablement (#62 AC7) when neither `--lexical` nor
 * `ranking.lexical` is supplied.
 */
const DEFAULT_LEXICAL_ENABLED = true;

/** Bound on the #62 lexical scroll (AC4): 50 candidates, same as its own overfetch ceiling. */
const LEXICAL_SCROLL_LIMIT = 50;

/**
 * Maximum candidates fetched from Qdrant before ranking and slicing back
 * down to `--limit` (D2). The outer `max` prevents under-fetching when
 * `--limit` exceeds 50, at the cost of the `min(..., 50)` cap not binding
 * above that point (see the binding refinement's D2 rationale and the
 * `verifier` Design Mode test plan's F-1 finding, which flags but does not
 * override this as the intended behavior for this story).
 */
export function computeOverfetchLimit(limit: number): number {
  return Math.max(limit, Math.min(limit * 3, 50));
}

export interface SearchFlags extends RawReadFlags {
  query: string;
  scope?: string;
  repo?: string;
  org?: string;
  tags?: string;
  entryType?: string;
  source?: string;
  limit?: string | number;
  lexical?: string;
  explain?: boolean;
  json?: boolean;
}

export interface SearchDeps {
  loadCfg?: typeof loadConfig;
  createRepo?: (url?: string, key?: string) => QdrantRepository;
  createEmbeddings?: typeof createEmbeddingsAdapter;
  resolveRepos?: typeof resolveScopeRepos;
}

export interface SearchResponseFilters {
  scope: 'repo' | 'related';
  repo: string;
  bank: string;
  kind: string;
  session?: string;
  as_of?: string;
  org?: string;
  tags?: string[];
  entry_type?: string[];
  source?: string[];
  limit: number;
}

function parseCsv(value?: string): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ];
}

function parseScope(value: string | undefined, config?: MemoConfig | null): 'repo' | 'related' {
  const scope = value ?? config?.defaults.search_scope ?? 'repo';
  if (scope !== 'repo' && scope !== 'related') {
    throw new MemoError(
      'VALIDATION_FAILED',
      `Invalid --scope value "${scope}". Use repo or related.`,
    );
  }
  return scope;
}

/**
 * `--lexical <on|off>` (#62 AC7): explicit `--lexical` wins over
 * `ranking.lexical`, which wins over the documented default (`true`).
 * Mirrors `parseScope`'s validation pattern - an unrecognized value is a
 * user error (VALIDATION_FAILED), not a silent fallback.
 */
function parseLexicalFlag(
  value: string | undefined,
  rankingConfig?: MemoConfig['ranking'],
): boolean {
  if (value === undefined) return rankingConfig?.lexical ?? DEFAULT_LEXICAL_ENABLED;
  if (value !== 'on' && value !== 'off') {
    throw new MemoError('VALIDATION_FAILED', `Invalid --lexical value "${value}". Use on or off.`);
  }
  return value === 'on';
}

/**
 * Builds the one extra #62 scroll's filter (AC4): the same pre-filters as
 * the dense query, nested under `must` alongside a `min_should: 1` group
 * containing a `rationale`/`files_modified` text-match condition per
 * identifier. Nesting (rather than merging into a shared top-level `should`)
 * keeps this independent of `buildSearchFilters`'s own `should` usage for
 * `--scope related`'s repo OR-match (search-filters.ts), so the two never
 * collapse into a single min_should group with the wrong semantics.
 */
export function buildLexicalScrollFilter(
  baseFilters: QdrantFilter,
  identifiers: readonly string[],
): QdrantFilter {
  const clauses: Record<string, unknown>[] = [];
  for (const identifier of identifiers) {
    clauses.push({ key: 'rationale', match: { text: identifier } });
    clauses.push({ key: 'files_modified', match: { text: identifier } });
  }

  const nestedBase = Object.keys(baseFilters ?? {}).length > 0 ? [baseFilters] : [];

  return {
    must: [...nestedBase, { min_should: { conditions: clauses, min_count: 1 } }],
  };
}

function parseLimit(value: string | number | undefined): number {
  if (value === undefined) return 10;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new MemoError('VALIDATION_FAILED', '--limit must be a positive integer.');
  }
  return parsed;
}

export function buildSearchVectorInput(query: string, tags: string[]): string {
  return tags.length > 0 ? `${query} ${tags.join(' ')}` : query;
}

function buildActiveFilters(filters: SearchResponseFilters, repoSet: string[]): string[] {
  const values = [`scope:${filters.scope}`, `repo:${repoSet.join(',')}`];
  if (filters.org) values.push(`org:${filters.org}`);
  if (filters.tags && filters.tags.length > 0) values.push(`tags:${filters.tags.join(',')}`);
  if (filters.entry_type && filters.entry_type.length > 0) {
    values.push(`entry_type:${filters.entry_type.join(',')}`);
  }
  if (filters.source && filters.source.length > 0) {
    values.push(`source:${filters.source.join(',')}`);
  }
  values.push(`limit:${String(filters.limit)}`);
  return values;
}

interface SearchRankInput extends RankableEntry {
  payload?: Record<string, unknown>;
}

type RankedSearchResult = SearchRankInput & {
  final_score: number;
  recency_score: number;
  source_score: number;
  factors: ResolvedFactors;
  confidence_tier: ConfidenceTier;
};

/**
 * #35 AC4: the stored, write-path `confidence` field is dropped from every
 * `memo search` projection (both `--json` and human output) while it stays
 * untouched in `memo read`/`memo list`/`memo write` - this is the one
 * output removal in Phase 1. `confidence_tier` (derived, per-query) is the
 * replacement signal.
 */
function omitStoredConfidence(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!payload) return {};
  const { confidence: _confidence, ...rest } = payload;
  return rest;
}

function toRankableEntry(result: SearchResult): SearchRankInput {
  const payload = result.payload;
  const timestampUtc =
    typeof payload?.['timestamp_utc'] === 'string' ? payload['timestamp_utc'] : undefined;
  const rawTags = payload?.['tags'];
  const tags = Array.isArray(rawTags) ? rawTags : undefined;
  return {
    id: result.id,
    similarity: result.score,
    timestampUtc,
    source: payload?.['source'],
    tags,
    payload,
  };
}

/** A ranked result with its optional staleness annotation attached (#38 D-1). */
type StaleAnnotated<T> = T & { stale?: true; stale_by?: string | number };

/**
 * Projects a ranked result into the `--explain` factor bag (#63 AC5, AC8).
 * `retention`, `use_ratio`, and `link_factor` are hardcoded to their
 * documented neutral values rather than read from `result.factors` -
 * `ResolvedFactors`'s `retention_factor`/`use_ratio_factor`/`link_factor`
 * are the *multiplicative* neutral (`1`), but the spec's `--explain`
 * contract calls for the *raw metric* neutral (`retention` 1.0, `use_ratio`
 * 0, `link_factor` 1.0) - these three stay unimplemented until Phase 3
 * (#54-#56), so the explicit literals here are the contract, not a
 * derivation.
 */
function buildExplainFactors(result: RankedSearchResult): ExplainFactors {
  return {
    similarity: result.similarity,
    recency_score: result.recency_score,
    source_score: result.source_score,
    tag_boost: result.factors.tag_boost,
    lexical_boost: result.factors.lexical_boost,
    retention: 1.0,
    use_ratio: 0,
    link_factor: 1.0,
    final_score: result.final_score,
  };
}

function toJsonResult(
  result: StaleAnnotated<RankedSearchResult>,
  explain: boolean,
): Record<string, unknown> {
  return {
    id: result.id,
    ...omitStoredConfidence(result.payload),
    // S2-05 AC8: additive-only v2 fields (bank/kind always; the rest only
    // when present/true on the source entry).
    ...projectV2Fields(normalizeEntry(result.payload ?? {})),
    similarity: result.similarity,
    final_score: result.final_score,
    recency_score: result.recency_score,
    source_score: result.source_score,
    // #36 AC4: tag_boost is surfaced explicitly (not the full factor bag)
    // since it is the only additive/multiplicative factor this story wires
    // through to a real query outside of --explain; the full bag (including
    // lexical_boost/retention/use_ratio/link_factor) is only ever added via
    // #63's `factors` projection below.
    tag_boost: result.factors.tag_boost,
    // #35 AC3/AC4: confidence_tier replaces the removed static `confidence`.
    confidence_tier: result.confidence_tier,
    // #38 AC3: `stale`/`stale_by` are omitted entirely (not `false`/`null`)
    // when the result is not flagged - never spread an `undefined` value in.
    ...(result.stale ? { stale: true as const, stale_by: result.stale_by } : {}),
    // #63 AC5: `factors` is additive-only, present exclusively under --explain.
    ...(explain ? { factors: buildExplainFactors(result) } : {}),
  };
}

/** Maps a `fetchStalenessCorpus` scroll result into staleness detection's input shape (#38 AC5/AC6). */
function toStalenessCandidate(result: ScrollResult): StalenessCandidate {
  const payload = result.payload;
  const timestampUtc =
    typeof payload?.['timestamp_utc'] === 'string' ? payload['timestamp_utc'] : undefined;
  const rawTags = payload?.['tags'];
  const tags = Array.isArray(rawTags) ? rawTags : undefined;
  return { id: result.id, timestampUtc, tags };
}

/**
 * `--kind self` JSON projection (S2-05 AC5): the same payload/v2-field
 * shape as a ranked result, minus every ranking-derived field
 * (`similarity`/`final_score`/`recency_score`/`source_score`/`tag_boost`/
 * `confidence_tier`) - `self` never enters `rankResults`, so there is
 * nothing to project for those keys.
 */
function toSelfJsonResult(result: ScrollResult): Record<string, unknown> {
  return {
    id: result.id,
    ...omitStoredConfidence(result.payload),
    ...projectV2Fields(normalizeEntry(result.payload ?? {})),
  };
}

/** `--kind self` human projection (S2-05 AC5/AC6): typed field extraction, no ranking fields. */
function toUnrankedHumanResult(result: ScrollResult): UnrankedSearchHumanResult {
  const payload = result.payload ?? {};
  const normalized = normalizeEntry(payload);
  const rawTags = payload['tags'];
  return {
    id: result.id,
    ...(typeof payload['repo'] === 'string' ? { repo: payload['repo'] } : {}),
    ...(typeof payload['rationale'] === 'string' ? { rationale: payload['rationale'] } : {}),
    ...(typeof payload['entry_type'] === 'string' ? { entry_type: payload['entry_type'] } : {}),
    ...(typeof payload['source'] === 'string' ? { source: payload['source'] } : {}),
    ...(typeof payload['org'] === 'string' ? { org: payload['org'] } : {}),
    ...(Array.isArray(rawTags) ? { tags: rawTags } : {}),
    ...(typeof payload['story'] === 'string' ? { story: payload['story'] } : {}),
    ...(typeof payload['commit'] === 'string' ? { commit: payload['commit'] } : {}),
    ...(typeof payload['timestamp_utc'] === 'string'
      ? { timestamp_utc: payload['timestamp_utc'] }
      : {}),
    ...(normalized.archived ? { archived: true as const } : {}),
    ...(normalized.superseded ? { superseded: true as const } : {}),
  };
}

export async function handleSearch(flags: SearchFlags, deps: SearchDeps = {}): Promise<void> {
  const {
    loadCfg = loadConfig,
    createRepo = (url, key) => new QdrantRepository(url, key),
    createEmbeddings = createEmbeddingsAdapter,
    resolveRepos = resolveScopeRepos,
  } = deps;

  // #63 AC1/AC2: a fresh, purely local (no I/O) correlation id per
  // invocation. Inert in Phase 1 - never persisted, never read back (AC3).
  const queryId = randomUUID();
  const explain = flags.explain === true;

  // Only a missing config is tolerated (the caller may supply --repo instead).
  // An invalid config - including invalid `ranking` weights - MUST fail fast
  // with CONFIG_INVALID rather than silently falling back to defaults (D7,
  // AC12): a config that exists but does not parse is a user error the agent
  // should see, not a state indistinguishable from "no config at all".
  const config = await loadCfg().catch((err: unknown) => {
    if (err instanceof MemoError && err.code === 'CONFIG_NOT_FOUND') {
      return null;
    }
    throw err;
  });

  const repo = flags.repo ?? config?.repo;
  if (!repo) {
    throw new MemoError(
      'REPO_CONTEXT_UNRESOLVED',
      'Could not resolve repo context. Provide --repo or run `memo setup init`.',
    );
  }

  const scope = parseScope(flags.scope, config);
  const org = flags.org ?? config?.org;
  const tags = parseCsv(flags.tags);
  const entryTypes = parseCsv(flags.entryType);
  const sources = parseCsv(flags.source);
  const limit = parseLimit(flags.limit);

  // S2-05 AC1/AC4: the shared read-side flags, validated once, and the one
  // `base` filter shared by the dense query, the lexical scroll, and the
  // staleness corpus below - no downstream code path builds its own copy of
  // the bank/kind/state predicate.
  const readFlags = parseReadFlags(
    {
      bank: flags.bank,
      kind: flags.kind,
      session: flags.session,
      includeArchived: flags.includeArchived,
      includeSuperseded: flags.includeSuperseded,
      asOf: flags.asOf,
    },
    process.env,
    config ?? undefined,
  );
  const base = buildBaseFilter({
    bank: readFlags.bank,
    kind: readFlags.kind,
    includeArchived: readFlags.includeArchived,
    includeSuperseded: readFlags.includeSuperseded,
    ...(readFlags.session !== undefined ? { session: readFlags.session } : {}),
    ...(readFlags.asOf !== undefined ? { asOf: readFlags.asOf } : {}),
  });

  const resolvedRepos = resolveRepos({ repo, scope, config });
  const filters = buildSearchFilters(
    {
      repo,
      scope,
      relatedRepos: resolvedRepos.filter((candidate) => candidate !== repo),
      org,
      tags,
      entryTypes,
      sources,
      bank: readFlags.bank,
      explicitRepo: flags.repo !== undefined,
    },
    base,
  );

  const responseFilters: SearchResponseFilters = {
    scope,
    repo,
    bank: readFlags.bank,
    kind: readFlags.kind,
    ...(readFlags.session !== undefined ? { session: readFlags.session } : {}),
    ...(readFlags.asOf !== undefined ? { as_of: readFlags.asOf } : {}),
    ...(org ? { org } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(entryTypes.length > 0 ? { entry_type: entryTypes } : {}),
    ...(sources.length > 0 ? { source: sources } : {}),
    limit,
  };

  const repoUrl = process.env['QDRANT_URL'];
  const repoKey = process.env['QDRANT_API_KEY'];
  const qdrant = createRepo(repoUrl, repoKey);

  await qdrant.ensureCollection();

  // S2-05 AC5: `--kind self` is a distinct, unranked path - no embeddings
  // call, no dense/lexical scroll, no staleness corpus. `self` entries never
  // enter `rankResults` in any mode (this is the only mode that can return
  // them at all).
  if (readFlags.kind === 'self') {
    const selfResults = await qdrant.scroll(filters, limit);

    if (flags.json) {
      const jsonResults = selfResults.map(toSelfJsonResult);
      output.result(
        {
          query: flags.query,
          query_id: queryId,
          filters: responseFilters,
          results: jsonResults,
          count: jsonResults.length,
          ...(jsonResults.length === 0
            ? { message: 'No results found for the requested scope and filters.' }
            : {}),
        },
        { json: true },
      );
      return;
    }

    if (selfResults.length === 0) {
      output.searchEmpty(flags.query, buildActiveFilters(responseFilters, resolvedRepos));
      return;
    }

    output.searchResultsUnranked(selfResults.map(toUnrankedHumanResult));
    return;
  }

  const embeddings = createEmbeddings();
  const vector = await embeddings.embed(buildSearchVectorInput(flags.query, tags));
  const overfetchLimit = computeOverfetchLimit(limit);
  const rawResults = await qdrant.search(vector, filters, overfetchLimit);

  const rankingConfig = config?.ranking;
  const weights = rankingConfig
    ? {
        w_similarity: rankingConfig.w_similarity,
        w_recency: rankingConfig.w_recency,
        w_source: rankingConfig.w_source,
      }
    : DEFAULT_RANKING_WEIGHTS;
  const halfLifeDays = rankingConfig?.recency_half_life_days ?? DEFAULT_RECENCY_HALF_LIFE_DAYS;
  const tagBoostFactor = rankingConfig?.tag_boost_factor ?? DEFAULT_TAG_BOOST_FACTOR;
  const confidenceThresholds =
    rankingConfig?.confidence_thresholds ?? DEFAULT_CONFIDENCE_THRESHOLDS;
  const lexicalEnabled = parseLexicalFlag(flags.lexical, rankingConfig);
  const lexicalBoostFactor = rankingConfig?.lexical_boost_factor ?? DEFAULT_LEXICAL_BOOST_FACTOR;

  // #62 AC3/AC4/AC8: only queries with identifier-shaped tokens issue the
  // extra scroll, and only when lexical matching is enabled - an ordinary
  // prose query (or `--lexical off`) never fires a second Qdrant call.
  const identifiers = lexicalEnabled ? extractIdentifierTokens(flags.query) : [];
  let candidateResults: SearchResult[] = rawResults;

  if (identifiers.length > 0) {
    try {
      const lexicalFilter = buildLexicalScrollFilter(filters, identifiers);
      const lexicalScrollResults = await qdrant.scroll(lexicalFilter, LEXICAL_SCROLL_LIMIT, {
        withVector: true,
      });

      // #62 AC5: dense candidates keep Qdrant's own score; only lexical-only
      // candidates get a locally computed cosine similarity. Union dedupe by id.
      const byId = new Map<string, SearchResult>();
      for (const result of rawResults) byId.set(String(result.id), result);
      for (const scrollResult of lexicalScrollResults) {
        const key = String(scrollResult.id);
        if (byId.has(key)) continue;
        const similarity = scrollResult.vector ? cosine(vector, scrollResult.vector) : 0;
        byId.set(key, { id: scrollResult.id, score: similarity, payload: scrollResult.payload });
      }
      candidateResults = [...byId.values()];
    } catch (err) {
      // #62 AC-resilience: the lexical scroll failing degrades to dense-only
      // results; it is logged under MEMO_DEBUG and never changes the exit code.
      debugLog(
        `lexical scroll failed, degrading to dense-only results: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const rankableEntries = candidateResults.map((result) => {
    const entry = toRankableEntry(result);
    const lexicalBoost =
      identifiers.length > 0
        ? computeLexicalBoost(
            identifiers,
            typeof entry.payload?.['rationale'] === 'string'
              ? entry.payload['rationale']
              : undefined,
            Array.isArray(entry.payload?.['files_modified'])
              ? entry.payload['files_modified']
              : undefined,
            lexicalBoostFactor,
          )
        : 0;
    return { ...entry, lexicalBoost };
  });

  const ranked = rankResults(
    rankableEntries,
    weights,
    halfLifeDays,
    Date.now(),
    flags.query,
    tagBoostFactor,
    confidenceThresholds,
  );
  const results = ranked.slice(0, limit);

  // #38 AC5/AC6, S2-05 AC4: exactly one `scroll` (via `fetchStalenessCorpus`)
  // per invocation, cached for the rest of the command - never per result,
  // and skipped entirely when there is nothing to annotate. Staleness is
  // computed strictly after ranking/slicing (AC4): it reads `results` but
  // can never feed back into `final_score` or ordering.
  //
  // S2-05 AC4/A12: the corpus shares the exact same `base` filter as the
  // dense query and lexical scroll (bank-aware staleness) - a `repo`
  // any-match clause is layered on top only for the shared `kb` bank, where
  // repo scoping is still meaningful; a private bank's corpus is bank-scoped
  // only, since its entries need not carry a `repo` at all.
  const stalenessConfig = {
    staleness_threshold_days:
      rankingConfig?.staleness_threshold_days ?? DEFAULT_STALENESS_THRESHOLD_DAYS,
    staleness_tag_overlap_threshold:
      rankingConfig?.staleness_tag_overlap_threshold ?? DEFAULT_STALENESS_TAG_OVERLAP_THRESHOLD,
  };
  const stalenessCorpusFilter: QdrantFilter =
    readFlags.bank === DEFAULT_BANK_ID
      ? mergeFilters(base, { must: [{ key: 'repo', match: { any: resolvedRepos } }] })
      : base;
  const staleFlags =
    results.length > 0
      ? detectStaleness(
          results,
          (await qdrant.fetchStalenessCorpus(stalenessCorpusFilter)).map(toStalenessCandidate),
          stalenessConfig,
          Date.now(),
        )
      : new Map<string, string | number>();

  const annotatedResults: StaleAnnotated<RankedSearchResult>[] = results.map((result) => {
    const staleBy = staleFlags.get(String(result.id));
    return staleBy === undefined ? result : { ...result, stale: true, stale_by: staleBy };
  });
  const jsonResults = annotatedResults.map((result) => toJsonResult(result, explain));

  if (flags.json) {
    output.result(
      {
        query: flags.query,
        // #63 AC1/AC4: additive envelope key, positioned right after `query`
        // per spec §6.2's JSON example - every other key keeps its name,
        // type, and position.
        query_id: queryId,
        filters: responseFilters,
        results: jsonResults,
        count: jsonResults.length,
        ...(jsonResults.length === 0
          ? { message: 'No results found for the requested scope and filters.' }
          : {}),
      },
      { json: true },
    );
    return;
  }

  if (results.length === 0) {
    output.searchEmpty(flags.query, buildActiveFilters(responseFilters, resolvedRepos));
    return;
  }

  output.searchResults(
    annotatedResults.map((result) => ({
      id: result.id,
      // D6: the human-output percentage is now the composite final_score,
      // not the raw similarity. The field name stays `similarity` here
      // because SearchHumanResult is a private rendering type, not the
      // `--json` contract (which exposes final_score explicitly).
      similarity: result.final_score,
      ...omitStoredConfidence(result.payload),
      // #35 AC5: drives the `[tier]` prefix in `output.searchResults`.
      confidenceTier: result.confidence_tier,
      // #38 AC7: drives the inline `⚠ STALE` warning in `output.searchResults`.
      ...(result.stale ? { stale: true as const, staleBy: result.stale_by } : {}),
      // #63 AC6: drives the aligned factor table in `output.searchResults`.
      ...(explain ? { explain: buildExplainFactors(result) } : {}),
      // S2-05 AC6: drives the `[archived]`/`[superseded]` prefix.
      ...(normalizeEntry(result.payload ?? {}).archived ? { archived: true as const } : {}),
      ...(normalizeEntry(result.payload ?? {}).superseded ? { superseded: true as const } : {}),
    })),
  );

  // #63: the query_id footer is human-mode-only and only under --explain
  // (Business Rules) - default human output stays exactly as before.
  if (explain) {
    output.explainFooter(queryId);
  }
}

const search = new Command('search')
  .description('Search for stored decisions using semantic matching with exact pre-filters')
  .argument('<query>', 'natural language query')
  .option('--scope <scope>', 'repo|related (default: config or repo)')
  .option('--repo <name>', 'repository name (overrides config)')
  .option('--org <name>', 'organization name (overrides config)')
  .option('--tags <csv>', 'comma-separated tags to require on every result')
  .option('--entry-type <csv>', 'comma-separated entry types to include')
  .option('--source <csv>', 'comma-separated sources to include')
  .option('--limit <n>', 'maximum number of results', '10')
  .option('--lexical <on|off>', 'enable/disable lexical identifier matching (default: on)')
  .option('--explain', 'show a per-result factor breakdown (#63)')
  .option('--bank <id>', 'bank id (default: MEMO_BANK, config.bank.default, or "kb")')
  .option('--kind <kind>', 'self|episodic|semantic|all (default: all, case-insensitive)')
  .option('--session <id>', 'restrict to an episodic session id')
  .option('--include-archived', 'include archived entries')
  .option('--include-superseded', 'include superseded entries')
  .option(
    '--as-of <iso>',
    'point-in-time read (ISO 8601 date or datetime); implies --include-superseded',
  )
  .option('--json', 'output as JSON')
  .action(async (query: string, opts: Record<string, unknown>) => {
    await handleSearch({
      query,
      scope: opts['scope'] as string | undefined,
      repo: opts['repo'] as string | undefined,
      org: opts['org'] as string | undefined,
      tags: opts['tags'] as string | undefined,
      entryType: opts['entryType'] as string | undefined,
      source: opts['source'] as string | undefined,
      limit: opts['limit'] as string | undefined,
      lexical: opts['lexical'] as string | undefined,
      explain: opts['explain'] as boolean | undefined,
      bank: opts['bank'] as string | undefined,
      kind: opts['kind'] as string | undefined,
      session: opts['session'] as string | undefined,
      includeArchived: opts['includeArchived'] as boolean | undefined,
      includeSuperseded: opts['includeSuperseded'] as boolean | undefined,
      asOf: opts['asOf'] as string | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

export default search;
