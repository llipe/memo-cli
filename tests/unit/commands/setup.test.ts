import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleInit } from '../../../src/commands/setup';
import { MemoConfigSchema } from '../../../src/types/config';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'memo-setup-v2-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// setup init --v2 (S2-01 AC8)
// ---------------------------------------------------------------------------

describe('setup init --v2 output shape (S2-01 AC8)', () => {
  it('writes schema_version "2" plus default bank/banks/recall blocks when --v2 is passed', async () => {
    await handleInit(
      { repo: 'memo-cli', org: 'llipe', domain: 'developer-tools', v2: true },
      tmpDir,
    );

    const content = await readFile(join(tmpDir, 'memo.config.json'), 'utf-8');
    const parsed: unknown = JSON.parse(content);
    const result = MemoConfigSchema.safeParse(parsed);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema_version).toBe('2');
      expect((parsed as Record<string, unknown>)['bank']).toEqual({ default: 'kb' });
      expect((parsed as Record<string, unknown>)['banks']).toBeDefined();
      expect((parsed as Record<string, unknown>)['recall']).toEqual({ max_tokens: 2000 });
    }
  });

  it('keeps writing schema_version "1" without --v2 (SC-8)', async () => {
    await handleInit({ repo: 'memo-cli', org: 'llipe', domain: 'developer-tools' }, tmpDir);

    const content = await readFile(join(tmpDir, 'memo.config.json'), 'utf-8');
    const parsed: unknown = JSON.parse(content);

    expect((parsed as Record<string, unknown>)['schema_version']).toBe('1');
  });

  it('produces a config whose JSON output includes schema_version "2" via --json (SC-9)', async () => {
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    };

    try {
      await handleInit(
        { repo: 'memo-cli', org: 'llipe', domain: 'developer-tools', v2: true, json: true },
        tmpDir,
      );
    } finally {
      process.stdout.write = origWrite;
    }

    const stdout = lines.join('');
    const parsed: unknown = JSON.parse(stdout);
    expect((parsed as Record<string, unknown>)['schema_version']).toBe('2');
  });
});
