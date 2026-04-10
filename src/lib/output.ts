import chalk from 'chalk';
import ora from 'ora';
import type { Ora } from 'ora';

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
        `${chalk.cyan(repoLabel)}  ${chalk.gray(score)}  ${chalk.bold(toLead(result.rationale))}\n`,
      );

      if (metadata.length > 0) {
        process.stdout.write(`${chalk.gray(metadata)}\n`);
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
};
