#!/usr/bin/env node
import { program } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
) as { version: string };

program
  .name('memo')
  .description('Agent-first CLI for capturing and querying development decisions')
  .version(pkg.version);

// Commands registered here in subsequent stories
// program.addCommand(require('./commands/setup').default);
// program.addCommand(require('./commands/write').default);
// program.addCommand(require('./commands/search').default);
// program.addCommand(require('./commands/list').default);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(2);
});
