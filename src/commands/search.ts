import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { createEmbeddingsAdapter } from '../lib/embeddings.js';
import { MemoError } from '../lib/errors.js';
import { output } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';
import { resolveScopeRepos } from '../lib/registry.js';
import { buildSearchFilters } from '../lib/search-filters.js';
import {
  rankResults,
  DEFAULT_RANKING_WEIGHTS,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
} from '../lib/ranking.js';
import type { RankableEntry } from '../lib/ranking.js';
import type { MemoConfig } from '../types/config.js';
import type { SearchResult } from '../lib/qdrant.js';

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

export interface SearchFlags {
  query: string;
  scope?: string;
  repo?: string;
  org?: string;
  tags?: string;
  entryType?: string;
  source?: string;
  limit?: string | number;
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
};

function toRankableEntry(result: SearchResult): SearchRankInput {
  const payload = result.payload;
  const timestampUtc =
    typeof payload?.['timestamp_utc'] === 'string' ? payload['timestamp_utc'] : undefined;
  return {
    id: result.id,
    similarity: result.score,
    timestampUtc,
    source: payload?.['source'],
    payload,
  };
}

function toJsonResult(result: RankedSearchResult): Record<string, unknown> {
  return {
    id: result.id,
    ...(result.payload ?? {}),
    similarity: result.similarity,
    final_score: result.final_score,
    recency_score: result.recency_score,
    source_score: result.source_score,
  };
}

export async function handleSearch(flags: SearchFlags, deps: SearchDeps = {}): Promise<void> {
  const {
    loadCfg = loadConfig,
    createRepo = (url, key) => new QdrantRepository(url, key),
    createEmbeddings = createEmbeddingsAdapter,
    resolveRepos = resolveScopeRepos,
  } = deps;

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

  const resolvedRepos = resolveRepos({ repo, scope, config });
  const filters = buildSearchFilters({
    repo,
    scope,
    relatedRepos: resolvedRepos.filter((candidate) => candidate !== repo),
    org,
    tags,
    entryTypes,
    sources,
  });

  const responseFilters: SearchResponseFilters = {
    scope,
    repo,
    ...(org ? { org } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(entryTypes.length > 0 ? { entry_type: entryTypes } : {}),
    ...(sources.length > 0 ? { source: sources } : {}),
    limit,
  };

  const repoUrl = process.env['QDRANT_URL'];
  const repoKey = process.env['QDRANT_API_KEY'];
  const qdrant = createRepo(repoUrl, repoKey);
  const embeddings = createEmbeddings();

  await qdrant.ensureCollection();

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

  const ranked = rankResults(rawResults.map(toRankableEntry), weights, halfLifeDays);
  const results = ranked.slice(0, limit);
  const jsonResults = results.map(toJsonResult);

  if (flags.json) {
    output.result(
      {
        query: flags.query,
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
    results.map((result) => ({
      id: result.id,
      // D6: the human-output percentage is now the composite final_score,
      // not the raw similarity. The field name stays `similarity` here
      // because SearchHumanResult is a private rendering type, not the
      // `--json` contract (which exposes final_score explicitly).
      similarity: result.final_score,
      ...(result.payload ?? {}),
    })),
  );
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
      json: opts['json'] as boolean | undefined,
    });
  });

export default search;
