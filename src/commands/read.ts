import { Command } from 'commander';
import { MemoError } from '../lib/errors.js';
import { output } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';

export interface ReadFlags {
  id?: string;
  json?: boolean;
}

export interface ReadDeps {
  createRepo?: (url?: string, key?: string) => QdrantRepository;
}

const DISPLAY_ORDER = [
  'id',
  'repo',
  'org',
  'domain',
  'entry_type',
  'source',
  'confidence',
  'tags',
  'rationale',
  'commit',
  'story',
  'files_modified',
  'relates_to',
  'timestamp_utc',
] as const;

function requireId(value?: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new MemoError('VALIDATION_FAILED', 'Missing required --id value.');
  }
  return normalized;
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(', ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

function renderHuman(result: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const key of DISPLAY_ORDER) {
    const value = result[key];
    if (!isPresent(value)) continue;
    lines.push(`${key}: ${formatValue(value)}`);
  }

  for (const [key, value] of Object.entries(result)) {
    if (DISPLAY_ORDER.includes(key as (typeof DISPLAY_ORDER)[number])) continue;
    if (!isPresent(value)) continue;
    lines.push(`${key}: ${formatValue(value)}`);
  }

  return lines.join('\n');
}

export async function handleRead(flags: ReadFlags, deps: ReadDeps = {}): Promise<void> {
  const { createRepo = (url, key) => new QdrantRepository(url, key) } = deps;

  const id = requireId(flags.id);
  const qdrant = createRepo(process.env['QDRANT_URL'], process.env['QDRANT_API_KEY']);
  await qdrant.ensureCollection();

  const entry = await qdrant.getById(id);
  if (!entry) {
    throw new MemoError('ENTRY_NOT_FOUND', `Entry not found: ${id}`);
  }

  const response: Record<string, unknown> = {
    ...(entry.payload ?? {}),
    id: entry.id,
  };

  if (flags.json) {
    output.result(response, { json: true });
    return;
  }

  output.result(renderHuman(response));
}

const read = new Command('read')
  .description('Read a single memo entry by id')
  .requiredOption('--id <id>', 'entry id (Qdrant point id)')
  .option('--json', 'output as JSON')
  .action(async (opts: Record<string, unknown>) => {
    await handleRead({
      id: opts['id'] as string | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

export default read;
