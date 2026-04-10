import chalk from 'chalk';
import ora from 'ora';
import type { Ora } from 'ora';

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
};
