import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import chalk from 'chalk';
import { policyFor } from '../lib/bank.js';
import { resolveBank } from '../lib/bank.js';
import { loadConfig } from '../lib/config.js';
import { createEmbeddingsAdapter } from '../lib/embeddings.js';
import { normalizeEntry, projectV2Fields } from '../lib/entry-normalize.js';
import { MemoError } from '../lib/errors.js';
import { buildBaseFilter, mergeFilters } from '../lib/filters.js';
import { output } from '../lib/output.js';
import type { RecallHumanSection } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';
import { rankCandidates } from './search.js';
import type { RankedSearchResult, StaleAnnotated } from './search.js';
import { assembleRecall } from '../lib/recall.js';
import type { RecallEntry, RecallInputs } from '../lib/recall.js';
import {
  rankResults,
  DEFAULT_RANKING_WEIGHTS,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
  DEFAULT_TAG_BOOST_FACTOR,
  DEFAULT_CONFIDENCE_THRESHOLDS,
} from '../lib/ranking.js';
import type { RankableEntry } from '../lib/ranking.js';
import { resolveScopeRepos } from '../lib/registry.js';
import { buildSearchFilters } from '../lib/search-filters.js';
import { DEFAULT_BANK_ID, DEFAULT_RECALL_MAX_TOKENS } from '../types/config.js';
import type { MemoConfig, SelfPolicy } from '../types/config.js';
import type { QdrantFilter, ScrollResult, SearchResult } from '../lib/qdrant.js';

/**
 * `memo recall` (issue #86, S2-07) — spec §8.5/§18.9, PRD FR-2.6/AC-2.6, the
 * headline feature of Phase 2 ("one call to restore context"). Gathers the
 * six candidate sections per the §18.9 table, then hands them to the pure
 * `assembleRecall` (`src/lib/recall.ts`) for dedup/cap/trim.
 *
 * Read-only per decision A14: no `setPayload`/`batchSetPayload` call and no
 * filesystem write occurs anywhere in this file. `query_id` is emitted but
 * no snapshot is written to `~/.memo/queries/` (Phase 3 concern).
 */
export interface RecallFlags {
  task: string;
  bank?: string;
  scope?: string;
  maxTokens?: string | number;
  json?: boolean;
}

export interface RecallDeps {
  loadCfg?: typeof loadConfig;
  createRepo?: (url?: string, key?: string) => QdrantRepository;
  createEmbeddings?: typeof createEmbeddingsAdapter;
  resolveRepos?: typeof resolveScopeRepos;
}

const SOFT_CAP_FETCH_HEADROOM = 1;
const POLICIES_LIMIT = 8;
const SHARED_LIMIT = 8;
const MINE_LIMIT = 5;
const LAST_SESSION_LIMIT = 15;
const CONFLICTS_LIMIT = 5;

function parseTask(task: string): string {
  const trimmed = task.trim();
  if (trimmed.length === 0) {
    throw new MemoError('VALIDATION_FAILED', 'recall task must not be empty.');
  }
  return task;
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

function parseMaxTokens(value: string | number | undefined, config?: MemoConfig | null): number {
  if (value === undefined) return config?.recall.max_tokens ?? DEFAULT_RECALL_MAX_TOKENS;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new MemoError('VALIDATION_FAILED', '--max-tokens must be a non-negative integer.');
  }
  return parsed;
}

function omitStoredConfidence(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!payload) return {};
  const { confidence: _confidence, ...rest } = payload;
  return rest;
}

function payloadOf(point: ScrollResult): Record<string, unknown> {
  return point.payload ?? {};
}

function renderedLineOf(data: Record<string, unknown>): string {
  return JSON.stringify(data);
}

/** Unranked projection shared by `SELF` and `CONFLICTS` (neither is ever ranked, K4). */
function toUnrankedEntry(point: ScrollResult): RecallEntry {
  const payload = payloadOf(point);
  const data = {
    id: point.id,
    ...omitStoredConfidence(payload),
    ...projectV2Fields(normalizeEntry(payload)),
  };
  return { id: point.id, renderedLine: renderedLineOf(data), data };
}

/** `LAST SESSION` projection: mirrors `timeline.ts`'s `toJsonEntry` (id + full payload + v2 fields), plus `seq` for trimming. */
function toLastSessionEntry(point: ScrollResult): RecallEntry {
  const payload = payloadOf(point);
  const data = { id: point.id, ...payload, ...projectV2Fields(normalizeEntry(payload)) };
  const seq = typeof payload['seq'] === 'number' ? payload['seq'] : undefined;
  return {
    id: point.id,
    renderedLine: renderedLineOf(data),
    ...(seq !== undefined ? { seq } : {}),
    data,
  };
}

