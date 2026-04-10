#!/usr/bin/env node
import { program } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import setup from './commands/setup.js';
import search from './commands/search.js';
import write from './commands/write.js';
import list from './commands/list.js';
import { MemoError } from './lib/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as {
  version: string;
};

program
  .name('memo')
  .description('Agent-first CLI for capturing and querying development decisions')
  .version(pkg.version);

program.addCommand(setup);
program.addCommand(write);
program.addCommand(search);
program.addCommand(list);

program.parseAsync(process.argv).catch((err: unknown) => {
  const memoErr =
    err instanceof MemoError
      ? err
      : new MemoError('UNEXPECTED_ERROR', err instanceof Error ? err.message : String(err), 2);

  process.stderr.write(`error [${memoErr.code}]: ${memoErr.message}\n`);

  if (process.env['MEMO_DEBUG'] === 'true') {
    process.stderr.write(`${memoErr.stack ?? memoErr.message}\n`);
  }

  process.exit(memoErr.exitCode);
});
