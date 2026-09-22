/**
 * Shared ISO-8601 date/datetime validation helpers (issue #98).
 *
 * Extracted from `src/lib/read-flags.ts`'s `normalizeAsOf` so the same
 * calendar-validity check is used by every caller that accepts a
 * date-only or full-ISO-datetime flag value: `read-flags.ts` (`--as-of`),
 * `commands/timeline.ts` (`--since`), and `list-filters.ts` (`--from`/`--to`).
 * Behavior is preserved exactly - this is a pure extraction, no logic change.
 */

/** Matches a bare `YYYY-MM-DD` date, no time component. */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Matches a full ISO-8601 datetime with an explicit `Z` or `+HH:MM`/`-HH:MM` offset. */
export const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * True when `y-m-d` is a real calendar date - `new Date(Date.UTC(...))`
 * silently rolls invalid dates over (e.g. `2025-02-30` -> `2025-03-02`), so
 * this re-derives the components and compares them back against the input
 * rather than trusting `Number.isNaN` alone (EC-2).
 */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Splits a `YYYY-MM-DD` string into `[year, month, day]`, `NaN` for any missing/unparseable part. */
export function parseDateParts(datePart: string): [number, number, number] {
  const [year, month, day] = datePart.split('-').map(Number);
  return [year ?? NaN, month ?? NaN, day ?? NaN];
}
