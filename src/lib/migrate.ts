import { z } from 'zod';
import { policyFor } from './bank.js';
import { MemoError } from './errors.js';
import { DAY_MS } from './duration.js';
import { DEFAULT_BANK_ID } from '../types/config.js';
import type { KindPolicy, MemoConfig } from '../types/config.js';

/**
 * `memo migrate --to-v2` (spec §5.5, §18.11; PRD FR-2.8, AC-2.7; issue #88 /
 * Story S2-09). This is the pure planner half of the migration lifecycle:
 * `planMigration` computes, per point, the exact `set_payload` operation the
 * command layer (`src/commands/migrate.ts`) issues via `batchSetPayload` -
 * this file never touches the network.
 */

// ---------------------------------------------------------------------------
// Rules schema (spec §18.11)
// ---------------------------------------------------------------------------

/**
 * `when` operators (spec §18.11): AND semantics across the keys present on
 * one rule (CT-3) - an empty object (`{}`) matches every point and is the
 * required catch-all shape the exhaustiveness check looks for.
 */
const MigrationRuleWhenSchema = z
  .object({
    tags_any: z.array(z.string()).min(1).optional(),
    tags_all: z.array(z.string()).min(1).optional(),
    entry_type_in: z.array(z.string()).min(1).optional(),
    source_in: z.array(z.string()).min(1).optional(),
    repo_in: z.array(z.string()).min(1).optional(),
  })
  .strict();

export type MigrationRuleWhen = z.infer<typeof MigrationRuleWhenSchema>;

/**
 * `set` block (spec §18.11): `kind` is required and restricted to
 * `episodic | semantic` - every migrated point lands in `bank: 'kb'` (AC1),
 * and `self` is never valid in `kb` (K1, `src/types/entry.ts`), so a rules
 * file cannot target `self` at all. `session_from`/`expires_in_days` are
 * episodic-only (§18.14 item 14 confirms a rule MAY target `episodic`,
 * including the catch-all) - setting either on a `semantic` rule is rejected
 * up front (CT-4b: this implementation's answer is "reject", not "silently
 * ignore", matching the codebase's existing `superRefine`-rejection
 * convention in `src/types/entry.ts`/`src/types/config.ts`).
 */
const MigrationRuleSetSchema = z
  .object({
    kind: z.enum(['episodic', 'semantic']),
    session_from: z.enum(['story', 'legacy']).optional(),
    expires_in_days: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.kind !== 'episodic' && data.session_from !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['session_from'],
        message: '"session_from" is only valid when "kind" is "episodic"',
      });
    }
    if (data.kind !== 'episodic' && data.expires_in_days !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expires_in_days'],
        message: '"expires_in_days" is only valid when "kind" is "episodic"',
      });
    }
  });

const MigrationRuleSchema = z
  .object({
    name: z.string().min(1),
    when: MigrationRuleWhenSchema.default({}),
    set: MigrationRuleSetSchema,
  })
  .strict();

export type MigrationRule = z.infer<typeof MigrationRuleSchema>;

/** A `--rules <file>` document is a non-empty JSON array of rule objects. */
export const MigrationRulesSchema = z.array(MigrationRuleSchema).min(1);

/**
 * Default rules (spec §18.11): rule `"1"` classifies `intent`/`outcome`
 * tagged points as episodic sessions; rule `"2"` is the exhaustive catch-all
 * that defaults everything else to `semantic` (PRD §7.2 rationale: a
 * misclassified decision that expires is unrecoverable, a misclassified
 * episode is only today's noise).
 */
export const DEFAULT_MIGRATION_RULES: MigrationRule[] = [
  {
    name: '1',
    when: { tags_any: ['intent', 'outcome'] },
    set: { kind: 'episodic', session_from: 'story', expires_in_days: 90 },
  },
  {
    name: '2',
    when: {},
    set: { kind: 'semantic' },
  },
];

