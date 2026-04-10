import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleInit, handleShow, handleValidate } from '../../../src/commands/setup';
import { MemoConfigSchema } from '../../../src/types/config';

const VALID_CONFIG = {
  schema_version: '1' as const,
  repo: 'test-repo',
  org: 'test-org',
  domain: 'test-domain',
  relates_to: [] as string[],
  defaults: { source: 'agent' as const, search_scope: 'repo' as const },
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'memo-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// setup init (non-interactive)
// ---------------------------------------------------------------------------

describe('setup init (non-interactive)', () => {
  it('creates memo.config.json in the target directory', async () => {
    await handleInit({ repo: 'test-repo', org: 'test-org', domain: 'test-domain' }, tmpDir);

    const content = await readFile(join(tmpDir, 'memo.config.json'), 'utf-8');
    const parsed: unknown = JSON.parse(content);
    const result = MemoConfigSchema.safeParse(parsed);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repo).toBe('test-repo');
      expect(result.data.org).toBe('test-org');
      expect(result.data.domain).toBe('test-domain');
      expect(result.data.schema_version).toBe('1');
    }
  });

  it('parses comma-separated --relates-to flag', async () => {
    await handleInit(
      {
        repo: 'my-app',
        org: 'acme',
        domain: 'backend',
        relatesTo: 'other-service,third-service',
      },
      tmpDir,
    );

    const content = await readFile(join(tmpDir, 'memo.config.json'), 'utf-8');
    const parsed: unknown = JSON.parse(content);
    const result = MemoConfigSchema.safeParse(parsed);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relates_to).toEqual(['other-service', 'third-service']);
    }
  });

  it('throws CONFIG_INVALID when --repo is missing in non-interactive mode', async () => {
    await expect(
      handleInit({ org: 'test-org', domain: 'test-domain' }, tmpDir),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('throws CONFIG_INVALID when --org is missing in non-interactive mode', async () => {
    await expect(
      handleInit({ repo: 'test-repo', domain: 'test-domain' }, tmpDir),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('throws CONFIG_INVALID when repo is not kebab-case', async () => {
    await expect(
      handleInit({ repo: 'TestRepo', org: 'test-org', domain: 'test-domain' }, tmpDir),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });
});

// ---------------------------------------------------------------------------
// setup init --json
// ---------------------------------------------------------------------------

describe('setup init --json', () => {
  it('writes config and outputs JSON to stdout', async () => {
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    };

    try {
      await handleInit(
        { repo: 'json-repo', org: 'json-org', domain: 'json-domain', json: true },
        tmpDir,
      );
    } finally {
      process.stdout.write = origWrite;
    }

    const stdout = lines.join('');
    const parsed: unknown = JSON.parse(stdout);
    const result = MemoConfigSchema.safeParse(parsed);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repo).toBe('json-repo');
    }

    // File should also be written
    const content = await readFile(join(tmpDir, 'memo.config.json'), 'utf-8');
    expect(content).toContain('json-repo');
  });
});

// ---------------------------------------------------------------------------
// setup show
// ---------------------------------------------------------------------------

describe('setup show', () => {
  beforeEach(async () => {
    await writeFile(join(tmpDir, 'memo.config.json'), JSON.stringify(VALID_CONFIG, null, 2) + '\n');
  });

  it('outputs config as JSON when --json flag is set', async () => {
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    };

    try {
      await handleShow({ json: true }, tmpDir);
    } finally {
      process.stdout.write = origWrite;
    }

    const stdout = lines.join('');
    const parsed: unknown = JSON.parse(stdout);
    const result = MemoConfigSchema.safeParse(parsed);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repo).toBe('test-repo');
    }
  });

  it('throws CONFIG_NOT_FOUND when no config file exists', async () => {
    await expect(handleShow({}, join(tmpDir, 'nonexistent'))).rejects.toMatchObject({
      code: 'CONFIG_NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
// setup validate
// ---------------------------------------------------------------------------

describe('setup validate', () => {
  it('exits 0 (valid) for a correctly structured config', async () => {
    await writeFile(join(tmpDir, 'memo.config.json'), JSON.stringify(VALID_CONFIG, null, 2) + '\n');

    const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });

    try {
      await handleValidate(tmpDir);
      // If handleValidate doesn't call exit(0) itself and just returns, that's also valid
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toBe('process.exit(0)');
    } finally {
      mockExit.mockRestore();
    }
  });

  it('exits 1 for an invalid config', async () => {
    await writeFile(
      join(tmpDir, 'memo.config.json'),
      JSON.stringify({ schema_version: '1', repo: 'InvalidRepo' }, null, 2),
    );

    const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });

    try {
      await handleValidate(tmpDir);
      fail('Expected process.exit to be called');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toBe('process.exit(1)');
    } finally {
      mockExit.mockRestore();
    }
  });

  it('exits 1 when memo.config.json does not exist', async () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });

    try {
      await handleValidate(join(tmpDir, 'nonexistent-dir'));
      fail('Expected process.exit to be called');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toBe('process.exit(1)');
    } finally {
      mockExit.mockRestore();
    }
  });
});
