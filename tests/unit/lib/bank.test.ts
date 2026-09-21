import { defaultKind, isPrivateBank, policyFor, resolveBank } from '../../../src/lib/bank.js';
import { MemoError } from '../../../src/lib/errors.js';
import { MemoConfigSchema } from '../../../src/types/config.js';
import type { KindPolicy, MemoConfig } from '../../../src/types/config.js';

function buildConfig(overrides: Partial<MemoConfig> = {}): MemoConfig {
  return MemoConfigSchema.parse({
    schema_version: '2',
    repo: 'memo-cli',
    org: 'llipe',
    domain: 'backend',
    ...overrides,
  });
}

describe('resolveBank (AC1, PRD B3)', () => {
  it('EC-1: flag wins over env and config default', () => {
    const cfg = buildConfig({ bank: { default: 'config-bank' } });
    const result = resolveBank('flag-bank', { MEMO_BANK: 'env-bank' }, cfg);
    expect(result).toBe('flag-bank');
  });

  it('EC-2: env wins over config default when flag is unset', () => {
    const cfg = buildConfig({ bank: { default: 'config-bank' } });
    const result = resolveBank(undefined, { MEMO_BANK: 'env-bank' }, cfg);
    expect(result).toBe('env-bank');
  });

  it('EC-3: config.bank.default wins when flag and env are unset', () => {
    const cfg = buildConfig({ bank: { default: 'config-bank' } });
    const result = resolveBank(undefined, {}, cfg);
    expect(result).toBe('config-bank');
  });

  it('EC-4: falls back to "kb" when nothing is set anywhere', () => {
    const result = resolveBank(undefined, {}, undefined);
    expect(result).toBe('kb');
  });

  it('EC-5: MEMO_BANK="" is treated as unset, not as an invalid bank name', () => {
    const cfg = buildConfig({ bank: { default: 'config-bank' } });
    const result = resolveBank(undefined, { MEMO_BANK: '' }, cfg);
    expect(result).toBe('config-bank');
  });

  it('EC-6: MEMO_BANK="   " (whitespace-only) is treated as unset', () => {
    const cfg = buildConfig({ bank: { default: 'config-bank' } });
    const result = resolveBank(undefined, { MEMO_BANK: '   ' }, cfg);
    expect(result).toBe('config-bank');
  });

  it('EC-7: MEMO_BANK="KB" (not kebab-case) fails VALIDATION_FAILED naming MEMO_BANK', () => {
    expect(() => resolveBank(undefined, { MEMO_BANK: 'KB' }, undefined)).toThrow(MemoError);
    try {
      resolveBank(undefined, { MEMO_BANK: 'KB' }, undefined);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MemoError);
      expect((err as MemoError).code).toBe('VALIDATION_FAILED');
      expect((err as MemoError).message).toContain('MEMO_BANK');
    }
  });

  it('EC-8: an invalid --bank flag fails VALIDATION_FAILED naming --bank, without consulting env/config', () => {
    const cfg = buildConfig({ bank: { default: 'config-bank' } });
    try {
      resolveBank('Not_Valid!', { MEMO_BANK: 'env-bank' }, cfg);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MemoError);
      expect((err as MemoError).code).toBe('VALIDATION_FAILED');
      expect((err as MemoError).message).toContain('--bank');
    }
  });

  it('EC-9: an invalid config.bank.default fails VALIDATION_FAILED naming config.bank.default', () => {
    const cfg = { ...buildConfig(), bank: { default: 'Not-Kebab-VALID' } } as MemoConfig;
    try {
      resolveBank(undefined, {}, cfg);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MemoError);
      expect((err as MemoError).code).toBe('VALIDATION_FAILED');
      expect((err as MemoError).message).toContain('config.bank.default');
    }
  });

  it('EC-10: valid flag short-circuits before an invalid env value is ever evaluated', () => {
    const result = resolveBank('jarvis-memory', { MEMO_BANK: 'KB' }, undefined);
    expect(result).toBe('jarvis-memory');
  });

  it('EC-11: a valid UUID is accepted as a bank id at each precedence level', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(resolveBank(uuid, {}, undefined)).toBe(uuid);
    expect(resolveBank(undefined, { MEMO_BANK: uuid }, undefined)).toBe(uuid);
    const cfg = buildConfig({ bank: { default: uuid } });
    expect(resolveBank(undefined, {}, cfg)).toBe(uuid);
  });

  it('EC-12: flag = "kb" explicitly wins regardless of differing env/config', () => {
    const cfg = buildConfig({ bank: { default: 'config-bank' } });
    const result = resolveBank('kb', { MEMO_BANK: 'env-bank' }, cfg);
    expect(result).toBe('kb');
  });
});

