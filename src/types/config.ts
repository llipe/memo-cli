import { z } from 'zod';

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const KebabString = z
  .string()
  .regex(KEBAB_CASE, 'Must be kebab-case (lowercase letters, digits, hyphens only)');

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
