import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig, writeConfig, validateConfig } from '../lib/config.js';
import { MemoConfigSchema } from '../types/config.js';
import type { MemoConfig } from '../types/config.js';
import { MemoError } from '../lib/errors.js';

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const CONFIG_FILE = 'memo.config.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGitRemoteRepo(): string | undefined {
  try {
    const url = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const match = /\/([^/]+?)(?:\.git)?$/.exec(url);
    return match?.[1];
  } catch {
    return undefined;
  }
}

async function promptField(
  rl: ReturnType<typeof createInterface>,
  label: string,
  hint: string,
  defaultValue: string,
  validator: (v: string) => string | null,
): Promise<string> {
  const defaultDisplay = defaultValue ? chalk.gray(`(${defaultValue})`) : '';
  while (true) {
    const raw = await rl.question(`║  ${chalk.cyan(label)}  ${hint} ${defaultDisplay}›  `);
    const value = raw.trim() || defaultValue;
    const error = validator(value);
    if (error) {
      process.stdout.write(`║  ${chalk.red(`✗ ${error}`)}\n`);
      continue;
    }
    return value;
  }
}

async function promptSelect(
  rl: ReturnType<typeof createInterface>,
  label: string,
  options: readonly string[],
  defaultValue: string,
): Promise<string> {
  const optionsDisplay = options.join(' / ');
  while (true) {
    const raw = await rl.question(
      `║  ${chalk.cyan(label)}  [${optionsDisplay}]  ›  ${chalk.gray(defaultValue)}  `,
    );
    const value = raw.trim() || defaultValue;
    if ((options as string[]).includes(value)) {
      return value;
    }
    process.stdout.write(`║  ${chalk.red(`✗ Choose one of: ${optionsDisplay}`)}\n`);
  }
}

async function confirmOverwrite(
  rl: ReturnType<typeof createInterface>,
  cwd: string,
): Promise<boolean> {
  const filePath = join(cwd, CONFIG_FILE);
  if (!existsSync(filePath)) return true;

  process.stdout.write(
    `\n  ${chalk.yellow.bold('⚠')}  ${chalk.yellow(`${CONFIG_FILE} already exists.`)}\n`,
  );
  const answer = await rl.question(`  Overwrite existing config?  [y/N]  `);
  return answer.trim().toLowerCase() === 'y';
}

// ---------------------------------------------------------------------------
// Interactive wizard
// ---------------------------------------------------------------------------

async function runInteractiveWizard(cwd: string): Promise<MemoConfig | null> {
  const suggestedRepo = getGitRemoteRepo() ?? '';

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    process.stdout.write(`${chalk.cyan('╔')}  ${chalk.bold('Memo Setup')}\n║\n`);

    const repo = await promptField(rl, 'Repo name', '(kebab-case)', suggestedRepo, (v) =>
      !v ? 'Required' : !KEBAB_CASE.test(v) ? 'Must be kebab-case' : null,
    );

    const org = await promptField(rl, 'Org      ', '(kebab-case)', '', (v) =>
      !v ? 'Required' : !KEBAB_CASE.test(v) ? 'Must be kebab-case' : null,
    );

    const domain = await promptField(rl, 'Domain   ', '(kebab-case)', '', (v) =>
      !v ? 'Required' : !KEBAB_CASE.test(v) ? 'Must be kebab-case' : null,
    );

    const relatesRaw = await promptField(
      rl,
      'Related repos',
      '(comma-separated, optional)',
      '',
      (v) => {
        if (!v) return null;
        const items = v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        for (const item of items) {
          if (!KEBAB_CASE.test(item)) return `"${item}" must be kebab-case`;
          if (item === repo) return `"${item}" must not equal repo`;
        }
        const seen = new Set(items);
        if (seen.size !== items.length) return 'Duplicate entries';
        return null;
      },
    );

    const source = await promptSelect(rl, 'Default source', ['agent', 'manual'], 'agent');
    const searchScope = await promptSelect(rl, 'Default scope ', ['repo', 'related'], 'repo');

    process.stdout.write(`${chalk.cyan('╚')}\n`);

    const relatesTo = relatesRaw
      ? relatesRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const config: MemoConfig = MemoConfigSchema.parse({
      schema_version: '1',
      repo,
      org,
      domain,
      relates_to: relatesTo,
      defaults: { source, search_scope: searchScope },
    });

    // Preview
    process.stdout.write(`\n  Preview:\n\n`);
    const preview = JSON.stringify(config, null, 2)
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n');
    process.stdout.write(`${preview}\n\n`);

    if (!(await confirmOverwrite(rl, cwd))) {
      process.stdout.write(chalk.yellow('  Aborted.\n'));
      return null;
    }

    const confirm = await rl.question(
      `  ${chalk.green('✔')}  Write ${chalk.bold(CONFIG_FILE)}?  [Y/n]  `,
    );
    if (confirm.trim().toLowerCase() === 'n') {
      process.stdout.write(chalk.yellow('  Aborted.\n'));
      return null;
    }

    return config;
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// setup init
// ---------------------------------------------------------------------------

interface InitOptions {
  repo?: string;
  org?: string;
  domain?: string;
  relatesTo?: string;
  json?: boolean;
}

async function handleInit(opts: InitOptions, cwd: string): Promise<void> {
  const isNonInteractive =
    opts.repo !== undefined ||
    opts.org !== undefined ||
    opts.domain !== undefined ||
    opts.relatesTo !== undefined;

  let config: MemoConfig | null;

  if (isNonInteractive) {
    // Non-interactive path: validate flags and write immediately
    if (!opts.repo)
      throw new MemoError('CONFIG_INVALID', '--repo is required in non-interactive mode');
    if (!opts.org)
      throw new MemoError('CONFIG_INVALID', '--org is required in non-interactive mode');
    if (!opts.domain)
      throw new MemoError('CONFIG_INVALID', '--domain is required in non-interactive mode');

    const relatesTo = opts.relatesTo
      ? opts.relatesTo
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const result = MemoConfigSchema.safeParse({
      schema_version: '1',
      repo: opts.repo,
      org: opts.org,
      domain: opts.domain,
      relates_to: relatesTo,
      defaults: {},
    });

    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new MemoError('CONFIG_INVALID', `Invalid config: ${issues}`);
    }

    config = result.data;

    // Warn if overwriting (non-interactive: still check but skip confirmation)
    const filePath = join(cwd, CONFIG_FILE);
    if (existsSync(filePath)) {
      process.stderr.write(chalk.yellow(`Warning: overwriting existing ${CONFIG_FILE}\n`));
    }
  } else {
    config = await runInteractiveWizard(cwd);
  }

  if (!config) return;

  await writeConfig(config, cwd);

  if (opts.json) {
    process.stdout.write(JSON.stringify(config, null, 2) + '\n');
  } else {
    process.stdout.write(chalk.green(`  ✔  Written ${join(cwd, CONFIG_FILE)}\n`));
  }
}

