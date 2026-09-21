import chalk from 'chalk';
import ora from 'ora';
import type { Ora } from 'ora';

/** Confidence tier labels (#35 AC5). Kept in sync with `src/lib/ranking.ts`'s `ConfidenceTier`. */
export type ConfidenceTierLabel = 'exact' | 'high' | 'medium' | 'low';

export interface SearchHumanResult {
  id: string | number;
  similarity: number;
  repo?: string;
  rationale?: string;
  entry_type?: string;
  source?: string;
  org?: string;
  tags?: string[];
  story?: string;
  commit?: string;
  timestamp_utc?: string;
  /**
   * Confidence tier for this result on this query (#35 AC5). Optional so
   * callers that never rank (or that pre-date this story) keep the exact
   * same output with no `[tier]` prefix at all.
   */
  confidenceTier?: ConfidenceTierLabel;
  /**
   * Staleness annotation (#38 AC7). Optional so callers that never detect
   * staleness (or that pre-date this story) keep the exact same output with
   * no warning line at all. `staleBy` is only meaningful when `stale` is
   * `true`.
   */
  stale?: boolean;
  staleBy?: string | number;
}

/**
 * Semantic color per tier (guidelines §4): `exact`/`high` green, `medium`
 * yellow, `low` gray. The text label (`[tier]`) is always present
 * regardless of color support - color is a hint, never the only signal.
 */
const TIER_COLOR: Record<ConfidenceTierLabel, (text: string) => string> = {
  exact: (text) => chalk.green(text),
  high: (text) => chalk.green(text),
  medium: (text) => chalk.yellow(text),
  low: (text) => chalk.gray(text),
};

function renderTierPrefix(tier: ConfidenceTierLabel | undefined): string {
  if (!tier) return '';
  return `${TIER_COLOR[tier](`[${tier}]`)} `;
}

/**
 * `⚠ STALE — superseded by <id>` (#38 AC7). Returns `null` (not rendered)
 * when `stale` is falsy or `staleBy` is missing, so the warning line is
 * omitted entirely rather than shown empty.
 */
function renderStaleWarning(result: SearchHumanResult): string | null {
  if (!result.stale || result.staleBy === undefined) return null;
  return `${chalk.yellow.bold('⚠ STALE')} — superseded by ${String(result.staleBy)}`;
}

export interface ListHumanResult {
  id: string | number;
  repo?: string;
  rationale?: string;
  entry_type?: string;
  source?: string;
  org?: string;
  tags?: string[];
  story?: string;
  commit?: string;
  timestamp_utc?: string;
}

function toLead(text?: string): string {
  if (!text) return 'No rationale provided.';
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= 140) return singleLine;
  return `${singleLine.slice(0, 137)}...`;
}

function renderMetadata(result: SearchHumanResult): string {
  const parts = [
    result.org ? `org:${result.org}` : null,
    result.entry_type ? `type:${result.entry_type}` : null,
    result.source ? `source:${result.source}` : null,
    result.story ? `story:${result.story}` : null,
    result.commit ? `commit:${result.commit}` : null,
    result.timestamp_utc ? `at:${result.timestamp_utc}` : null,
    result.tags && result.tags.length > 0 ? `tags:${result.tags.join(', ')}` : null,
  ].filter((value): value is string => value !== null);

  return parts.join('  ');
}

function renderListMetadata(result: ListHumanResult): string {
  const parts = [
    result.org ? `org:${result.org}` : null,
    result.entry_type ? `type:${result.entry_type}` : null,
    result.source ? `source:${result.source}` : null,
    result.story ? `story:${result.story}` : null,
    result.commit ? `commit:${result.commit}` : null,
    result.tags && result.tags.length > 0 ? `tags:${result.tags.join(', ')}` : null,
  ].filter((value): value is string => value !== null);

  return parts.join('  ');
}

export const output = {
  result(data: unknown, opts?: { json?: boolean }): void {
    if (opts?.json) {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    } else if (typeof data === 'string') {
      process.stdout.write(data + '\n');
    } else {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    }
  },

  error(code: string, message: string, opts?: { json?: boolean }): void {
    if (opts?.json) {
      process.stderr.write(JSON.stringify({ error: message, code }) + '\n');
    } else {
      process.stderr.write(chalk.red(`error [${code}]: ${message}`) + '\n');
    }
  },

  info(message: string): void {
    process.stdout.write(`${chalk.cyan('  info  ')}${message}\n`);
  },

  warn(message: string): void {
    process.stdout.write(`${chalk.yellow.bold('  warn  ')}${message}\n`);
  },

  spinner(text: string): Ora {
    return ora({ text, isEnabled: process.stdout.isTTY });
  },

  searchResults(results: SearchHumanResult[]): void {
    for (const result of results) {
      const score = `${String(Math.round(result.similarity * 100))}%`;
      const repoLabel = result.repo ?? 'unknown-repo';
      const metadata = renderMetadata(result);

      process.stdout.write(
        `${renderTierPrefix(result.confidenceTier)}${chalk.cyan(repoLabel)}  ${chalk.gray(score)}  ${chalk.bold(toLead(result.rationale))}\n`,
      );

      if (metadata.length > 0) {
        process.stdout.write(`${chalk.gray(metadata)}\n`);
      }

      const staleWarning = renderStaleWarning(result);
      if (staleWarning) {
        process.stdout.write(`${staleWarning}\n`);
      }

      process.stdout.write(`${chalk.gray(`id:${String(result.id)}`)}\n\n`);
    }
  },

  searchEmpty(query: string, activeFilters: string[]): void {
    process.stdout.write(`${chalk.yellow('No results found.')}\n`);
    process.stdout.write(`${chalk.gray(`query: ${query}`)}\n`);
    process.stdout.write(
      `${chalk.gray(`filters: ${activeFilters.length > 0 ? activeFilters.join(' | ') : 'none'}`)}\n`,
    );
    process.stdout.write(
      chalk.gray('tip: broaden the query, remove tags, or switch to --scope related') + '\n',
    );
  },

  listResults(results: ListHumanResult[]): void {
    process.stdout.write(
      `${chalk.gray('timestamp_utc')}  ${chalk.gray('repo')}  ${chalk.gray('rationale')}\n`,
    );

    for (const result of results) {
      const timestamp = result.timestamp_utc ?? 'unknown-time';
      const repoLabel = result.repo ?? 'unknown-repo';
      const metadata = renderListMetadata(result);

      process.stdout.write(
        `${chalk.gray(timestamp)}  ${chalk.cyan(repoLabel)}  ${chalk.bold(toLead(result.rationale))}\n`,
      );

      if (metadata.length > 0) {
        process.stdout.write(`${chalk.gray(metadata)}\n`);
      }

      process.stdout.write(`${chalk.gray(`id:${String(result.id)}`)}\n\n`);
    }
  },

  listEmpty(activeFilters: string[]): void {
    process.stdout.write(`${chalk.yellow('No entries found.')}\n`);
    process.stdout.write(`${chalk.gray('count: 0')}\n`);
    process.stdout.write(
      `${chalk.gray(`filters: ${activeFilters.length > 0 ? activeFilters.join(' | ') : 'none'}`)}\n`,
    );
  },
};