/**
 * Ranked projection shared by `POLICIES`/`SHARED`/`MINE`: a leaner bundle
 * than `memo search`'s JSON result (no `similarity`/`recency_score`/
 * `source_score`/`tag_boost`) since `recall`'s output is token-budget
 * constrained (spec §8.5) - only the fields a consuming agent needs to
 * decide relevance and detect staleness survive.
 */
function toRankedEntry(result: StaleAnnotated<RankedSearchResult>): RecallEntry {
  const payload = result.payload;
  const data: Record<string, unknown> = {
    id: result.id,
    ...omitStoredConfidence(payload),
    ...projectV2Fields(normalizeEntry(payload ?? {})),
    final_score: result.final_score,
    confidence_tier: result.confidence_tier,
    ...(result.stale ? { stale: true as const, stale_by: result.stale_by } : {}),
  };
  return { id: result.id, renderedLine: renderedLineOf(data), data };
}

/**
 * `POLICIES`'s ranking pipeline (spec §18.9): a plain dense search + rank,
 * deliberately *not* routed through `rankCandidates()` - the table's
 * `POLICIES` row names only a dense `search(...)  ranked`, with no lexical
 * union or staleness annotation (unlike `SHARED`'s explicit "+ lexical
 * scroll ... stale annotation" language), so this stays the simpler pipeline
 * `memo search` used before #62/#38 existed.
 */
async function rankPolicies(
  qdrant: QdrantRepository,
  vector: number[],
  filters: QdrantFilter,
  query: string,
  config: MemoConfig | null,
): Promise<RecallEntry[]> {
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

  const rawResults: SearchResult[] = await qdrant.search(vector, filters, POLICIES_LIMIT);
  const rankable: RankableEntry[] = rawResults.map((result) => {
    const payload = result.payload;
    const timestampUtc =
      typeof payload?.['timestamp_utc'] === 'string' ? payload['timestamp_utc'] : undefined;
    const rawTags = payload?.['tags'];
    return {
      id: result.id,
      similarity: result.score,
      timestampUtc,
      source: payload?.['source'],
      tags: Array.isArray(rawTags) ? rawTags : undefined,
    };
  });
  const ranked = rankResults(
    rankable,
    weights,
    halfLifeDays,
    Date.now(),
    query,
    tagBoostFactor,
    confidenceThresholds,
  );

  return ranked.map((entry, i) => {
    const payload = rawResults[i]?.payload;
    const data: Record<string, unknown> = {
      id: entry.id,
      ...omitStoredConfidence(payload),
      ...projectV2Fields(normalizeEntry(payload ?? {})),
      final_score: entry.final_score,
      confidence_tier: entry.confidence_tier,
    };
    return { id: entry.id, renderedLine: renderedLineOf(data), data };
  });
}

function buildStalenessCorpusFilter(
  bank: string,
  base: QdrantFilter,
  resolvedRepos: string[],
): QdrantFilter {
  return bank === DEFAULT_BANK_ID
    ? mergeFilters(base, { must: [{ key: 'repo', match: { any: resolvedRepos } }] })
    : base;
}

