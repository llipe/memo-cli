import { Command } from 'commander';
import { MemoError } from '../lib/errors.js';
import { output } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';
import type { QdrantFilter, ScrollResult } from '../lib/qdrant.js';

export interface DeleteFlags {
  id?: string;
  allByRepo?: string;
  allByOrg?: string;
  json?: boolean;
  yes?: boolean;
}

export interface DeleteDeps {
  createRepo?: (url?: string, key?: string) => QdrantRepository;
  confirm?: (message: string) => Promise<boolean>;
}

function pluralize(count: number): string {
  return count === 1 ? 'entry' : 'entries';
}

function parseMode(flags: DeleteFlags): 'single' | 'bulk-repo' | 'bulk-org' {
  const hasId = Boolean(flags.id);
  const hasRepo = Boolean(flags.allByRepo);
  const hasOrg = Boolean(flags.allByOrg);

  if (hasId && (hasRepo || hasOrg)) {
    throw new MemoError(
      'VALIDATION_FAILED',
      '--id cannot be combined with --all-by-repo or --all-by-org.',
    );
  }

  if (hasRepo && hasOrg) {
    throw new MemoError('VALIDATION_FAILED', '--all-by-repo and --all-by-org cannot be combined.');
  }

  if (!hasId && !hasRepo && !hasOrg) {
    throw new MemoError(
      'VALIDATION_FAILED',
      'Provide one deletion target: --id, --all-by-repo, or --all-by-org.',
    );
  }

  if ((hasRepo || hasOrg) && flags.json) {
    throw new MemoError('VALIDATION_FAILED', 'Bulk delete is not supported in agent mode (--json)');
  }

  if (hasId) return 'single';
  if (hasRepo) return 'bulk-repo';
  return 'bulk-org';
}

async function defaultConfirm(message: string): Promise<boolean> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return false;
  }

  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${message} `);
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

function buildHasIdFilter(id: string): QdrantFilter {
  return { must: [{ has_id: [id] }] };
}

function buildNamedFilter(key: 'repo' | 'org', value: string): QdrantFilter {
  return { must: [{ key, match: { value } }] };
}

function formatEntryPreview(entry: ScrollResult): string {
  const payload = entry.payload ?? {};
  const repo = typeof payload['repo'] === 'string' ? payload['repo'] : 'unknown-repo';
  const org = typeof payload['org'] === 'string' ? payload['org'] : 'unknown-org';
  const rationale =
    typeof payload['rationale'] === 'string' && payload['rationale'].trim().length > 0
      ? payload['rationale'].trim().replace(/\s+/g, ' ')
      : 'No rationale provided.';
  const lead = rationale.length > 90 ? `${rationale.slice(0, 87)}...` : rationale;

  return `About to delete entry id:${String(entry.id)} (repo:${repo}, org:${org})\n  ${lead}`;
}

export async function handleDelete(flags: DeleteFlags, deps: DeleteDeps = {}): Promise<void> {
  const { createRepo = (url, key) => new QdrantRepository(url, key), confirm = defaultConfirm } =
    deps;

  const mode = parseMode(flags);
  const qdrant = createRepo(process.env['QDRANT_URL'], process.env['QDRANT_API_KEY']);
  await qdrant.ensureCollection();

  if (mode === 'single') {
    const id = flags.id;
    if (!id) {
      throw new MemoError('VALIDATION_FAILED', 'Missing required --id value.');
    }

    if (!flags.json) {
      const preview = await qdrant.scroll(buildHasIdFilter(id), 1);
      if (preview.length === 0) {
        throw new MemoError('ENTRY_NOT_FOUND', `Entry not found: ${id}`);
      }

      const entry = preview[0];
      if (!entry) {
        throw new MemoError('ENTRY_NOT_FOUND', `Entry not found: ${id}`);
      }

      output.result(formatEntryPreview(entry));

      if (!flags.yes) {
        const accepted = await confirm('Are you sure? (y/N)');
        if (!accepted) {
          output.result('Deletion cancelled.');
          return;
        }
      }
    }

    await qdrant.deleteById(id);

    if (flags.json) {
      output.result(
        {
          deleted: true,
          id,
          scope: 'single',
          count: 1,
        },
        { json: true },
      );
      return;
    }

    output.result(`Deleted 1 entry (id: ${id})`);
    return;
  }

  const key = mode === 'bulk-repo' ? 'repo' : 'org';
  const value = mode === 'bulk-repo' ? flags.allByRepo : flags.allByOrg;
  if (!value) {
    throw new MemoError('VALIDATION_FAILED', `Missing required --all-by-${key} value.`);
  }
  const filter = buildNamedFilter(key, value);
  const matched = await qdrant.scroll(filter, 10_000);

  if (matched.length === 0) {
    output.result(`No entries found for ${key} ${value}`);
    return;
  }

  if (!flags.yes) {
    const accepted = await confirm(
      `About to delete ${String(matched.length)} ${pluralize(matched.length)} for ${key} ${value}. Are you sure? (y/N)`,
    );
    if (!accepted) {
      output.result('Deletion cancelled.');
      return;
    }
  }

  const deletedCount = await qdrant.deleteByFilter(filter);

  if (deletedCount === 0) {
    output.result(`No entries found for ${key} ${value}`);
    return;
  }

  output.result(`Deleted ${String(deletedCount)} ${pluralize(deletedCount)} (${key}: ${value})`);
}

const del = new Command('delete')
  .description('Delete memo entries safely by id or by scope')
  .option('--id <id>', 'delete a single entry by point id')
  .option('--all-by-repo <repo>', 'delete all entries for a repository (interactive only)')
  .option('--all-by-org <org>', 'delete all entries for an organization (interactive only)')
  .option('--json', 'output as JSON (single delete only)')
  .option('--yes', 'skip interactive confirmation')
  .action(async (opts: Record<string, unknown>) => {
    await handleDelete({
      id: opts['id'] as string | undefined,
      allByRepo: opts['allByRepo'] as string | undefined,
      allByOrg: opts['allByOrg'] as string | undefined,
      json: opts['json'] as boolean | undefined,
      yes: opts['yes'] as boolean | undefined,
    });
  });

export default del;
