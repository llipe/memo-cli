import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { MemoError } from '../lib/errors.js';
import { buildListFilters, normalizeListDateRange } from '../lib/list-filters.js';
import { output } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';
import { resolveScopeRepos } from '../lib/registry.js';
import type { ScrollResult } from '../lib/qdrant.js';
import type { MemoConfig } from '../types/config.js';

export interface ListFlags {
  scope?: string;
  repo?: string;
  org?: string;
  tags?: string;
  entryType?: string;
  source?: string;
  from?: string;
  to?: string;
  limit?: string | number;
  json?: boolean;
}

export interface ListDeps {
  loadCfg?: typeof loadConfig;
  createRepo?: (url?: string, key?: string) => QdrantRepository;
  resolveRepos?: typeof resolveScopeRepos;
}

export interface ListResponseFilters {
  scope: 'repo' | 'related';
  repo: string;
  org?: string;
  tags?: string[];
  entry_type?: string[];
  source?: string[];
  from?: string;
  to?: string;
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
  if (value === undefined) return 20;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new MemoError('VALIDATION_FAILED', '--limit must be a positive integer.');
  }
  return parsed;
}

function buildActiveFilters(filters: ListResponseFilters, repoSet: string[]): string[] {
  const values = [`scope:${filters.scope}`, `repo:${repoSet.join(',')}`];
  if (filters.org) values.push(`org:${filters.org}`);
  if (filters.entry_type && filters.entry_type.length > 0) {
    values.push(`entry_type:${filters.entry_type.join(',')}`);
  }
  if (filters.source && filters.source.length > 0) {
    values.push(`source:${filters.source.join(',')}`);
  }
  if (filters.from) values.push(`from:${filters.from}`);
  if (filters.to) values.push(`to:${filters.to}`);
  values.push(`limit:${String(filters.limit)}`);
  return values;
}

function toJsonResult(result: ScrollResult): Record<string, unknown> {
  return {
    id: result.id,
    ...(result.payload ?? {}),
  };
}

export async function handleList(flags: ListFlags, deps: ListDeps = {}): Promise<void> {
  const {
    loadCfg = loadConfig,
    createRepo = (url, key) => new QdrantRepository(url, key),
    resolveRepos = resolveScopeRepos,
  } = deps;

  const config = await loadCfg().catch((err: unknown) => {
    if (
      err instanceof MemoError &&
      (err.code === 'CONFIG_NOT_FOUND' || err.code === 'CONFIG_INVALID')
    ) {
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
  const { from, to } = normalizeListDateRange({ from: flags.from, to: flags.to });

  const resolvedRepos = resolveRepos({ repo, scope, config });
  const filters = buildListFilters({
    repo,
    scope,
    relatedRepos: resolvedRepos.filter((candidate) => candidate !== repo),
    org,
    tags,
    entryTypes,
    sources,
    from,
    to,
  });

  const responseFilters: ListResponseFilters = {
    scope,
    repo,
    ...(org ? { org } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(entryTypes.length > 0 ? { entry_type: entryTypes } : {}),
    ...(sources.length > 0 ? { source: sources } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit,
  };

  const repoUrl = process.env['QDRANT_URL'];
  const repoKey = process.env['QDRANT_API_KEY'];
  const qdrant = createRepo(repoUrl, repoKey);

  await qdrant.ensureCollection();

  const results = await qdrant.scroll(filters, limit);
  const jsonResults = results.map(toJsonResult);

  if (flags.json) {
    output.result(
      {
        filters: responseFilters,
        results: jsonResults,
        count: jsonResults.length,
        ...(jsonResults.length === 0
          ? { message: 'No entries found for the requested scope and filters.' }
          : {}),
      },
      { json: true },
    );
    return;
  }

  if (results.length === 0) {
    output.listEmpty(buildActiveFilters(responseFilters, resolvedRepos));
    return;
  }

  output.listResults(
    results.map((result) => ({
      id: result.id,
      ...(result.payload ?? {}),
    })),
  );
}

const list = new Command('list')
  .description('List recent memo entries in reverse chronological order')
  .option('--scope <scope>', 'repo|related (default: config or repo)')
  .option('--repo <name>', 'repository name (overrides config)')
  .option('--org <name>', 'organization name (overrides config)')
  .option('--tags <csv>', 'comma-separated tags to require on every result')
  .option('--entry-type <csv>', 'comma-separated entry types to include')
  .option('--source <csv>', 'comma-separated sources to include')
  .option('--from <iso>', 'inclusive ISO 8601 lower bound for timestamp_utc')
  .option('--to <iso>', 'inclusive ISO 8601 upper bound for timestamp_utc')
  .option('--limit <n>', 'maximum number of results', '20')
  .option('--json', 'output as JSON')
  .action(async (opts: Record<string, unknown>) => {
    await handleList({
      scope: opts['scope'] as string | undefined,
      repo: opts['repo'] as string | undefined,
      tags: opts['tags'] as string | undefined,
      org: opts['org'] as string | undefined,
      entryType: opts['entryType'] as string | undefined,
      source: opts['source'] as string | undefined,
      from: opts['from'] as string | undefined,
      to: opts['to'] as string | undefined,
      limit: opts['limit'] as string | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

export default list;
