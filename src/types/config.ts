import { z } from 'zod';

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const KebabString = z
  .string()
  .regex(KEBAB_CASE, 'Must be kebab-case (lowercase letters, digits, hyphens only)');

// Spec §18.2: `bank.default` (and, via S2-01's schema-only scope, any future
// per-entry `bank` field) accepts either a kebab-case bank id or a UUID.
export const KebabOrUuid = KebabString.or(z.string().uuid());

// Ranking defaults per issue #34's binding refinement (D1-D9). The three
// weights are intentionally documented as 0.6/0.3/0.1 even though, in IEEE
// 754, `0.6 + 0.3 + 0.1 !== 1.0` exactly (it is `0.9999999999999999`) - the
// weight-sum tolerance below MUST stay a `±0.001` comparison, never `=== 1.0`,
// or the shipped defaults would fail their own validator.
export const DEFAULT_RANKING_WEIGHTS = {
  w_similarity: 0.6,
  w_recency: 0.3,
  w_source: 0.1,
} as const;
// Tuned from the spec-documented 90 to 365 via the task 8.0 sweep
// methodology, applied to this story after AC21's relevance replay failed
// at 90 days; see src/lib/ranking.ts's DEFAULT_RECENCY_HALF_LIFE_DAYS and
// PR #67 for the full rationale and sweep results.
export const DEFAULT_RECENCY_HALF_LIFE_DAYS = 365;
// Default `tag_boost_factor` per issue #36's AC1: `0.05`. `0` disables tag
// boosting entirely (AC2) - see src/lib/ranking.ts's DEFAULT_TAG_BOOST_FACTOR.
export const DEFAULT_TAG_BOOST_FACTOR = 0.05;
// Default `confidence_thresholds` per issue #35's AC1/AC6 - see
// src/lib/ranking.ts's DEFAULT_CONFIDENCE_THRESHOLDS.
export const DEFAULT_CONFIDENCE_THRESHOLDS = {
  exact: 0.88,
  high: 0.75,
  medium: 0.6,
} as const;
// Staleness defaults per issue #38's AC1 - see src/lib/staleness.ts's
// DEFAULT_STALENESS_THRESHOLD_DAYS and DEFAULT_STALENESS_TAG_OVERLAP_THRESHOLD.
export const DEFAULT_STALENESS_THRESHOLD_DAYS = 120;
export const DEFAULT_STALENESS_TAG_OVERLAP_THRESHOLD = 0.5;
// Lexical matching defaults per issue #62's AC6/AC7 - see
// src/lib/ranking.ts's DEFAULT_LEXICAL_BOOST_FACTOR.
export const DEFAULT_LEXICAL_ENABLED = true;
export const DEFAULT_LEXICAL_BOOST_FACTOR = 0.15;
const WEIGHT_SUM_TOLERANCE = 0.001;

// #35 AC2: `exact > high > medium` must hold strictly - equal values are
// rejected too, since a zero-width band would make that tier unreachable.
const ConfidenceThresholdsSchema = z
  .object({
    exact: z.number().finite().min(0).max(1).default(DEFAULT_CONFIDENCE_THRESHOLDS.exact),
    high: z.number().finite().min(0).max(1).default(DEFAULT_CONFIDENCE_THRESHOLDS.high),
    medium: z.number().finite().min(0).max(1).default(DEFAULT_CONFIDENCE_THRESHOLDS.medium),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!(data.exact > data.high && data.high > data.medium)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `ranking.confidence_thresholds must be strictly descending (exact > high > medium); actual: exact=${String(data.exact)}, high=${String(data.high)}, medium=${String(data.medium)}`,
      });
    }
  });

const RankingConfigSchema = z
  .object({
    w_similarity: z.number().finite().min(0).max(1).default(DEFAULT_RANKING_WEIGHTS.w_similarity),
    w_recency: z.number().finite().min(0).max(1).default(DEFAULT_RANKING_WEIGHTS.w_recency),
    w_source: z.number().finite().min(0).max(1).default(DEFAULT_RANKING_WEIGHTS.w_source),
    recency_half_life_days: z.number().finite().positive().default(DEFAULT_RECENCY_HALF_LIFE_DAYS),
    // #36 AC1/AC2: additive tag-overlap boost factor. `0` is a valid,
    // intentional "disable" value, so this is `min(0)` (non-negative), not
    // `positive()` like recency_half_life_days.
    tag_boost_factor: z.number().finite().min(0).default(DEFAULT_TAG_BOOST_FACTOR),
    // #35 AC1/AC2: confidence tier band boundaries.
    confidence_thresholds: ConfidenceThresholdsSchema.default({}),
    // #38 AC1: age (in days) beyond which a result becomes eligible to be
    // flagged stale. `0` is a valid (if extreme) value - non-negative, not
    // `positive()`, since a threshold of `0` means "every result older than
    // now is eligible", which is a legitimate (if aggressive) configuration.
    staleness_threshold_days: z.number().finite().min(0).default(DEFAULT_STALENESS_THRESHOLD_DAYS),
    // #38 AC1: minimum Jaccard tag overlap with a newer same-repo entry
    // required to flag a result stale.
    staleness_tag_overlap_threshold: z
      .number()
      .finite()
      .min(0)
      .max(1)
      .default(DEFAULT_STALENESS_TAG_OVERLAP_THRESHOLD),
    // #62 AC7: `false` (and `--lexical off`) skips the extra lexical scroll
    // entirely.
    lexical: z.boolean().default(DEFAULT_LEXICAL_ENABLED),
    // #62 AC6: additive lexical-match boost factor. `0` is a valid,
    // intentional "disable" value, so this is `min(0)`, not `positive()`.
    lexical_boost_factor: z.number().finite().min(0).default(DEFAULT_LEXICAL_BOOST_FACTOR),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    const sum = data.w_similarity + data.w_recency + data.w_source;
    if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `ranking weights (w_similarity + w_recency + w_source) must sum to 1.0 (±${String(WEIGHT_SUM_TOLERANCE)}); actual sum: ${String(sum)}`,
      });
    }
  });

