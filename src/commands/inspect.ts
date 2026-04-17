import { Command } from 'commander';
import { aggregateMultipleFields } from '../lib/facets.js';
import { output } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';
import type { FacetScrollFn, MultiFacetResult, RepoFacetEntry } from '../lib/facets.js';

export interface InspectFlags {
  orgs?: boolean;
  repos?: boolean;
  domains?: boolean;
  json?: boolean;
}

export interface InspectDeps {
  createRepo?: (url?: string, key?: string) => QdrantRepository;
  aggregate?: typeof aggregateMultipleFields;
}

function hasEntries(facets: MultiFacetResult): boolean {
  return facets.orgs.length > 0 || facets.repos.length > 0 || facets.domains.length > 0;
}

function sortByAlpha<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

export async function handleInspect(flags: InspectFlags, deps: InspectDeps = {}): Promise<void> {
  const {
    createRepo = (url, key) => new QdrantRepository(url, key),
    aggregate = aggregateMultipleFields,
  } = deps;

  const qdrant = createRepo(process.env['QDRANT_URL'], process.env['QDRANT_API_KEY']);
  await qdrant.ensureCollection();

  const scroll: FacetScrollFn = (f, limit) => qdrant.scroll(f, limit);
  const facets = await aggregate(scroll);

  const showOrgs = !flags.repos && !flags.domains;
  const showRepos = !flags.orgs && !flags.domains;
  const showDomains = !flags.orgs && !flags.repos;

  // When facet flags narrow down to something, respect that selection
  const filterOrgs = flags.orgs === true;
  const filterRepos = flags.repos === true;
  const filterDomains = flags.domains === true;

  const anyFacetFlag = filterOrgs || filterRepos || filterDomains;

  const displayOrgs = anyFacetFlag ? filterOrgs : showOrgs;
  const displayRepos = anyFacetFlag ? filterRepos : showRepos;
  const displayDomains = anyFacetFlag ? filterDomains : showDomains;

  const orgs = displayOrgs ? sortByAlpha(facets.orgs) : [];
  const repos = displayRepos ? sortByAlpha(facets.repos) : [];
  const domains = displayDomains ? sortByAlpha(facets.domains) : [];

  const totalEntries = orgs.length + repos.length + domains.length;

  if (!hasEntries(facets)) {
    output.result('No entries found.');
    return;
  }

  if (flags.json) {
    const jsonResult: Record<string, unknown> = {};
    if (displayOrgs) jsonResult['orgs'] = orgs.map(({ name, count }) => ({ name, count }));
    if (displayRepos) {
      jsonResult['repos'] = repos.map((r: RepoFacetEntry) => {
        const entry: Record<string, unknown> = { name: r.name, count: r.count };
        if (r.org) entry['org'] = r.org;
        if (r.domain) entry['domain'] = r.domain;
        return entry;
      });
    }
    if (displayDomains) jsonResult['domains'] = domains.map(({ name, count }) => ({ name, count }));
    output.result(jsonResult, { json: true });
    return;
  }

  if (totalEntries === 0) {
    output.result('No entries found.');
    return;
  }

  const lines: string[] = [];

  if (displayOrgs && orgs.length > 0) {
    lines.push(`Organizations (${String(orgs.length)}):`);
    for (const { name, count } of orgs) {
      lines.push(`  ${name}  (${String(count)} ${count === 1 ? 'entry' : 'entries'})`);
    }
  }

  if (displayRepos && repos.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`Repositories (${String(repos.length)}):`);
    for (const r of repos) {
      const annotation = r.domain ? `  [${r.domain}]` : '';
      lines.push(
        `  ${r.name}${annotation}  (${String(r.count)} ${r.count === 1 ? 'entry' : 'entries'})`,
      );
    }
  }

  if (displayDomains && domains.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`Domains (${String(domains.length)}):`);
    for (const { name, count } of domains) {
      lines.push(`  ${name}  (${String(count)} ${count === 1 ? 'entry' : 'entries'})`);
    }
  }

  output.result(lines.join('\n'));
}

const inspect = new Command('inspect')
  .description('Inspect all entries by org, repo, and domain facets')
  .option('--orgs', 'show only organizations facet')
  .option('--repos', 'show only repositories facet')
  .option('--domains', 'show only domains facet')
  .option('--json', 'output as JSON')
  .action(async (opts: Record<string, unknown>) => {
    await handleInspect({
      orgs: opts['orgs'] as boolean | undefined,
      repos: opts['repos'] as boolean | undefined,
      domains: opts['domains'] as boolean | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

export default inspect;
