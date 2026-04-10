import { z } from 'zod';

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const KebabString = z.string().regex(KEBAB_CASE, 'Must be kebab-case');

export const EntryPayloadSchema = z.object({
  id: z.string().uuid(),
  repo: KebabString,
  org: KebabString,
  domain: KebabString,
  rationale: z.string().min(1).max(5000),
  tags: z.array(KebabString).min(2).max(5),
  entry_type: z.enum(['decision', 'integration_point', 'structure']),
  source: z.enum(['agent', 'manual']),
  confidence: z.enum(['high', 'medium', 'low']),
  timestamp_utc: z.string(),
  commit: z.string().optional(),
  story: z.string().optional(),
  files_modified: z.array(z.string()).optional(),
  relates_to: z.array(KebabString).optional(),
  dedupe_key_sha256: z.string(),
  dedupe_key_version: z.literal('v1'),
});

export type EntryPayload = z.infer<typeof EntryPayloadSchema>;