/**
 * Parses and validates a `--rules <file>` document (AC4): shape validation
 * via `MigrationRulesSchema`, then the exhaustiveness check (a rule set with
 * no catch-all - a rule whose `when` has zero keys - fails before any scan).
 * Throws `MemoError('VALIDATION_FAILED')` on either failure - never a raw
 * Zod error - matching every other rules/config validator in the codebase.
 */
export function parseMigrationRules(raw: unknown): MigrationRule[] {
  const result = MigrationRulesSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new MemoError('VALIDATION_FAILED', `--rules file is invalid: ${issues}`);
  }

  validateRulesExhaustive(result.data);
  return result.data;
}

/**
 * A rule set is exhaustive iff at least one rule has an empty `when` (spec
 * §18.11: "add a final rule with empty `when`"). Because rules are evaluated
 * in order with first-match-wins, the empty-`when` rule does not need to be
 * literally last to guarantee every point matches something - it always
 * matches whatever no earlier rule caught.
 */
export function validateRulesExhaustive(rules: MigrationRule[]): void {
  const hasCatchAll = rules.some((r) => Object.keys(r.when).length === 0);
  if (!hasCatchAll) {
    throw new MemoError(
      'VALIDATION_FAILED',
      'rule set is not exhaustive: add a final rule with empty "when"',
    );
  }
}

// ---------------------------------------------------------------------------
// Planner (spec §5.5, §18.11)
// ---------------------------------------------------------------------------

/** A raw point as returned by `QdrantRepository.scrollAll`/`scroll` (id + payload only). */
export interface MigratablePoint {
  id: string | number;
  payload?: Record<string, unknown> | undefined;
}

/** One `set_payload` operation, ready to hand to `QdrantRepository.batchSetPayload` verbatim. */
export interface MigrationOp {
  id: string | number;
  payload: Record<string, unknown>;
}

export interface MigrationPlan {
  ops: MigrationOp[];
  /** Keyed by rule `name`; a point counted here is also present in `ops`. */
  byRule: Record<string, number>;
  /** Points whose `schema_version` was already `"2"` - not migrated, not counted in `byRule`. */
  skipped: number;
}

/** `policyFor` needs a full `MemoConfig`-shaped object; only `banks` is ever read here. */
type PoliciesInput = Pick<MemoConfig, 'banks'>;

function readTags(payload: Record<string, unknown>): string[] {
  const raw = payload['tags'];
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

/** AND semantics across every operator key present on `when` (CT-1…CT-3). Empty `when` always matches. */
function matchesWhen(payload: Record<string, unknown>, when: MigrationRuleWhen): boolean {
  if (when.tags_any !== undefined) {
    const tags = readTags(payload);
    if (!when.tags_any.some((t) => tags.includes(t))) return false;
  }
  if (when.tags_all !== undefined) {
    const tags = readTags(payload);
    if (!when.tags_all.every((t) => tags.includes(t))) return false;
  }
  if (when.entry_type_in !== undefined) {
    const entryType = readString(payload, 'entry_type');
    if (entryType === undefined || !when.entry_type_in.includes(entryType)) return false;
  }
  if (when.source_in !== undefined) {
    const source = readString(payload, 'source');
    if (source === undefined || !when.source_in.includes(source)) return false;
  }
  if (when.repo_in !== undefined) {
    const repo = readString(payload, 'repo');
    if (repo === undefined || !when.repo_in.includes(repo)) return false;
  }
  return true;
}

/**
 * `story ?? 'legacy'` (AC1/EC-2): any non-`story` "empty" value - `undefined`,
 * `''`, `null`, or a non-string - resolves to `'legacy'`, not just strict
 * `undefined`. `session_from: 'legacy'` (or unset) always resolves to
 * `'legacy'` regardless of a `story` field's presence.
 */
function resolveSessionId(
  sessionFrom: 'story' | 'legacy' | undefined,
  payload: Record<string, unknown>,
): string {
  if (sessionFrom === 'story') {
    const story = payload['story'];
    if (typeof story === 'string' && story.trim().length > 0) return story;
  }
  return 'legacy';
}

/** Safe epoch-ms parse: an unparseable/malformed `timestamp_utc` falls back to `now` (RT-3). */
function toEpochMsOrNow(value: unknown, now: string): number {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.parse(now);
}

/** Same fallback as `toEpochMsOrNow`, but returns the original (valid) string form for `valid_from`. */
function toIsoStringOrNow(value: unknown, now: string): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : now;
}

