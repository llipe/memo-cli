import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

jest.mock('node:readline/promises', () => ({ createInterface: jest.fn() }));
jest.mock('node:child_process', () => ({ execSync: jest.fn() }));

import { createInterface } from 'node:readline/promises';
import { execSync } from 'node:child_process';
import { handleInit } from '../../../src/commands/setup';
import type SetupModule from '../../../src/commands/setup';

// Commander's exported `setup` Command is a module-level singleton, so option
// values from one `parseAsync` call can leak into the next. Each CLI test
// below re-requires a fresh module instance via `jest.isolateModules` to keep
// option state isolated per test.
function freshSetupCommand(): typeof SetupModule {
  let mod: { default: typeof SetupModule } | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../../../src/commands/setup') as { default: typeof SetupModule };
  });
  if (!mod) throw new Error('freshSetupCommand: module did not load');
  return mod.default;
}

const mockCreateInterface = createInterface as unknown as jest.Mock;
const mockExecSync = execSync as unknown as jest.Mock;

function fakeReadline(answers: string[]) {
  const queue = [...answers];
  const question = jest.fn(async () => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error('fakeReadline: no more queued answers');
    }
    return next;
  });
  const close = jest.fn();
  return { question, close };
}

let tmpDir: string;
let origCwd: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'memo-setup-coverage-'));
  origCwd = process.cwd();
  mockExecSync.mockReset();
  mockExecSync.mockImplementation(() => {
    throw new Error('no git remote in test harness');
  });
});

