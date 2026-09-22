import { Command } from 'commander';
import chalk from 'chalk';
import { resolveBank } from '../lib/bank.js';
import { normalizeEntry, projectV2Fields } from '../lib/entry-normalize.js';
import { MemoError } from '../lib/errors.js';
import { buildBaseFilter, mergeFilters } from '../lib/filters.js';
import { output } from '../lib/output.js';
import type { TimelineHumanGroup, TimelineHumanResult } from '../lib/output.js';
import { QdrantRepository } from '../lib/qdrant.js';
import type { ScrollResult } from '../lib/qdrant.js';
import { DATE_ONLY, isValidCalendarDate, parseDateParts } from '../lib/iso-date.js';

/**
 * `memo timeline` (spec §18.8, S2-06). Replays `kind = episodic` history in
 * order - `seq` asc then `timestamp_utc` asc when `--session` is given,
 * else the shipped `timestamp_utc desc` scroll grouped by `session_id`.
 * Never embeds, never ranks (AC4): this file imports no embeddings adapter
 * and never calls `rankResults`.
 */
export interface TimelineFlags {
  bank?: string;
  session?: string;
  last?: string | number;
  since?: string;
  json?: boolean;
}

export interface TimelineDeps {
  createRepo?: (url?: string, key?: string) => QdrantRepository;
}

const DEFAULT_LAST = 50;
const MAX_LAST = 500;

/**
 * Validates and resolves `--last` (default 50, max 500). `0` or any
 * non-positive-integer value fails `VALIDATION_FAILED` (§18.14 item 7,
 * EC-1). A value above 500 clamps to 500 and is reported via `clamped`
 * (EC-2) - the caller warns on stderr only (§18.14 item 8).
 */
function parseLast(value: string | number | undefined): { limit: number; clamped: boolean } {
  if (value === undefined) return { limit: DEFAULT_LAST, clamped: false };

  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new MemoError('VALIDATION_FAILED', '--last must be a positive integer.');
  }
  if (parsed > MAX_LAST) {
    return { limit: MAX_LAST, clamped: true };
  }
  return { limit: parsed, clamped: false };
}

/**
 * Validates and normalizes `--since` to an ISO 8601 datetime (AC3): a
 * date-only value normalizes to midnight UTC (matching the `--from`
 * convention in `list-filters.ts`'s `normalizeIsoBoundary`); any other
 * unparseable string fails `VALIDATION_FAILED` (SC-4). A date-only value
 * must also be a real calendar date (issue #98) - `2026-13-40` fails even
 * though it matches the `DATE_ONLY` shape.
 */
function parseSince(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new MemoError('VALIDATION_FAILED', '--since must not be empty.');
  }

  if (DATE_ONLY.test(trimmed)) {
    const [year, month, day] = parseDateParts(trimmed);
    if (!isValidCalendarDate(year, month, day)) {
      throw new MemoError(
        'VALIDATION_FAILED',
        `Invalid --since value "${value}". Not a real calendar date.`,
      );
    }
    return `${trimmed}T00:00:00.000Z`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new MemoError(
      'VALIDATION_FAILED',
      `Invalid --since value "${value}". Use an ISO 8601 date (YYYY-MM-DD) or datetime.`,
    );
  }
  return parsed.toISOString();
}

function payloadOf(point: ScrollResult): Record<string, unknown> {
  return point.payload ?? {};
}

/**
 * Client-side tie-break (spec §18.8, Technical Notes): `seq` asc, ties
 * (only possible with an explicit `--seq` collision) broken by
 * `timestamp_utc` asc. Never trusts the mocked/returned repo order (EC-4,
 * RT-1).
 */
function sortSessionEntries(points: ScrollResult[]): ScrollResult[] {
  return [...points].sort((a, b) => {
    const payloadA = payloadOf(a);
    const payloadB = payloadOf(b);
    const seqA = typeof payloadA['seq'] === 'number' ? payloadA['seq'] : 0;
    const seqB = typeof payloadB['seq'] === 'number' ? payloadB['seq'] : 0;
    if (seqA !== seqB) return seqA - seqB;

    const tsA = typeof payloadA['timestamp_utc'] === 'string' ? payloadA['timestamp_utc'] : '';
    const tsB = typeof payloadB['timestamp_utc'] === 'string' ? payloadB['timestamp_utc'] : '';
    if (tsA < tsB) return -1;
    if (tsA > tsB) return 1;
    return 0;
  });
}

interface SessionGroup {
  session_id: string;
  entries: ScrollResult[];
}

