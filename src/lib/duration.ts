import { MemoError } from './errors.js';

/**
 * Pure duration-string parser (spec §18.6, S2-04): `\d+[dhm]` — a run of
 * ASCII digits followed by exactly one unit character, `d` (days), `h`
 * (hours), or `m` (minutes). Case-sensitive (lowercase unit only) and
 * anchored on both ends, so no leading/trailing whitespace, extra
 * characters, or a second unit suffix (`2dh`) is accepted.
 *
 * Reused by Phase 3's `--older-than` (Technical Notes, S2-04) via the
 * `flagName` parameter, which only affects the error message.
 */
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const DURATION_PATTERN = /^(\d+)([dhm])$/;

const UNIT_MS: Record<'d' | 'h' | 'm', number> = {
  d: DAY_MS,
  h: HOUR_MS,
  m: MINUTE_MS,
};

/**
 * Parses `value` into a millisecond offset. Throws `MemoError('VALIDATION_FAILED')`
 * — never an unhandled exception — for anything not matching `\d+[dhm]` exactly,
 * or for a zero amount (`0d`/`0h`/`0m`, EC-1: a zero-length duration is not a
 * meaningful expiry offset).
 */
export function parseDuration(value: string, flagName = '--expires-in'): number {
  const match = DURATION_PATTERN.exec(value);
  if (!match) {
    throw new MemoError(
      'VALIDATION_FAILED',
      `${flagName} must match the pattern \\d+[dhm] (e.g. "2d", "12h", "30m"). Received "${value}".`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2] as 'd' | 'h' | 'm';

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MemoError(
      'VALIDATION_FAILED',
      `${flagName} must be a positive duration. Received "${value}".`,
    );
  }

  return amount * UNIT_MS[unit];
}
