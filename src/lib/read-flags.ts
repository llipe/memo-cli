import type { MemoConfig } from '../types/config.js';
import type { EntryKind } from '../types/entry.js';
import { resolveBank } from './bank.js';
import { MemoError } from './errors.js';
import { DATE_ONLY, ISO_DATETIME, isValidCalendarDate, parseDateParts } from './iso-date.js';

/** Raw, unvalidated CLI-facing flags shared by `search`, `list`, `tags list`, and `read` (spec §18.7). */
export interface RawReadFlags {
  bank?: string;
  kind?: string;
  session?: string;
  includeArchived?: boolean;
  includeSuperseded?: boolean;
  asOf?: string;
}

/** The validated, normalized result of `parseReadFlags` (spec §18.7). */
export interface ParsedReadFlags {
  bank: string;
  kind: EntryKind | 'all';
  session?: string;
  includeArchived: boolean;
  includeSuperseded: boolean;
  asOf?: string;
}

const VALID_KINDS = new Set<string>(['self', 'episodic', 'semantic', 'all']);

/**
 * Validates and lowercases `--kind` (§18.14 item 5: case-insensitive,
 * `--kind Self`/`--kind SELF`/`--kind self` all normalize to `'self'`).
 * Defaults to `'all'` when omitted (BR1's default, minus `self`, is applied
 * downstream by `buildBaseFilter`, not here).
 */
function parseKind(value: string | undefined): EntryKind | 'all' {
  if (value === undefined) return 'all';
  const normalized = value.toLowerCase();
  if (!VALID_KINDS.has(normalized)) {
    throw new MemoError(
      'VALIDATION_FAILED',
      `Invalid --kind value "${value}". Use self, episodic, semantic, or all (case-insensitive).`,
    );
  }
  return normalized as EntryKind | 'all';
}

/**
 * Validates and normalizes `--as-of` (§18.14 item 6): a date-only value
 * (`2026-01-01`) normalizes to midnight UTC; a full ISO-8601 datetime is
 * accepted and re-normalized to its canonical `toISOString()` form. Any
 * other shape - including a calendar-invalid date or a non-ISO string like
 * `03/01/2025` - fails `VALIDATION_FAILED` (EC-2, EC-3).
 */
function normalizeAsOf(value: string): string {
  const trimmed = value.trim();

  if (DATE_ONLY.test(trimmed)) {
    const [year, month, day] = parseDateParts(trimmed);
    if (!isValidCalendarDate(year, month, day)) {
      throw new MemoError(
        'VALIDATION_FAILED',
        `Invalid --as-of value "${value}". Not a real calendar date.`,
      );
    }
    return `${trimmed}T00:00:00.000Z`;
  }

  if (ISO_DATETIME.test(trimmed)) {
    const [year, month, day] = parseDateParts(trimmed.slice(0, 10));
    if (!isValidCalendarDate(year, month, day)) {
      throw new MemoError(
        'VALIDATION_FAILED',
        `Invalid --as-of value "${value}". Not a real calendar date.`,
      );
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new MemoError('VALIDATION_FAILED', `Invalid --as-of value "${value}".`);
    }
    return parsed.toISOString();
  }

  throw new MemoError(
    'VALIDATION_FAILED',
    `Invalid --as-of value "${value}". Use an ISO 8601 date (YYYY-MM-DD) or datetime.`,
  );
}

/**
 * Parses and validates the six shared read-side flags (spec §18.7):
 * `--bank`, `--kind`, `--session`, `--include-archived`,
 * `--include-superseded`, `--as-of`. Pure - no I/O, no Qdrant calls.
 *
 * `--as-of` implies `includeSuperseded = true` (never `includeArchived`,
 * EC-16) - callers pass the result straight into `buildBaseFilter`, which
 * re-derives this same implication independently; the duplication is
 * intentional (`buildBaseFilter` must never trust a caller not to have
 * applied it, since it is also called directly in one or two other spots).
 */
export function parseReadFlags(
  flags: RawReadFlags,
  env: NodeJS.ProcessEnv = process.env,
  config?: Pick<MemoConfig, 'bank'>,
): ParsedReadFlags {
  const bank = resolveBank(flags.bank, env, config);
  const kind = parseKind(flags.kind);
  const asOf = flags.asOf !== undefined ? normalizeAsOf(flags.asOf) : undefined;
  const includeSuperseded = flags.includeSuperseded === true || asOf !== undefined;
  const includeArchived = flags.includeArchived === true;

  return {
    bank,
    kind,
    ...(flags.session !== undefined ? { session: flags.session } : {}),
    includeArchived,
    includeSuperseded,
    ...(asOf !== undefined ? { asOf } : {}),
  };
}