/**
 * Pure migration planner (AC1, spec §5.5/§18.11): `planMigration(points, now,
 * rules, policies) -> { ops, byRule, skipped }`. A point with `schema_version
 * === '2'` is skipped. Every other point is matched against `rules` in order
 * (first match wins) and gets the rule's `set` fields plus the "all" row from
 * FR-2.8: `schema_version = '2'`, `consolidated/archived/superseded/pinned =
 * false`, `retrieval_count = used_count = 0`, `stability` from
 * `banks.kb.<kind>.initial_stability_days`, `stability_since = now`.
 * `dedupe_key_version` is never included in the returned payload - Qdrant's
 * `set_payload` merges rather than replaces, so an omitted key is left
 * unchanged on the stored point (spec: "unchanged").
 *
 * `bank` (§18.14 item 15): an existing `bank` value on the point is
 * preserved; otherwise it is set to `'kb'`. In practice every v1 point has no
 * `bank` field at all, so this is indistinguishable from AC1's "every
 * migrated point gets `bank = 'kb'`" for all real data (F-4).
 *
 * Never throws on a malformed point (RT-3): every field read from `payload`
 * is defensively typed/guarded, and an unparseable `timestamp_utc` falls back
 * to `now` rather than producing an invalid ISO string or throwing.
 *
 * A point matching no rule (only reachable if a non-exhaustive rule set
 * bypasses `parseMigrationRules`'s validation, since `planMigration` itself
 * does not re-validate `rules`) is left neither migrated nor skipped - it is
 * simply absent from every count, which is the same "arithmetic drift"
 * signal `parseMigrationRules`'s exhaustiveness gate exists to prevent
 * upstream of this function ever being called with such a rule set.
 */
export function planMigration(
  points: readonly MigratablePoint[],
  now: string,
  rules: readonly MigrationRule[],
  policies: PoliciesInput,
): MigrationPlan {
  const ops: MigrationOp[] = [];
  const byRule: Record<string, number> = {};
  let skipped = 0;

  for (const point of points) {
    const payload = point.payload ?? {};

    if (payload['schema_version'] === '2') {
      skipped++;
      continue;
    }

    const rule = rules.find((r) => matchesWhen(payload, r.when));
    if (!rule) continue;

    const kind = rule.set.kind;
    const policy = policyFor(policies as MemoConfig, DEFAULT_BANK_ID, kind) as KindPolicy;

    const existingBank = readString(payload, 'bank');
    const bank =
      existingBank !== undefined && existingBank.trim().length > 0 ? existingBank : DEFAULT_BANK_ID;

    const setPayload: Record<string, unknown> = {
      bank,
      schema_version: '2',
      kind,
      consolidated: false,
      archived: false,
      superseded: false,
      pinned: false,
      retrieval_count: 0,
      used_count: 0,
      stability_since: now,
    };

    if (policy.initial_stability_days !== undefined) {
      setPayload['stability'] = policy.initial_stability_days;
    }

    if (kind === 'episodic') {
      setPayload['session_id'] = resolveSessionId(rule.set.session_from, payload);
      const expiresInDays = rule.set.expires_in_days ?? policy.expires_in_days;
      if (expiresInDays !== undefined) {
        const baseMs = toEpochMsOrNow(payload['timestamp_utc'], now);
        setPayload['expires_at'] = new Date(baseMs + expiresInDays * DAY_MS).toISOString();
      }
    } else {
      setPayload['valid_from'] = toIsoStringOrNow(payload['timestamp_utc'], now);
    }

    ops.push({ id: point.id, payload: setPayload });
    byRule[rule.name] = (byRule[rule.name] ?? 0) + 1;
  }

  return { ops, byRule, skipped };
}
