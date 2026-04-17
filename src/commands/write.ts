import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../lib/config.js';
import {
  buildDedupeKey,
  buildEmbedText,
  consolidate,
  sourceToConfidence,
  update,
} from '../lib/dedupe.js';
import { createEmbeddingsAdapter } from '../lib/embeddings.js';
import { MemoError } from '../lib/errors.js';
import { output } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';
import { EntryPayloadSchema } from '../types/entry.js';
import type { EntryPayload } from '../types/entry.js';

export type DuplicateAction = 'consolidate' | 'update' | 'replace' | 'create-new';

export interface WriteFlags {
  rationale: string;
  tags: string;
  repo?: string;
  org?: string;
  domain?: string;
  entryType?: string;
  source?: string;
  story?: string;
  commit?: string;
  files?: string;
  relatesTo?: string;
  onDuplicate?: string;
  json?: boolean;
}

export interface WriteDeps {
  loadCfg?: typeof loadConfig;
  createRepo?: (url?: string, key?: string) => QdrantRepository;
  createEmbeddings?: typeof createEmbeddingsAdapter;
  promptDuplicate?: (existing: EntryPayload) => Promise<DuplicateAction | null>;
}

async function defaultPromptDuplicate(): Promise<DuplicateAction | null> {
  if (!process.stdout.isTTY) return null;
  const { createInterface } = await import('node:readline');
  const actions: DuplicateAction[] = ['consolidate', 'update', 'replace', 'create-new'];
  let selected = 0;

  process.stdout.write('\n  Duplicate entry detected. Choose resolution:\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  const render = (): void => {
    actions.forEach((a, i) => {
      const marker = i === selected ? '▶ ' : '  ';
      process.stdout.write(`  ${marker}${a}\n`);
    });
  };

  render();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    process.stdin.on('data', (key: string) => {
      if (key === '\u001B[A' && selected > 0) {
        process.stdout.moveCursor(0, -actions.length);
        selected--;
        render();
      } else if (key === '\u001B[B' && selected < actions.length - 1) {
        process.stdout.moveCursor(0, -actions.length);
        selected++;
        render();
      } else if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        rl.close();
        resolve(actions[selected] ?? null);
      } else if (key === '\u0003') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        rl.close();
        resolve(null);
      }
    });
  });
}

