import { parseReadFlags } from '../../../src/lib/read-flags.js';
import { MemoError } from '../../../src/lib/errors.js';
import { MemoConfigSchema } from '../../../src/types/config.js';
import type { MemoConfig } from '../../../src/types/config.js';

function buildConfig(overrides: Partial<MemoConfig> = {}): MemoConfig {
  return MemoConfigSchema.parse({
    schema_version: '2',
    repo: 'memo-cli',
    org: 'llipe',
    domain: 'backend',
    ...overrides,
  });
}

function expectValidationFailed(fn: () => unknown): void {
  try {
    fn();
    throw new Error('expected throw');
  } catch (err) {
    expect(err).toBeInstanceOf(MemoError);
    expect((err as MemoError).code).toBe('VALIDATION_FAILED');
  }
}

describe('parseReadFlags (AC1, spec §18.7)', () => {
  it('AC1: defaults bank via resolveBank precedence, kind "all", no session/asOf, both includes false', () => {
    const result = parseReadFlags({}, {}, undefined);
    expect(result).toEqual({
      bank: 'kb',
      kind: 'all',
      includeArchived: false,
      includeSuperseded: false,
    });
  });

  it('AC1: --bank flag is resolved through resolveBank (PRD B3)', () => {
    const result = parseReadFlags({ bank: 'jarvis-memory' }, {}, undefined);
    expect(result.bank).toBe('jarvis-memory');
  });

  it('AC1: --bank flag propagates resolveBank VALIDATION_FAILED', () => {
    expectValidationFailed(() => parseReadFlags({ bank: 'Not_Valid!' }, {}, undefined));
  });

  it('item 5: --kind is case-insensitive, normalized to lowercase', () => {
    expect(parseReadFlags({ kind: 'Self' }, {}, undefined).kind).toBe('self');
    expect(parseReadFlags({ kind: 'SELF' }, {}, undefined).kind).toBe('self');
    expect(parseReadFlags({ kind: 'self' }, {}, undefined).kind).toBe('self');
    expect(parseReadFlags({ kind: 'Episodic' }, {}, undefined).kind).toBe('episodic');
    expect(parseReadFlags({ kind: 'SEMANTIC' }, {}, undefined).kind).toBe('semantic');
    expect(parseReadFlags({ kind: 'All' }, {}, undefined).kind).toBe('all');
  });

  it('EC-1: an invalid --kind value fails VALIDATION_FAILED', () => {
    expectValidationFailed(() => parseReadFlags({ kind: 'bogus' }, {}, undefined));
  });

  it('--session is passed through when present, omitted when absent', () => {
    expect(parseReadFlags({ session: 's-1' }, {}, undefined).session).toBe('s-1');
    expect(parseReadFlags({}, {}, undefined).session).toBeUndefined();
  });

  it('--include-archived and --include-superseded toggle their flags', () => {
    const result = parseReadFlags(
      { includeArchived: true, includeSuperseded: true },
      {},
      undefined,
    );
    expect(result.includeArchived).toBe(true);
    expect(result.includeSuperseded).toBe(true);
  });

  describe('--as-of validation (items 6, EC-2, EC-3)', () => {
    it('item 6: a date-only value normalizes to midnight UTC', () => {
      expect(parseReadFlags({ asOf: '2026-01-01' }, {}, undefined).asOf).toBe(
        '2026-01-01T00:00:00.000Z',
      );
    });

    it('item 6: a full ISO-8601 datetime is preserved (normalized to Z form)', () => {
      expect(parseReadFlags({ asOf: '2025-03-01T10:00:00Z' }, {}, undefined).asOf).toBe(
        '2025-03-01T10:00:00.000Z',
      );
      expect(parseReadFlags({ asOf: '2025-03-01T10:00:00.500Z' }, {}, undefined).asOf).toBe(
        '2025-03-01T10:00:00.500Z',
      );
    });

    it('EC-2: a calendar-invalid date-only value fails VALIDATION_FAILED', () => {
      expectValidationFailed(() => parseReadFlags({ asOf: '2025-02-30' }, {}, undefined));
    });

    it('EC-2: a non-ISO-8601 string fails VALIDATION_FAILED', () => {
      expectValidationFailed(() => parseReadFlags({ asOf: '03/01/2025' }, {}, undefined));
    });

    it('EC-16: --as-of implies includeSuperseded true even when --include-superseded is not set', () => {
      const result = parseReadFlags({ asOf: '2026-01-01' }, {}, undefined);
      expect(result.includeSuperseded).toBe(true);
    });

    it('EC-16: --as-of does NOT imply includeArchived', () => {
      const result = parseReadFlags({ asOf: '2026-01-01' }, {}, undefined);
      expect(result.includeArchived).toBe(false);
    });
  });

  it('honors config.bank.default and MEMO_BANK per resolveBank precedence', () => {
    const cfg = buildConfig({ bank: { default: 'config-bank' } });
    expect(parseReadFlags({}, { MEMO_BANK: 'env-bank' }, cfg).bank).toBe('env-bank');
    expect(parseReadFlags({}, {}, cfg).bank).toBe('config-bank');
  });
});
