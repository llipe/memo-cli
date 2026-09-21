import { z } from 'zod';
import { KebabOrUuid } from './config.js';

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

// ---------------------------------------------------------------------------
// Schema v2 (issue #53 / S2-01) — spec §18.3, PRD §2.5 (K1-K5)
// ---------------------------------------------------------------------------

export const EntryKindSchema = z.enum(['self', 'episodic', 'semantic']);
export type EntryKind = z.infer<typeof EntryKindSchema>;

// Reasons an entry can be archived, per the §2.6 deletion-contract state
// machine and §8.4's decision table (`promoted`, `expired`, `superseded`,
// `decayed`, `noisy`) plus FR-3.5's explicit `memo forget` default reason.
export const ArchivedReasonSchema = z.enum([
  'promoted',
  'expired',
  'superseded',
  'decayed',
  'noisy',
  'forget',
]);
export type ArchivedReason = z.infer<typeof ArchivedReasonSchema>;

/**
 * Write-time schema for v2 payloads. A superset of `EntryPayloadSchema`
 * (which remains exported unchanged, AC9) with the v2 field additions from
 * spec §18.3 and the six-rule `superRefine` validation table (K1-K3 plus the
 * `self`/`seq` constraints). `repo`/`org`/`domain` become optional at the
 * schema level; K2 enforces them for `bank: 'kb'` in the same refinement.
 *
 * `schema_version` defaults to `'2'` so a v1-shaped payload validates once
 * `bank`/`kind` are supplied explicitly, without also requiring the caller to
 * add a `schema_version` field (spec §18.3's stated cross-cutting test).
 */
export const EntryPayloadV2Schema = z
  .object({
    id: z.string().uuid(),
    schema_version: z.literal('2').default('2'),
    bank: KebabOrUuid,
    kind: EntryKindSchema,
    repo: KebabString.optional(),
    org: KebabString.optional(),
    domain: KebabString.optional(),
    rationale: z.string().min(1).max(5000),
    tags: z.array(KebabString).min(2).max(5),
    entry_type: z.enum(['decision', 'integration_point', 'structure', 'policy', 'observation']),
    source: z.enum(['agent', 'manual', 'scan']),
    confidence: z.enum(['high', 'medium', 'low']),
    timestamp_utc: z.string(),
    commit: z.string().optional(),
    story: z.string().optional(),
    files_modified: z.array(z.string()).optional(),
    relates_to: z.array(KebabString).optional(),
    session_id: z.string().min(1).max(128).optional(),
    seq: z.number().int().min(0).optional(),
    contexts: z.array(KebabString).optional(),
    provenance: z.array(z.string().uuid()).optional(),
    valid_from: z.string().optional(),
    valid_to: z.string().optional(),
    superseded: z.boolean().default(false),
    superseded_by: z.string().uuid().optional(),
    consolidated: z.boolean().default(false),
    consolidated_at: z.string().optional(),
    pinned: z.boolean().default(false),
    archived: z.boolean().default(false),
    archived_reason: ArchivedReasonSchema.optional(),
    archived_at: z.string().optional(),
    expires_at: z.string().optional(),
    stability: z.number().optional(),
    stability_since: z.string().optional(),
    last_retrieved_at: z.string().optional(),
    retrieval_count: z.number().int().min(0).optional(),
    used_count: z.number().int().min(0).optional(),
    pending_contradiction: z.boolean().default(false),
    dedupe_key_sha256: z.string(),
    dedupe_key_version: z.enum(['v1', 'v2']),
  })
  .superRefine((data, ctx) => {
    // K1 — `self` only in private banks.
    if (data.kind === 'self' && data.bank === 'kb') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kind'],
        message: '"self" entries are not allowed in the "kb" bank (K1)',
      });
    }

    // K2 — scope (`repo`/`org`/`domain`) required in `kb`; schema-level
    // backstop, the command layer raises REPO_CONTEXT_UNRESOLVED first.
    if (data.bank === 'kb' && !(data.repo && data.org && data.domain)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['repo'],
        message: '"repo", "org", and "domain" are required for entries in the "kb" bank (K2)',
      });
    }

    // episodic entries need a session.
    if (data.kind === 'episodic' && !data.session_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['session_id'],
        message: '"session_id" is required for "episodic" entries',
      });
    }

    // K3 — agent-authored semantic entries need at least one provenance id.
    if (
      data.kind === 'semantic' &&
      data.source === 'agent' &&
      (data.provenance ?? []).length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provenance'],
        message: 'agent-authored "semantic" entries require at least one "provenance" id (K3)',
      });
    }

    // `self` carries no retention fields.
    if (
      data.kind === 'self' &&
      (data.stability !== undefined ||
        data.expires_at !== undefined ||
        data.retrieval_count !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kind'],
        message: '"self" entries must not carry stability, expires_at, or retrieval_count',
      });
    }

    // `seq` only on episodic.
    if (data.seq !== undefined && data.kind !== 'episodic') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['seq'],
        message: '"seq" is only valid on "episodic" entries',
      });
    }
  });

export type EntryPayloadV2 = z.infer<typeof EntryPayloadV2Schema>;
