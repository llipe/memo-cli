import chalk from 'chalk';
import ora from 'ora';
import type { Ora } from 'ora';

/** Confidence tier labels (#35 AC5). Kept in sync with `src/lib/ranking.ts`'s `ConfidenceTier`. */
export type ConfidenceTierLabel = 'exact' | 'high' | 'medium' | 'low';

/**
 * The `--explain` factor projection (#63 AC5, AC8): a self-contained bag
 * that duplicates the top-level score fields alongside the additive/
 * multiplicative factors, including neutral values for factors Phase 1 does
 * not yet compute (`retention`, `use_ratio`, `link_factor`) so Phase 3 can
 * change their values without changing this shape.
 */
export interface ExplainFactors {
  similarity: number;
  recency_score: number;
  source_score: number;
  tag_boost: number;
  lexical_boost: number;
  retention: number;
  use_ratio: number;
  link_factor: number;
  final_score: number;
}

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
  /**
   * `--explain` factor breakdown (#63 AC6). Optional so callers that never
   * pass `--explain` keep the exact same output with no table at all.
   */
  explain?: ExplainFactors;
  /**
   * `[archived]`/`[superseded]` prefix flags (S2-05 AC6). Optional so a
   * result that predates bank-aware read flags (or is simply active) renders
   * with no prefix at all - the same convention as `stale`/`explain` above.
   */
  archived?: boolean;
  superseded?: boolean;
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
 * `[archived]`/`[superseded]` human-output prefix (S2-05 AC6). Shared by
 * `searchResults`, `searchResultsUnranked`, and `listResults` so the three
 * read-side human renderers never drift on this convention. Renders neither
 * label for an active entry (both flags falsy).
 */
function renderStatePrefix(archived?: boolean, superseded?: boolean): string {
  const labels: string[] = [];
  if (archived) labels.push(chalk.gray.bold('[archived]'));
  if (superseded) labels.push(chalk.gray.bold('[superseded]'));
  return labels.length > 0 ? `${labels.join(' ')} ` : '';
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
  /** `[archived]`/`[superseded]` prefix flags (S2-05 AC6). */
  archived?: boolean;
  superseded?: boolean;
}

/** Fields common to every unranked human-line renderer (S2-05 AC5/AC6). */
export interface UnrankedSearchHumanResult {
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
  archived?: boolean;
  superseded?: boolean;
}

function toLead(text?: string): string {
  if (!text) return 'No rationale provided.';
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= 140) return singleLine;
  return `${singleLine.slice(0, 137)}...`;
}

type MetadataFields = Pick<
  SearchHumanResult,
  'org' | 'entry_type' | 'source' | 'story' | 'commit' | 'timestamp_utc' | 'tags'
>;

function renderMetadata(result: MetadataFields): string {
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

/**
 * Column order for the `--explain` human table, per spec §10: `sim recency
 * source tag lex retention use final`. `link_factor` is JSON-only (AC5) -
 * the human table intentionally stays narrow and omits it, matching the
 * spec's literal column list.
 */
const EXPLAIN_TABLE_COLUMNS: { key: keyof ExplainFactors; label: string }[] = [
  { key: 'similarity', label: 'sim' },
  { key: 'recency_score', label: 'recency' },
  { key: 'source_score', label: 'source' },
  { key: 'tag_boost', label: 'tag' },
  { key: 'lexical_boost', label: 'lex' },
  { key: 'retention', label: 'retention' },
  { key: 'use_ratio', label: 'use' },
  { key: 'final_score', label: 'final' },
];

function formatFactorValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

/**
 * Renders the `--explain` factor table (#63 AC6) as two aligned lines (a
 * header row and a value row), each column padded to the wider of its
 * label or formatted value so long and short values never misalign.
 */
function renderExplainTable(factors: ExplainFactors): [string, string] {
  const cells = EXPLAIN_TABLE_COLUMNS.map(({ key, label }) => {
    const formatted = formatFactorValue(factors[key]);
    const width = Math.max(label.length, formatted.length);
    return { label: label.padEnd(width), value: formatted.padEnd(width) };
  });
  return [cells.map((c) => c.label).join('  '), cells.map((c) => c.value).join('  ')];
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
        `${renderStatePrefix(result.archived, result.superseded)}${renderTierPrefix(result.confidenceTier)}${chalk.cyan(repoLabel)}  ${chalk.gray(score)}  ${chalk.bold(toLead(result.rationale))}\n`,
      );

      if (metadata.length > 0) {
        process.stdout.write(`${chalk.gray(metadata)}\n`);
      }

      const staleWarning = renderStaleWarning(result);
      if (staleWarning) {
        process.stdout.write(`${staleWarning}\n`);
      }

      if (result.explain) {
        const [header, values] = renderExplainTable(result.explain);
        process.stdout.write(`${chalk.gray(header)}\n`);
        process.stdout.write(`${chalk.gray(values)}\n`);
      }

      process.stdout.write(`${chalk.gray(`id:${String(result.id)}`)}\n\n`);
    }
  },

  /**
   * `--kind self` human rendering (S2-05 AC5): no score, no confidence tier,
   * no stale/explain annotations - `self` entries never enter `rankResults`,
   * so there is no score to show. Still honors the `[archived]`/
   * `[superseded]` prefix convention (AC6).
   */
  searchResultsUnranked(results: UnrankedSearchHumanResult[]): void {
    for (const result of results) {
      const repoLabel = result.repo ?? 'unknown-repo';
      const metadata = renderMetadata(result);

      process.stdout.write(
        `${renderStatePrefix(result.archived, result.superseded)}${chalk.cyan(repoLabel)}  ${chalk.bold(toLead(result.rationale))}\n`,
      );

      if (metadata.length > 0) {
        process.stdout.write(`${chalk.gray(metadata)}\n`);
      }

      process.stdout.write(`${chalk.gray(`id:${String(result.id)}`)}\n\n`);
    }
  },

  /** `--explain` footer line (#63): the `query_id` correlation id, human mode only. */
  explainFooter(queryId: string): void {
    process.stdout.write(`${chalk.gray(`query_id: ${queryId}`)}\n`);
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
        `${renderStatePrefix(result.archived, result.superseded)}${chalk.gray(timestamp)}  ${chalk.cyan(repoLabel)}  ${chalk.bold(toLead(result.rationale))}\n`,
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