describe('defaultKind (AC2, PRD K1)', () => {
  it('EC-13: defaultKind("kb") === "semantic"', () => {
    expect(defaultKind('kb')).toBe('semantic');
  });

  it('EC-14: defaultKind(<anything else>) === "episodic"', () => {
    expect(defaultKind('jarvis-memory')).toBe('episodic');
    expect(defaultKind('planner-memory')).toBe('episodic');
    expect(defaultKind('123e4567-e89b-12d3-a456-426614174000')).toBe('episodic');
  });
});

describe('isPrivateBank (AC2)', () => {
  it('EC-15: isPrivateBank("kb") === false', () => {
    expect(isPrivateBank('kb')).toBe(false);
  });

  it('EC-16: isPrivateBank(<anything else>) === true', () => {
    expect(isPrivateBank('anything-else')).toBe(true);
  });
});

describe('policyFor (AC3, spec §18.2)', () => {
  it('EC-17: policyFor(cfg, "kb", "semantic") returns cfg.banks.kb.semantic', () => {
    const cfg = buildConfig();
    expect(policyFor(cfg, 'kb', 'semantic')).toBe(cfg.banks.kb.semantic);
  });

  it('EC-18: policyFor(cfg, "kb", "episodic") returns cfg.banks.kb.episodic', () => {
    const cfg = buildConfig();
    expect(policyFor(cfg, 'kb', 'episodic')).toBe(cfg.banks.kb.episodic);
  });

  it('EC-19 / CT-7: policyFor(cfg, "kb", "self") throws VALIDATION_FAILED', () => {
    const cfg = buildConfig();
    try {
      policyFor(cfg, 'kb', 'self');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MemoError);
      expect((err as MemoError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('EC-20 / CT-7: policyFor(cfg, <private bank>, "self") returns cfg.banks.private.self ({soft_cap} only)', () => {
    const cfg = buildConfig();
    const result = policyFor(cfg, 'jarvis-memory', 'self');
    expect(result).toBe(cfg.banks.private.self);
    expect(Object.keys(result)).toEqual(['soft_cap']);
  });

  it('EC-21: policyFor(cfg, <private bank>, "episodic"/"semantic") returns cfg.banks.private.episodic/.semantic', () => {
    const cfg = buildConfig();
    expect(policyFor(cfg, 'jarvis-memory', 'episodic')).toBe(cfg.banks.private.episodic);
    expect(policyFor(cfg, 'jarvis-memory', 'semantic')).toBe(cfg.banks.private.semantic);
  });

  it('EC-22: an absent purge_after_days stays undefined, not coerced to a default number', () => {
    const cfg = buildConfig({
      banks: {
        kb: {
          episodic: { initial_stability_days: 3 },
          semantic: { initial_stability_days: 90, purge_after_days: undefined },
        },
        private: {
          self: { soft_cap: 50 },
          episodic: { initial_stability_days: 3 },
          semantic: { initial_stability_days: 30 },
        },
      },
    });
    expect((policyFor(cfg, 'kb', 'semantic') as KindPolicy).purge_after_days).toBeUndefined();
  });

  it('CT-7: policyFor for kb never returns a soft_cap key', () => {
    const cfg = buildConfig();
    const result = policyFor(cfg, 'kb', 'semantic');
    expect(Object.prototype.hasOwnProperty.call(result, 'soft_cap')).toBe(false);
  });
});
