import { z } from 'zod';

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const KebabString = z
  .string()
  .regex(KEBAB_CASE, 'Must be kebab-case (lowercase letters, digits, hyphens only)');

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
export const DEFAULT_RECENCY_HALF_LIFE_DAYS = 90;
const WEIGHT_SUM_TOLERANCE = 0.001;

const RankingConfigSchema = z
  .object({
    w_similarity: z.number().finite().min(0).max(1).default(DEFAULT_RANKING_WEIGHTS.w_similarity),
    w_recency: z.number().finite().min(0).max(1).default(DEFAULT_RANKING_WEIGHTS.w_recency),
    w_source: z.number().finite().min(0).max(1).default(DEFAULT_RANKING_WEIGHTS.w_source),
    recency_half_life_days: z.number().finite().positive().default(DEFAULT_RECENCY_HALF_LIFE_DAYS),
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

export const MemoConfigSchema = z
  .object({
    schema_version: z.literal('1'),
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