/**
 * Groups the `timestamp_utc desc` scroll result by `session_id`, preserving
 * both group first-appearance order and each entry's relative order within
 * its group (RT-2) - never re-sorts within a group.
 */
function groupBySession(points: ScrollResult[]): SessionGroup[] {
  const order: string[] = [];
  const groups = new Map<string, ScrollResult[]>();

  for (const point of points) {
    const payload = payloadOf(point);
    const sessionId = typeof payload['session_id'] === 'string' ? payload['session_id'] : 'unknown';
    if (!groups.has(sessionId)) {
      order.push(sessionId);
      groups.set(sessionId, []);
    }
    groups.get(sessionId)?.push(point);
  }

  return order.map((sessionId) => ({
    session_id: sessionId,
    entries: groups.get(sessionId) ?? [],
  }));
}

/** Projects a point to its JSON entry shape (matches `list.ts`'s `toJsonResult` convention). */
function toJsonEntry(point: ScrollResult): Record<string, unknown> {
  const payload = payloadOf(point);
  return {
    id: point.id,
    ...payload,
    ...projectV2Fields(normalizeEntry(payload)),
  };
}

function toHumanResult(entry: Record<string, unknown>): TimelineHumanResult {
  return {
    id: entry['id'] as string | number,
    seq: typeof entry['seq'] === 'number' ? entry['seq'] : undefined,
    timestamp_utc: typeof entry['timestamp_utc'] === 'string' ? entry['timestamp_utc'] : undefined,
    rationale: typeof entry['rationale'] === 'string' ? entry['rationale'] : undefined,
  };
}

export async function handleTimeline(flags: TimelineFlags, deps: TimelineDeps = {}): Promise<void> {
  const { createRepo = (url, key) => new QdrantRepository(url, key) } = deps;

  const bank = resolveBank(flags.bank, process.env);
  const since = parseSince(flags.since);
  const { limit, clamped } = parseLast(flags.last);

  if (clamped) {
    process.stderr.write(
      chalk.yellow(`--last clamped to ${String(MAX_LAST)} (requested ${String(flags.last)}).`) +
        '\n',
    );
  }

  const base = buildBaseFilter({
    bank,
    kind: 'episodic',
    ...(flags.session !== undefined ? { session: flags.session } : {}),
  });
  const filter =
    since !== undefined
      ? mergeFilters(base, { must: [{ key: 'timestamp_utc', range: { gte: since } }] })
      : base;

  const qdrant = createRepo(process.env['QDRANT_URL'], process.env['QDRANT_API_KEY']);
  await qdrant.ensureCollection();

  if (flags.session !== undefined) {
    const points = await qdrant.scrollOrdered(filter, {
      orderBy: { key: 'seq', direction: 'asc' },
      limit,
    });
    const sorted = sortSessionEntries(points);
    const entries = sorted.map(toJsonEntry);

    if (flags.json) {
      output.result(
        { bank, session_id: flags.session, entries, count: entries.length },
        { json: true },
      );
      return;
    }

    if (entries.length === 0) {
      output.timelineEmpty();
      return;
    }

    output.timelineSession(entries.map(toHumanResult));
    return;
  }

  const points = await qdrant.scroll(filter, limit);
  const groups = groupBySession(points);
  const sessions = groups.map((group) => ({
    session_id: group.session_id,
    entries: group.entries.map(toJsonEntry),
  }));
  const count = sessions.reduce((sum, group) => sum + group.entries.length, 0);

  if (flags.json) {
    output.result({ bank, sessions, count }, { json: true });
    return;
  }

  if (count === 0) {
    output.timelineEmpty();
    return;
  }

  const humanGroups: TimelineHumanGroup[] = sessions.map((group) => ({
    session_id: group.session_id,
    entries: group.entries.map(toHumanResult),
  }));
  output.timelineGrouped(humanGroups);
}

const timeline = new Command('timeline')
  .description('Replay episodic memory in sequence order - never ranked (spec §18.8)')
  .option('--bank <id>', 'bank id (default: MEMO_BANK, config.bank.default, or "kb")')
  .option('--session <id>', 'restrict to one episodic session, ordered by seq asc')
  .option('--last <n>', 'maximum number of entries (default 50, max 500)')
  .option('--since <iso>', 'inclusive ISO 8601 lower bound for timestamp_utc')
  .option('--json', 'output as JSON')
  .action(async (opts: Record<string, unknown>) => {
    await handleTimeline({
      bank: opts['bank'] as string | undefined,
      session: opts['session'] as string | undefined,
      last: opts['last'] as string | undefined,
      since: opts['since'] as string | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

export default timeline;
