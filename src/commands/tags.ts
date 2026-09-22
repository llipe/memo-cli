import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { MemoError } from '../lib/errors.js';
import { aggregateField } from '../lib/facets.js';
import { buildBaseFilter, mergeFilters } from '../lib/filters.js';
import { output } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';
import { parseReadFlags } from '../lib/read-flags.js';
import type { RawReadFlags } from '../lib/read-flags.js';
import { resolveScopeRepos } from '../lib/registry.js';
import { DEFAULT_BANK_ID } from '../types/config.js';
import type { FacetEntry, FacetScrollFn } from '../lib/facets.js';
import type { QdrantFilter } from '../lib/qdrant.js';

export interface TagsListFlags extends RawReadFlags {
  scope?: string;
  json?: boolean;
  sort?: string;
}

export interface TagsListDeps {
  loadCfg?: typeof loadConfig;
  createRepo?: (url?: string, key?: string) => QdrantRepository;
  resolveRepos?: typeof resolveScopeRepos;
  aggregate?: typeof aggregateField;
}

function parseScope(value?: string): 'repo' | 'related' {
  const scope = value ?? 'repo';
  if (scope !== 'repo' && scope !== 'related') {
    throw new MemoError(
      'VALIDATION_FAILED',
      `Invalid --scope value "${scope}". Use repo or related.`,
    );
  }
  return scope;
}

function parseSort(value?: string): 'alpha' | 'frequency' {
  const sort = value ?? 'alpha';
  if (sort !== 'alpha' && sort !== 'frequency') {
    throw new MemoError(
      'VALIDATION_FAILED',
      `Invalid --sort value "${sort}". Use alpha or frequency.`,
    );
  }
  return sort;
}

/**
 * The `repo` scoping clause (spec §18.5's `repoClauseAllowed` convention,
 * shared with `search-filters.ts`/`list-filters.ts`): applied for the
 * shared `kb` bank, omitted for a private bank - `tags list` has no
 * explicit `--repo` flag, so a private bank is always repo-unscoped (its
 * entries need not carry a `repo` at all, EC-11).
 */
function buildRepoFilter(repos: string[], bank: string): QdrantFilter {
  if (bank !== DEFAULT_BANK_ID) return {};
  if (repos.length === 1 && repos[0] !== undefined) {
    return { must: [{ key: 'repo', match: { value: repos[0] } }] };
  }
  return { should: repos.map((r) => ({ key: 'repo', match: { value: r } })) };
}

function sortFacets(facets: FacetEntry[], sort: 'alpha' | 'frequency'): FacetEntry[] {
  const copy = [...facets];
  if (sort === 'frequency') {
    copy.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  } else {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  return copy;
}

export async function handleTagsList(flags: TagsListFlags, deps: TagsListDeps = {}): Promise<void> {
  const {
    loadCfg = loadConfig,
    createRepo = (url, key) => new QdrantRepository(url, key),
    resolveRepos = resolveScopeRepos,
    aggregate = aggregateField,
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

  const repo = config?.repo;
  if (!repo) {
    throw new MemoError(
      'REPO_CONTEXT_UNRESOLVED',
      'Could not resolve repo context. Run `memo setup init`.',
    );
  }

  const scope = parseScope(flags.scope);
  const sort = parseSort(flags.sort);
  const resolvedRepos = resolveRepos({ repo, scope, config });

  // S2-05 AC1/AC4: the shared read-side flags and the one `base` filter
  // shared by every read command (spec §18.7).
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
    config,
  );
  const base = buildBaseFilter({
    bank: readFlags.bank,
    kind: readFlags.kind,
    includeArchived: readFlags.includeArchived,
    includeSuperseded: readFlags.includeSuperseded,
    ...(readFlags.session !== undefined ? { session: readFlags.session } : {}),
    ...(readFlags.asOf !== undefined ? { asOf: readFlags.asOf } : {}),
  });
  const filter = mergeFilters(base, buildRepoFilter(resolvedRepos, readFlags.bank));

  const qdrant = createRepo(process.env['QDRANT_URL'], process.env['QDRANT_API_KEY']);
  await qdrant.ensureCollection();

  const scroll: FacetScrollFn = (f, limit) => qdrant.scroll(f, limit);
  const facets = sortFacets(await aggregate('tags', scroll, filter), sort);

  if (flags.json) {
    output.result(
      {
        tags: facets,
        total: facets.length,
        scope,
        repos: resolvedRepos,
        bank: readFlags.bank,
        kind: readFlags.kind,
        ...(readFlags.session !== undefined ? { session: readFlags.session } : {}),
        ...(readFlags.asOf !== undefined ? { as_of: readFlags.asOf } : {}),
      },
      { json: true },
    );
    return;
  }

  if (facets.length === 0) {
    output.result('No tags found.');
    return;
  }

  const lines = [`Tags (${String(facets.length)} total):`];
  for (const { name, count } of facets) {
    lines.push(`  ${name}  (${String(count)} ${count === 1 ? 'entry' : 'entries'})`);
  }
  output.result(lines.join('\n'));
}

const tagsList = new Command('list')
  .description('List all unique tags with entry counts')
  .option('--scope <scope>', 'repo|related (default: repo)')
  .option('--sort <order>', 'alpha|frequency (default: alpha)')
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
  .action(async (opts: Record<string, unknown>) => {
    await handleTagsList({
      scope: opts['scope'] as string | undefined,
      json: opts['json'] as boolean | undefined,
      sort: opts['sort'] as string | undefined,
      bank: opts['bank'] as string | undefined,
      kind: opts['kind'] as string | undefined,
      session: opts['session'] as string | undefined,
      includeArchived: opts['includeArchived'] as boolean | undefined,
      includeSuperseded: opts['includeSuperseded'] as boolean | undefined,
      asOf: opts['asOf'] as string | undefined,
    });
  });

const tags = new Command('tags').description('Tag management commands');
tags.addCommand(tagsList);

export default tags;
