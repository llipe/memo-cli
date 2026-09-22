import { KebabOrUuid, DEFAULT_BANK_ID } from '../types/config.js';
import type { KindPolicy, MemoConfig, SelfPolicy } from '../types/config.js';
import type { EntryKind } from '../types/entry.js';
import { MemoError } from './errors.js';

/**
 * Validates a candidate bank id against the `KebabOrUuid` schema (spec §18.2)
 * and throws `VALIDATION_FAILED` naming `source` on failure (PRD B3, AC1).
 */
function validateBankId(value: string, source: string): void {
  const result = KebabOrUuid.safeParse(value);
  if (!result.success) {
    throw new MemoError(
      'VALIDATION_FAILED',
      `${source} must be a kebab-case bank id or a UUID. Received "${value}".`,
    );
  }
}

/**
 * Resolves the effective bank for a command invocation (PRD B3, spec §8.1):
 * `--bank` flag, then `MEMO_BANK`, then `config.bank.default`, then `'kb'`.
 *
 * An invalid value at any level fails fast with `VALIDATION_FAILED` naming
 * the offending source (`--bank`, `MEMO_BANK`, or `config.bank.default`) -
 * precedence short-circuits, so a lower-priority invalid value is never
 * evaluated once a higher-priority source resolves.
 *
 * `MEMO_BANK` is treated as unset when empty or whitespace-only, matching
 * the shell convention that an exported-but-empty env var means "not set"
 * rather than "set to the empty string" (spec §18.5 edge case).
 */
export function resolveBank(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  // `bank` itself is optional here (unlike `Pick<MemoConfig, 'bank'>`)
  // because several existing command test doubles pass a hand-built config
  // object that was never run through `MemoConfigSchema.parse` and so may
  // omit `bank` entirely - this function's own contract already promises a
  // `kb` fallback "when nothing is set anywhere" (see docstring), and a
  // present-but-bank-less config is exactly that case, not a type error.
  config?: { bank?: MemoConfig['bank'] },
): string {
  if (flag !== undefined) {
    validateBankId(flag, '--bank');
    return flag;
  }

  const envBank = env['MEMO_BANK'];
  if (envBank !== undefined && envBank.trim().length > 0) {
    validateBankId(envBank, 'MEMO_BANK');
    return envBank;
  }

  const configDefault = config?.bank?.default;
  if (configDefault !== undefined) {
    validateBankId(configDefault, 'config.bank.default');
    return configDefault;
  }

  return DEFAULT_BANK_ID;
}

/** `kb` is the shared knowledge base (PRD B1); every other bank is private (PRD B2). */
export function isPrivateBank(bank: string): boolean {
  return bank !== DEFAULT_BANK_ID;
}

/** Default kind by bank (PRD K1): `semantic` in `kb`, `episodic` in every private bank. */
export function defaultKind(bank: string): 'semantic' | 'episodic' {
  return bank === DEFAULT_BANK_ID ? 'semantic' : 'episodic';
}

/**
 * Looks up the lifecycle/retention policy block for `bank`/`kind` (spec
 * §8.1, §18.2). `self` is private-banks-only (PRD K1): `policyFor(_, 'kb',
 * 'self')` throws `VALIDATION_FAILED` rather than returning a policy that
 * cannot legally apply.
 */
export function policyFor(
  config: MemoConfig,
  bank: string,
  kind: EntryKind,
): KindPolicy | SelfPolicy {
  if (kind === 'self') {
    if (bank === DEFAULT_BANK_ID) {
      throw new MemoError(
        'VALIDATION_FAILED',
        '"self" entries are not allowed in the "kb" bank (PRD K1).',
      );
    }
    return config.banks.private.self;
  }

  if (bank === DEFAULT_BANK_ID) {
    return config.banks.kb[kind];
  }

  return config.banks.private[kind];
}