afterEach(async () => {
  process.chdir(origCwd);
  await rm(tmpDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Interactive wizard coverage (runInteractiveWizard, promptField,
// promptSelect, confirmOverwrite, getGitRemoteRepo)
// ---------------------------------------------------------------------------

describe('setup init interactive wizard', () => {
  it('writes a config from a full straight-through answer sequence', async () => {
    const rl = fakeReadline([
      'memo-cli', // repo
      'llipe', // org
      'developer-tools', // domain
      '', // relates_to (optional, empty)
      'agent', // default source
      'repo', // default scope
      'y', // final confirm
    ]);
    mockCreateInterface.mockReturnValue(rl);

    await handleInit({}, tmpDir);

    expect(rl.close).toHaveBeenCalled();
  });

  it('uses getGitRemoteRepo success branch as the suggested repo default', async () => {
    mockExecSync.mockReturnValue('https://github.com/llipe/memo-cli.git\n');
    const rl = fakeReadline([
      '', // repo: accept suggested default from git remote
      'llipe',
      'developer-tools',
      '',
      'agent',
      'repo',
      'y',
    ]);
    mockCreateInterface.mockReturnValue(rl);

    await handleInit({}, tmpDir);

    expect(rl.close).toHaveBeenCalled();
  });

  it('retries on invalid repo/org/domain input before accepting a valid value', async () => {
    const rl = fakeReadline([
      'Not Valid!', // repo: invalid (not kebab-case) -> retry
      'memo-cli', // repo: valid
      '', // org: required -> retry
      'llipe', // org: valid
      'Invalid Domain', // domain: invalid -> retry
      'developer-tools', // domain: valid
      'Not_Kebab', // relates_to: invalid entry -> retry
      '', // relates_to: empty, valid
      'not-a-choice', // source select: invalid -> retry
      'manual', // source select: valid
      'not-a-scope', // scope select: invalid -> retry
      'related', // scope select: valid
      'y',
    ]);
    mockCreateInterface.mockReturnValue(rl);

    await handleInit({}, tmpDir);

    expect(rl.close).toHaveBeenCalled();
  });

  it('rejects a relates_to entry equal to repo, then retries with a valid one', async () => {
    const rl = fakeReadline([
      'memo-cli',
      'llipe',
      'developer-tools',
      'memo-cli', // equals repo -> retry
      'other-repo', // valid
      'agent',
      'repo',
      'y',
    ]);
    mockCreateInterface.mockReturnValue(rl);

    await handleInit({}, tmpDir);

    expect(rl.close).toHaveBeenCalled();
  });

  it('rejects duplicate relates_to entries, then retries with a valid list', async () => {
    const rl = fakeReadline([
      'memo-cli',
      'llipe',
      'developer-tools',
      'a-repo,a-repo', // duplicate -> retry
      'a-repo,b-repo', // valid
      'agent',
      'repo',
      'y',
    ]);
    mockCreateInterface.mockReturnValue(rl);

    await handleInit({}, tmpDir);

    expect(rl.close).toHaveBeenCalled();
  });

  it('aborts when the user declines the final write confirmation', async () => {
    const rl = fakeReadline([
      'memo-cli',
      'llipe',
      'developer-tools',
      '',
      'agent',
      'repo',
      'n', // decline
    ]);
    mockCreateInterface.mockReturnValue(rl);

    const result = await handleInit({}, tmpDir);

    expect(result).toBeUndefined();
    expect(rl.close).toHaveBeenCalled();
  });

  it('prompts to overwrite and aborts when an existing config is declined', async () => {
    await writeFile(
      join(tmpDir, 'memo.config.json'),
      JSON.stringify({ schema_version: '1', repo: 'x', org: 'y', domain: 'z' }),
    );

    const rl = fakeReadline([
      'memo-cli',
      'llipe',
      'developer-tools',
      '',
      'agent',
      'repo',
      'n', // decline overwrite
    ]);
    mockCreateInterface.mockReturnValue(rl);

    await handleInit({}, tmpDir);

    expect(rl.close).toHaveBeenCalled();
  });

  it('prompts to overwrite and proceeds when accepted', async () => {
    await writeFile(
      join(tmpDir, 'memo.config.json'),
      JSON.stringify({ schema_version: '1', repo: 'x', org: 'y', domain: 'z' }),
    );

    const rl = fakeReadline([
      'memo-cli',
      'llipe',
      'developer-tools',
      '',
      'agent',
      'repo',
      'y', // accept overwrite
      'y', // final confirm
    ]);
    mockCreateInterface.mockReturnValue(rl);

    await handleInit({}, tmpDir);

    expect(rl.close).toHaveBeenCalled();
  });

  it('writes schema_version "2" when --v2 is passed through the interactive path', async () => {
    const rl = fakeReadline(['memo-cli', 'llipe', 'developer-tools', '', 'agent', 'repo', 'y']);
    mockCreateInterface.mockReturnValue(rl);

    await handleInit({ v2: true }, tmpDir);

    expect(rl.close).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CLI command tree coverage (setupInit/setupShow/setupValidate .action)
// ---------------------------------------------------------------------------

describe('setup CLI command tree', () => {
  it('setup init succeeds via the CLI action wrapper', async () => {
    process.chdir(tmpDir);
    await freshSetupCommand().parseAsync(
      ['init', '--repo', 'memo-cli', '--org', 'llipe', '--domain', 'developer-tools'],
      { from: 'user' },
    );
  });

  it('setup init surfaces a MemoError via the CLI action wrapper and exits 1', async () => {
    process.chdir(tmpDir);
    const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });

    await expect(
      freshSetupCommand().parseAsync(['init', '--org', 'llipe', '--domain', 'developer-tools'], {
        from: 'user',
      }),
    ).rejects.toThrow('process.exit(1)');

    mockExit.mockRestore();
  });

  it('setup show succeeds via the CLI action wrapper', async () => {
    await writeFile(
      join(tmpDir, 'memo.config.json'),
      JSON.stringify({ schema_version: '1', repo: 'x', org: 'y', domain: 'z' }),
    );
    process.chdir(tmpDir);
    await freshSetupCommand().parseAsync(['show'], { from: 'user' });
  });

  it('setup show surfaces CONFIG_NOT_FOUND via the CLI action wrapper and exits 1', async () => {
    process.chdir(tmpDir);
    const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });

    await expect(freshSetupCommand().parseAsync(['show'], { from: 'user' })).rejects.toThrow(
      'process.exit(1)',
    );

    mockExit.mockRestore();
  });

  it('setup validate exits 0 via the CLI action wrapper for a valid config', async () => {
    await writeFile(
      join(tmpDir, 'memo.config.json'),
      JSON.stringify({ schema_version: '1', repo: 'x', org: 'y', domain: 'z' }),
    );
    process.chdir(tmpDir);
    const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });

    await expect(freshSetupCommand().parseAsync(['validate'], { from: 'user' })).rejects.toThrow(
      'process.exit(0)',
    );

    mockExit.mockRestore();
  });

  it('setup validate exits 1 via the CLI action wrapper for a missing config', async () => {
    process.chdir(tmpDir);
    const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });

    await expect(freshSetupCommand().parseAsync(['validate'], { from: 'user' })).rejects.toThrow(
      'process.exit(1)',
    );

    mockExit.mockRestore();
  });
});