export type RankingConfig = z.infer<typeof RankingConfigSchema>;

// ---------------------------------------------------------------------------
// Config v2 (issue #53 / S2-01) — spec §18.2, defaults per §8.4
// ---------------------------------------------------------------------------

// Per-kind lifecycle/retention policy. No field carries a Zod `.default()` at
// this level (spec §18.2): defaults are supplied one level up, as the literal
// object passed to each bank/kind's own `.default(...)` below, so a partial
// override (e.g. only `banks.private.self.soft_cap`) does not blank out
// sibling policy blocks (AC2/AC3, spec §18.2, test plan CT-3).
const KindPolicySchema = z
  .object({
    initial_stability_days: z.number().positive().optional(),
    expires_in_days: z.number().int().positive().optional(),
    archive_threshold: z.number().min(0).max(1).optional(),
    archive_noisy: z.boolean().optional(),
    promoted_grace_days: z.number().int().min(0).optional(),
    superseded_grace_days: z.number().int().min(0).optional(),
    // `null` = never purge automatically; absent = no policy opinion (see the
    // per-bank/kind `.default()` literals below for when each resolves).
    purge_after_days: z.number().int().positive().nullable().optional(),
  })
  .strict();

export type KindPolicy = z.infer<typeof KindPolicySchema>;

const SelfPolicySchema = z.object({ soft_cap: z.number().int().positive().default(50) }).strict();

export type SelfPolicy = z.infer<typeof SelfPolicySchema>;

// Policy defaults table (spec §8.4, refined by A5/A6). Exported as named
// constants (`DEFAULT_*` pattern) per the story's Business Rules.
export const DEFAULT_KB_EPISODIC_POLICY: KindPolicy = {
  initial_stability_days: 3,
  expires_in_days: 90,
  promoted_grace_days: 7,
  purge_after_days: null,
};
export const DEFAULT_KB_SEMANTIC_POLICY: KindPolicy = {
  initial_stability_days: 90,
  archive_threshold: 0.05,
  archive_noisy: false,
  superseded_grace_days: 30,
  purge_after_days: null,
};
export const DEFAULT_PRIVATE_EPISODIC_POLICY: KindPolicy = {
  initial_stability_days: 3,
  expires_in_days: 30,
  promoted_grace_days: 7,
  purge_after_days: 30,
};
export const DEFAULT_PRIVATE_SEMANTIC_POLICY: KindPolicy = {
  initial_stability_days: 30,
  archive_threshold: 0.05,
  archive_noisy: true,
  superseded_grace_days: 30,
  purge_after_days: 90,
};
export const DEFAULT_PRIVATE_SELF_SOFT_CAP = 50;
export const DEFAULT_BANK_ID = 'kb';
export const DEFAULT_RECALL_MAX_TOKENS = 2000;

const BanksConfigSchema = z
  .object({
    kb: z
      .object({
        episodic: KindPolicySchema.default(DEFAULT_KB_EPISODIC_POLICY),
        semantic: KindPolicySchema.default(DEFAULT_KB_SEMANTIC_POLICY),
      })
      .default({}),
    private: z
      .object({
        self: SelfPolicySchema.default({}),
        episodic: KindPolicySchema.default(DEFAULT_PRIVATE_EPISODIC_POLICY),
        semantic: KindPolicySchema.default(DEFAULT_PRIVATE_SEMANTIC_POLICY),
      })
      .default({}),
  })
  .default({});

export type BanksConfig = z.infer<typeof BanksConfigSchema>;

const BankConfigSchema = z.object({ default: KebabOrUuid.default(DEFAULT_BANK_ID) }).default({});

export type BankConfig = z.infer<typeof BankConfigSchema>;

const RecallConfigSchema = z
  .object({ max_tokens: z.number().int().positive().default(DEFAULT_RECALL_MAX_TOKENS) })
  .default({});

export type RecallConfig = z.infer<typeof RecallConfigSchema>;

export const MemoConfigSchema = z
  .object({
    schema_version: z.enum(['1', '2']),
    bank: BankConfigSchema,
    banks: BanksConfigSchema,
    recall: RecallConfigSchema,
    repo: KebabString,
    org: KebabString,
    domain: KebabString,
    relates_to: z.array(KebabString).optional().default([]),
    defaults: z
      .object({
        source: z.enum(['agent', 'manual']).default('agent'),
        search_scope: z.enum(['repo', 'related']).default('repo'),
      })
      .default({}),
    // Additive and optional (AC10): v1 configs without a `ranking` block
    // remain valid and resolve every field to its documented default.
    // A block that is present but partial (AC11) still has each *missing*
    // field individually defaulted by the object shape above, then the
    // *resolved* (default-filled) weights are validated by the sum check -
    // so a partial override that leaves the weight sum broken is rejected,
    // while a partial override that only touches `recency_half_life_days`
    // (leaving all three weights at their defaults) legitimately passes.
    ranking: RankingConfigSchema.default({}),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    const relates = data.relates_to;
    const seen = new Set<string>();

    for (let i = 0; i < relates.length; i++) {
      const r = relates[i];
      if (r === undefined) continue;

      if (seen.has(r)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['relates_to', i],
          message: `Duplicate entry: "${r}"`,
        });
      }
      seen.add(r);

      if (r === data.repo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['relates_to', i],
          message: `"${r}" must not equal repo`,
        });
      }
    }
  });

export type MemoConfig = z.infer<typeof MemoConfigSchema>;