export async function handleWrite(flags: WriteFlags, deps: WriteDeps = {}): Promise<void> {
  const {
    loadCfg = loadConfig,
    createRepo = (url, key) => new QdrantRepository(url, key),
    createEmbeddings = createEmbeddingsAdapter,
    promptDuplicate = defaultPromptDuplicate,
  } = deps;

  // Parse tags
  const tags = flags.tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Resolve context
  const cfg = await loadCfg().catch((err: unknown) => {
    if (
      err instanceof MemoError &&
      (err.code === 'CONFIG_NOT_FOUND' || err.code === 'CONFIG_INVALID')
    ) {
      return null;
    }
    throw err;
  });

  const repo = flags.repo ?? cfg?.repo;
  const org = flags.org ?? cfg?.org;
  const domain = flags.domain ?? cfg?.domain;

  if (!repo || !org || !domain) {
    throw new MemoError(
      'REPO_CONTEXT_UNRESOLVED',
      'Could not resolve repo context. Provide --repo, --org, and --domain or run `memo setup init`.',
    );
  }

  const source = (flags.source ?? cfg?.defaults.source ?? 'agent') as 'agent' | 'manual';
  const entry_type = (flags.entryType ?? 'decision') as
    | 'decision'
    | 'integration_point'
    | 'structure';
  const confidence = sourceToConfidence(source);
  const now = new Date().toISOString();
  const id = randomUUID();

  // Compute dedupe key
  const dedupe_key_sha256 = buildDedupeKey({
    repo,
    commit: flags.commit,
    story: flags.story,
    entry_type,
    source,
  });

  // Build full payload (pre-validation)
  const rawPayload = {
    id,
    repo,
    org,
    domain,
    rationale: flags.rationale,
    tags,
    entry_type,
    source,
    confidence,
    timestamp_utc: now,
    commit: flags.commit,
    story: flags.story,
    files_modified: flags.files
      ? flags.files
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f.length > 0)
      : undefined,
    relates_to: flags.relatesTo
      ? flags.relatesTo
          .split(',')
          .map((r) => r.trim())
          .filter((r) => r.length > 0)
      : undefined,
    dedupe_key_sha256,
    dedupe_key_version: 'v1' as const,
  };

  // Validate with Zod
  const parsed = EntryPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    const messages = parsed.error.errors
      .map((e) => `  • ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new MemoError('VALIDATION_FAILED', `Entry validation failed:\n${messages}`);
  }

  const payload: EntryPayload = parsed.data;

  const repo_url = process.env['QDRANT_URL'];
  const repo_key = process.env['QDRANT_API_KEY'];
  const qdrant = createRepo(repo_url, repo_key);
  const embeddings = createEmbeddings();

  // Auto-bootstrap collection
  await qdrant.ensureCollection();

  // Dedupe lookup
  const existing = await qdrant.getByDedupeKey(dedupe_key_sha256);
  let finalPayload = payload;
  let created = true;
  let updated = false;
  let duplicate_detected = false;

  if (existing) {
    duplicate_detected = true;
    const existingPayload = existing.payload as EntryPayload | undefined;

    let action: DuplicateAction | null = null;

    if (flags.onDuplicate) {
      const validActions: DuplicateAction[] = ['consolidate', 'update', 'replace', 'create-new'];
      if (!validActions.includes(flags.onDuplicate as DuplicateAction)) {
        throw new MemoError(
          'VALIDATION_FAILED',
          `Invalid --on-duplicate value "${flags.onDuplicate}". Valid values: consolidate, update, replace, create-new.`,
        );
      }
      action = flags.onDuplicate as DuplicateAction;
    } else if (flags.json) {
      output.error(
        'VALIDATION_FAILED',
        'Duplicate entry detected for repo+commit. Re-run with --on-duplicate consolidate|update|replace|create-new.',
        { json: true },
      );
      process.exit(1);
    } else {
      action = await promptDuplicate(existingPayload ?? payload);
      if (action === null) {
        output.info('Write cancelled.');
        return;
      }
    }

    if (action === 'consolidate' && existingPayload) {
      finalPayload = consolidate(existingPayload, payload);
      created = false;
      updated = true;
    } else if (action === 'update' && existingPayload) {
      finalPayload = update(existingPayload, payload);
      created = false;
      updated = true;
    } else if (action === 'replace') {
      // New entry with new id but same dedupe key — treat as a new independent entry
      finalPayload = { ...payload, id: randomUUID() };
      created = true;
    }
    // create-new: keep original payload with new uuid (already set above)
  }

  const spinner = output.spinner('Embedding and storing entry…');
  spinner.start();

  try {
    const embedText = buildEmbedText(finalPayload.rationale, finalPayload.tags);
    const vector = await embeddings.embed(embedText);
    await qdrant.upsert(
      finalPayload.id,
      vector,
      finalPayload as unknown as Record<string, unknown>,
    );
    spinner.succeed('Entry stored.');
  } catch (err) {
    spinner.fail('Failed to store entry.');
    throw err;
  }

  const resultData = { ...finalPayload, created, updated, duplicate_detected };
  output.result(resultData, { json: flags.json });
}

const write = new Command('write')
  .description('Write a decision entry to the memo store')
  .requiredOption('-r, --rationale <text>', 'rationale text (required)')
  .requiredOption('-t, --tags <csv>', 'comma-separated tags (2–5, kebab-case, required)')
  .option('--repo <name>', 'repository name (overrides config)')
  .option('--org <name>', 'organization name (overrides config)')
  .option('--domain <name>', 'domain name (overrides config)')
  .option('--entry-type <type>', 'decision|integration_point|structure (default: decision)')
  .option('--source <source>', 'agent|manual (default: agent)')
  .option('--story <story>', 'story identifier (optional)')
  .option('--commit <sha>', 'git commit SHA (optional)')
  .option('--files <csv>', 'comma-separated modified files (optional)')
  .option('--relates-to <csv>', 'comma-separated related repo names (optional)')
  .option(
    '--on-duplicate <action>',
    'consolidate|update|replace|create-new (skips interactive prompt)',
  )
  .option('--json', 'output as JSON')
  .addHelpText(
    'after',
    '\nNote: --confidence is not a valid flag. Confidence is inferred from --source.',
  )
  .action(async (opts: Record<string, unknown>) => {
    if ('confidence' in opts) {
      throw new MemoError(
        'VALIDATION_FAILED',
        '--confidence is not a valid flag. Confidence is inferred from --source (agent→high, manual→medium).',
      );
    }
    await handleWrite({
      rationale: opts['rationale'] as string,
      tags: opts['tags'] as string,
      repo: opts['repo'] as string | undefined,
      org: opts['org'] as string | undefined,
      domain: opts['domain'] as string | undefined,
      entryType: opts['entryType'] as string | undefined,
      source: opts['source'] as string | undefined,
      story: opts['story'] as string | undefined,
      commit: opts['commit'] as string | undefined,
      files: opts['files'] as string | undefined,
      relatesTo: opts['relatesTo'] as string | undefined,
      onDuplicate: opts['onDuplicate'] as string | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

export default write;
