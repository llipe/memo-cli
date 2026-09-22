import { Command } from 'commander';
import { normalizeEntry } from '../lib/entry-normalize.js';
import { MemoError } from '../lib/errors.js';
import { output } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';
import type { ScrollResult } from '../lib/qdrant.js';

export interface ReadFlags {
  id?: string;
  json?: boolean;
  /**
   * S2-05 AC1: `read` accepts only `--include-archived`/`--include-superseded`
   * - an id is explicit, so `--bank`/`--kind`/`--session`/`--as-of` do not
   * apply and are rejected below. These two are accepted for CLI-surface
   * consistency with the other read commands but have no filtering effect
   * on `getById`, which already fetches the exact id regardless of state.
   */
  bank?: string;
  kind?: string;
  session?: string;
  asOf?: string;
  includeArchived?: boolean;
  includeSuperseded?: boolean;
}

export interface ReadDeps {
  createRepo?: (url?: string, key?: string) => QdrantRepository;
}

/** A single resolved provenance entry (S2-05 AC9): `deleted` when the id no longer exists. */
export interface ProvenanceEntry {
  id: string;
  deleted: boolean;
}

const DISPLAY_ORDER = [
  'id',
  'bank',
  'kind',
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
  'session_id',
  'seq',
  'valid_from',
  'valid_to',
  'superseded_by',
  'provenance',
  'archived',
  'superseded',
  'consolidated',
  'pinned',
  'pending_contradiction',
  'schema_version',
  'timestamp_utc',
] as const;

function requireId(value?: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new MemoError('VALIDATION_FAILED', 'Missing required --id value.');
  }
  return normalized;
}

/**
 * S2-05 AC1/EC-12: `read`'s id is explicit, so the shared bank/kind/session/
 * as-of disambiguation flags do not apply here - passing any of them is a
 * user error, not a silently-ignored no-op.
 */
function rejectDisallowedFlags(flags: ReadFlags): void {
  if (
    flags.bank !== undefined ||
    flags.kind !== undefined ||
    flags.session !== undefined ||
    flags.asOf !== undefined
  ) {
    throw new MemoError(
      'VALIDATION_FAILED',
      '`memo read` accepts only --include-archived/--include-superseded; --bank/--kind/--session/--as-of do not apply when an id is given explicitly.',
    );
  }
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function formatValue(key: string, value: unknown): string {
  // S2-05 AC9: provenance renders as `id` or `id (deleted)` per entry,
  // never the generic array-join formatting below.
  if (key === 'provenance' && Array.isArray(value)) {
    return (value as ProvenanceEntry[])
      .map((entry) => (entry.deleted ? `${entry.id} (deleted)` : entry.id))
      .join(', ');
  }
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(', ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

function renderHuman(result: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const key of DISPLAY_ORDER) {
    const value = result[key];
    if (!isPresent(value)) continue;
    lines.push(`${key}: ${formatValue(key, value)}`);
  }

  for (const [key, value] of Object.entries(result)) {
    if (DISPLAY_ORDER.includes(key as (typeof DISPLAY_ORDER)[number])) continue;
    if (!isPresent(value)) continue;
    lines.push(`${key}: ${formatValue(key, value)}`);
  }

  return lines.join('\n');
}

/**
 * S2-05 AC9/Technical Notes: resolves `provenance` (a list of source
 * episodic entry ids, K3) with exactly one `scroll({ has_id: provenance })`
 * call, capped at the array's own length - never a `getById`-per-id loop,
 * never batched or truncated regardless of array size (EC-14). An id
 * missing from the scroll result is reported `deleted: true`.
 */
async function resolveProvenance(
  qdrant: QdrantRepository,
  provenanceIds: string[],
): Promise<ProvenanceEntry[]> {
  if (provenanceIds.length === 0) return [];

  const found: ScrollResult[] = await qdrant.scroll(
    { must: [{ has_id: provenanceIds }] },
    provenanceIds.length,
  );
  const foundIds = new Set(found.map((result) => String(result.id)));

  return provenanceIds.map((id) => ({ id, deleted: !foundIds.has(id) }));
}

export async function handleRead(flags: ReadFlags, deps: ReadDeps = {}): Promise<void> {
  const { createRepo = (url, key) => new QdrantRepository(url, key) } = deps;

  const id = requireId(flags.id);
  rejectDisallowedFlags(flags);

  const qdrant = createRepo(process.env['QDRANT_URL'], process.env['QDRANT_API_KEY']);
  await qdrant.ensureCollection();

  const entry = await qdrant.getById(id);
  if (!entry) {
    throw new MemoError('ENTRY_NOT_FOUND', `Entry not found: ${id}`);
  }

  // S2-05 AC9: every v2 field present is shown - `normalizeEntry` supplies
  // the v1-fallback defaults (bank/kind/schema_version/archived/superseded/
  // consolidated/pinned/pending_contradiction/valid_from), unlike
  // `search`/`list`'s additive-only, present-when-true-only projection
  // (AC8) - `read` is a full diagnostic view of one entry, not a
  // backward-compatible list row.
  const normalized = normalizeEntry(entry.payload ?? {});

  const rawProvenance = normalized['provenance'];
  const provenanceIds = Array.isArray(rawProvenance)
    ? rawProvenance.filter((value): value is string => typeof value === 'string')
    : undefined;
  const provenance =
    provenanceIds !== undefined ? await resolveProvenance(qdrant, provenanceIds) : undefined;

  const response: Record<string, unknown> = {
    ...normalized,
    id: entry.id,
    ...(provenance !== undefined ? { provenance } : {}),
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
  .option('--bank <id>', 'not applicable to `read` — an id is explicit (rejected)')
  .option('--kind <kind>', 'not applicable to `read` — an id is explicit (rejected)')
  .option('--session <id>', 'not applicable to `read` — an id is explicit (rejected)')
  .option('--as-of <iso>', 'not applicable to `read` — an id is explicit (rejected)')
  .option('--include-archived', 'accepted for CLI-surface consistency; no filtering effect')
  .option('--include-superseded', 'accepted for CLI-surface consistency; no filtering effect')
  .option('--json', 'output as JSON')
  .action(async (opts: Record<string, unknown>) => {
    await handleRead({
      id: opts['id'] as string | undefined,
      bank: opts['bank'] as string | undefined,
      kind: opts['kind'] as string | undefined,
      session: opts['session'] as string | undefined,
      asOf: opts['asOf'] as string | undefined,
      includeArchived: opts['includeArchived'] as boolean | undefined,
      includeSuperseded: opts['includeSuperseded'] as boolean | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

export default read;
