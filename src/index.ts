#!/usr/bin/env node
import { program } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import setup from './commands/setup.js';

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
// program.addCommand(write);   // S-004
// program.addCommand(search);  // S-005
// program.addCommand(list);    // S-006

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(2);
});