// ---------------------------------------------------------------------------
// setup show
// ---------------------------------------------------------------------------

interface ShowOptions {
  json?: boolean;
}

async function handleShow(opts: ShowOptions, cwd: string): Promise<void> {
  const config = await loadConfig(cwd);

  if (opts.json) {
    process.stdout.write(JSON.stringify(config, null, 2) + '\n');
  } else {
    process.stdout.write(chalk.bold('Memo Configuration\n'));
    process.stdout.write('─'.repeat(40) + '\n');
    process.stdout.write(JSON.stringify(config, null, 2) + '\n');
  }
}

// ---------------------------------------------------------------------------
// setup validate
// ---------------------------------------------------------------------------

async function handleValidate(cwd: string): Promise<void> {
  const result = await validateConfig(cwd);

  if (result.valid) {
    process.stdout.write(chalk.green(`✔ ${CONFIG_FILE} is valid\n`));
    process.exit(0);
  } else {
    process.stderr.write(chalk.red(`✗ ${CONFIG_FILE} is invalid\n`));
    if (result.errors) {
      for (const err of result.errors) {
        process.stderr.write(chalk.red(`  • ${err}\n`));
      }
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command tree
// ---------------------------------------------------------------------------

const setupInit = new Command('init')
  .description('Initialize Memo repository configuration')
  .option('--repo <name>', 'Repository name (kebab-case)')
  .option('--org <name>', 'Organization (kebab-case)')
  .option('--domain <name>', 'Domain (kebab-case)')
  .option('--relates-to <repos>', 'Comma-separated related repos')
  .option('--json', 'Output written config as JSON to stdout')
  .action(async function (this: Command) {
    const opts = this.opts<InitOptions>();
    try {
      await handleInit(opts, process.cwd());
    } catch (err) {
      if (err instanceof MemoError) {
        process.stderr.write(chalk.red(`Error [${err.code}]: ${err.message}\n`));
        process.exit(err.exitCode);
      }
      throw err;
    }
  });

const setupShow = new Command('show')
  .description('Show effective Memo configuration')
  .option('--json', 'Output as JSON')
  .action(async function (this: Command) {
    const opts = this.opts<ShowOptions>();
    try {
      await handleShow(opts, process.cwd());
    } catch (err) {
      if (err instanceof MemoError) {
        process.stderr.write(chalk.red(`Error [${err.code}]: ${err.message}\n`));
        process.exit(err.exitCode);
      }
      throw err;
    }
  });

const setupValidate = new Command('validate')
  .description('Validate Memo configuration; exits 0 if valid, 1 if invalid')
  .action(async () => {
    try {
      await handleValidate(process.cwd());
    } catch (err) {
      if (err instanceof MemoError) {
        process.stderr.write(chalk.red(`Error [${err.code}]: ${err.message}\n`));
        process.exit(err.exitCode);
      }
      throw err;
    }
  });

const setup = new Command('setup').description('Manage Memo repository configuration');
setup.addCommand(setupInit);
setup.addCommand(setupShow);
setup.addCommand(setupValidate);

export default setup;

// Named exports for testing
export { handleInit, handleShow, handleValidate };