export async function handleRecall(flags: RecallFlags, deps: RecallDeps = {}): Promise<void> {
  const {
    loadCfg = loadConfig,
    createRepo = (url, key) => new QdrantRepository(url, key),
    createEmbeddings = createEmbeddingsAdapter,
    resolveRepos = resolveScopeRepos,
  } = deps;

  const task = parseTask(flags.task);
  const queryId = randomUUID();

  const config = await loadCfg().catch((err: unknown) => {
    if (err instanceof MemoError && err.code === 'CONFIG_NOT_FOUND') {
      return null;
    }
    throw err;
  });

  // Unlike `memo search`, `memo recall` has no `--repo` override - `repo`
  // can only ever come from config, so a missing/unresolved config fails
  // fast here rather than degrading. This also lets TypeScript narrow
  // `config` to non-null for the rest of this function (verified: the
  // `repo` guard below is the only source of `repo`).
  const repo = config?.repo;
  if (!config || !repo) {
    throw new MemoError(
      'REPO_CONTEXT_UNRESOLVED',
      'Could not resolve repo context. Run `memo setup init`.',
    );
  }

  const bank = resolveBank(flags.bank, process.env, config);
  const scope = parseScope(flags.scope, config);
  const maxTokens = parseMaxTokens(flags.maxTokens, config);
  const isKb = bank === DEFAULT_BANK_ID;

  const resolvedRepos = resolveRepos({ repo, scope, config });
  const relatedRepos = resolvedRepos.filter((candidate) => candidate !== repo);

  const qdrant = createRepo(process.env['QDRANT_URL'], process.env['QDRANT_API_KEY']);
  await qdrant.ensureCollection();

  const embeddings = createEmbeddings();
  // Spec §18.9: 1 embed call per invocation, its vector reused by every
  // dense query below (POLICIES, SHARED, and - when not `kb` - MINE).
  const vector = await embeddings.embed(task);

  const rankingConfig = config.ranking;
  const stalenessConfig = {
    staleness_threshold_days: rankingConfig.staleness_threshold_days,
    staleness_tag_overlap_threshold: rankingConfig.staleness_tag_overlap_threshold,
  };
  const rankCandidatesShared = {
    weights: {
      w_similarity: rankingConfig.w_similarity,
      w_recency: rankingConfig.w_recency,
      w_source: rankingConfig.w_source,
    },
    halfLifeDays: rankingConfig.recency_half_life_days,
    tagBoostFactor: rankingConfig.tag_boost_factor,
    confidenceThresholds: rankingConfig.confidence_thresholds,
    lexicalEnabled: rankingConfig.lexical,
    lexicalBoostFactor: rankingConfig.lexical_boost_factor,
  };

  // SELF (omitted for `kb`, AC7): scroll(bank, kind=self, superseded != true),
  // soft_cap+1, newest first; warn on stderr above soft_cap (AC5).
  let selfEntries: RecallEntry[] = [];
  if (!isKb) {
    const effectiveSoftCap = (policyFor(config, bank, 'self') as SelfPolicy).soft_cap;
    const selfFilter = buildBaseFilter({ bank, kind: 'self' });
    const selfResults = await qdrant.scroll(selfFilter, effectiveSoftCap + SOFT_CAP_FETCH_HEADROOM);
    if (selfResults.length > effectiveSoftCap) {
      process.stderr.write(
        chalk.yellow(
          `self entry count (${String(selfResults.length)}) exceeds soft_cap (${String(effectiveSoftCap)}) for bank "${bank}".`,
        ) + '\n',
      );
    }
    selfEntries = selfResults.map(toUnrankedEntry);
  }

  // POLICIES (never omitted, AC10): kb semantic, entry_type = policy.
  const policiesFilter = mergeFilters(
    buildBaseFilter({ bank: DEFAULT_BANK_ID, kind: 'semantic' }),
    {
      must: [{ key: 'entry_type', match: { value: 'policy' } }],
    },
  );
  const policiesEntries = await rankPolicies(qdrant, vector, policiesFilter, task, config);

  // SHARED (never omitted): kb semantic, repo-scoped per --scope, full
  // rankCandidates pipeline (over-fetch, lexical union, rankResults,
  // staleness against the kb corpus).
  const sharedBase = buildBaseFilter({ bank: DEFAULT_BANK_ID, kind: 'semantic' });
  const sharedFilters = buildSearchFilters(
    { repo, scope, relatedRepos, bank: DEFAULT_BANK_ID },
    sharedBase,
  );
  const sharedResults = await rankCandidates({
    qdrant,
    vector,
    filters: sharedFilters,
    query: task,
    limit: SHARED_LIMIT,
    ...rankCandidatesShared,
    stalenessConfig,
    stalenessCorpusFilter: buildStalenessCorpusFilter(DEFAULT_BANK_ID, sharedBase, resolvedRepos),
  });
  const sharedEntries = sharedResults.map(toRankedEntry);

  // MINE (omitted for `kb`, AC7): bank semantic, same pipeline, no repo
  // scope (buildSearchFilters skips the repo clause for a non-kb bank).
  let mineEntries: RecallEntry[] = [];
  if (!isKb) {
    const mineBase = buildBaseFilter({ bank, kind: 'semantic' });
    const mineFilters = buildSearchFilters({ repo, scope, relatedRepos, bank }, mineBase);
    const mineResults = await rankCandidates({
      qdrant,
      vector,
      filters: mineFilters,
      query: task,
      limit: MINE_LIMIT,
      ...rankCandidatesShared,
      stalenessConfig,
      stalenessCorpusFilter: buildStalenessCorpusFilter(bank, mineBase, resolvedRepos),
    });
    mineEntries = mineResults.map(toRankedEntry);
  }

  // LAST SESSION (omitted for `kb`, AC7): most recent session_id, then that
  // session's entries seq asc, limit 15.
  let lastSessionId: string | null = null;
  let lastSessionEntries: RecallEntry[] = [];
  if (!isKb) {
    const episodicBase = buildBaseFilter({ bank, kind: 'episodic' });
    const [mostRecent] = await qdrant.scroll(episodicBase, 1);
    const sessionId =
      mostRecent !== undefined && typeof payloadOf(mostRecent)['session_id'] === 'string'
        ? (payloadOf(mostRecent)['session_id'] as string)
        : undefined;
    if (sessionId !== undefined) {
      lastSessionId = sessionId;
      const sessionFilter = buildBaseFilter({ bank, kind: 'episodic', session: sessionId });
      const sessionResults = await qdrant.scrollOrdered(sessionFilter, {
        orderBy: { key: 'seq', direction: 'asc' },
        limit: LAST_SESSION_LIMIT,
      });
      lastSessionEntries = sessionResults.map(toLastSessionEntry);
    }
  }

  // CONFLICTS (never omitted, always empty until Phase 4): bank-scoped,
  // pending_contradiction = true. Never ranked.
  const conflictsFilter = mergeFilters(buildBaseFilter({ bank, kind: 'all' }), {
    must: [{ key: 'pending_contradiction', match: { value: true } }],
  });
  const conflictsResults = await qdrant.scroll(conflictsFilter, CONFLICTS_LIMIT);
  const conflictsEntries = conflictsResults.map(toUnrankedEntry);

  const inputs: RecallInputs = {
    bank,
    queryId,
    self: selfEntries,
    policies: policiesEntries,
    shared: sharedEntries,
    mine: mineEntries,
    lastSession: { sessionId: lastSessionId, entries: lastSessionEntries },
    conflicts: conflictsEntries,
  };

  const bundle = assembleRecall(inputs, { maxTokens });

  if (flags.json) {
    output.result(bundle, { json: true });
    return;
  }

  const sections: RecallHumanSection[] = [
    ...(bundle.sections.self !== undefined
      ? [
          {
            header: 'SELF',
            ranked: false,
            entries: bundle.sections.self.map((e) => ({
              id: e['id'] as string | number,
              rationale: typeof e['rationale'] === 'string' ? e['rationale'] : undefined,
            })),
          },
        ]
      : []),
    {
      header: 'POLICIES',
      ranked: true,
      entries: bundle.sections.policies.map((e) => ({
        id: e['id'] as string | number,
        rationale: typeof e['rationale'] === 'string' ? e['rationale'] : undefined,
        confidenceTier: e['confidence_tier'] as never,
        score: typeof e['final_score'] === 'number' ? e['final_score'] : undefined,
      })),
    },
    {
      header: 'SHARED',
      ranked: true,
      entries: bundle.sections.shared.map((e) => ({
        id: e['id'] as string | number,
        rationale: typeof e['rationale'] === 'string' ? e['rationale'] : undefined,
        confidenceTier: e['confidence_tier'] as never,
        score: typeof e['final_score'] === 'number' ? e['final_score'] : undefined,
      })),
    },
    ...(bundle.sections.mine !== undefined
      ? [
          {
            header: 'MINE',
            ranked: true,
            entries: bundle.sections.mine.map((e) => ({
              id: e['id'] as string | number,
              rationale: typeof e['rationale'] === 'string' ? e['rationale'] : undefined,
              confidenceTier: e['confidence_tier'] as never,
              score: typeof e['final_score'] === 'number' ? e['final_score'] : undefined,
            })),
          },
        ]
      : []),
    ...(bundle.sections.last_session !== undefined
      ? [
          {
            header: 'LAST SESSION',
            ranked: false,
            entries: bundle.sections.last_session.entries.map((e) => ({
              id: e['id'] as string | number,
              rationale: typeof e['rationale'] === 'string' ? e['rationale'] : undefined,
              seq: typeof e['seq'] === 'number' ? e['seq'] : undefined,
            })),
          },
        ]
      : []),
    {
      header: 'CONFLICTS',
      ranked: false,
      entries: bundle.sections.conflicts.map((e) => ({
        id: e['id'] as string | number,
        rationale: typeof e['rationale'] === 'string' ? e['rationale'] : undefined,
      })),
    },
  ];

  output.recallSections(sections);
  output.recallFooter(bundle.budget.used_tokens, bundle.budget.max_tokens, bundle.truncated);
}

const recall = new Command('recall')
  .description('One call to restore context: SELF, POLICIES, SHARED, MINE, LAST SESSION, CONFLICTS')
  .argument('<task>', 'natural language description of the task at hand')
  .option('--bank <id>', 'bank id (default: MEMO_BANK, config.bank.default, or "kb")')
  .option('--scope <scope>', 'repo|related, applies to SHARED only (default: config or repo)')
  .option('--max-tokens <n>', 'token budget (default: config.recall.max_tokens, 2000)')
  .option('--json', 'output as JSON')
  .action(async (task: string, opts: Record<string, unknown>) => {
    await handleRecall({
      task,
      bank: opts['bank'] as string | undefined,
      scope: opts['scope'] as string | undefined,
      maxTokens: opts['maxTokens'] as string | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

export default recall;
