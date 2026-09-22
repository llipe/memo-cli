import type { EntryKind } from '../types/entry.js';

/**
 * A stored payload after read-side normalization: every reader-facing v2
 * field that has a documented default is guaranteed present. Unknown/extra
 * fields from the source payload pass through unchanged (spread first).
 *
 * Spec §18.3's read boundary: `normalizeEntry` is the only place in the
 * codebase that knows "absent means v1" — no other reader re-derives these
 * defaults.
 */
export interface StoredEntry extends Record<string, unknown> {
  bank: string;
  kind: EntryKind;
  schema_version: '1' | '2';
  archived: boolean;
  superseded: boolean;
  consolidated: boolean;
  pinned: boolean;
  pending_contradiction: boolean;
  valid_from?: string;
}

/**
 * Pure read-side normalization boundary (spec §18.3). Maps a v1-shaped
 * payload to its v2 defaults; leaves an already v2-shaped payload untouched.
 *
 * `timestamp_utc` is not this function's concern (spec §18.14 item 1): it is
 * `z.string()` **required** on both `EntryPayloadSchema` and
 * `EntryPayloadV2Schema`, so no valid stored point can lack it — a point
 * missing it fails schema validation on read, upstream of normalization.
 * This function still does not throw if it is absent from the raw input, so
 * a defensive caller (or a not-yet-validated fixture) gets a safe fallback
 * (`valid_from` stays `undefined`) rather than a crash.
 */
export function normalizeEntry(payload: Record<string, unknown>): StoredEntry {
  const bank = (payload['bank'] as string | undefined) ?? 'kb';
  const kind = (payload['kind'] as EntryKind | undefined) ?? 'semantic';
  const schema_version = (payload['schema_version'] as '1' | '2' | undefined) ?? '1';
  const archived = (payload['archived'] as boolean | undefined) ?? false;
  const superseded = (payload['superseded'] as boolean | undefined) ?? false;
  const consolidated = (payload['consolidated'] as boolean | undefined) ?? false;
  const pinned = (payload['pinned'] as boolean | undefined) ?? false;
  const pending_contradiction = (payload['pending_contradiction'] as boolean | undefined) ?? false;
  const timestamp_utc = payload['timestamp_utc'] as string | undefined;

  let valid_from = payload['valid_from'] as string | undefined;
  if (valid_from === undefined && kind !== 'episodic') {
    valid_from = timestamp_utc;
  }

  return {
    ...payload,
    bank,
    kind,
    schema_version,
    archived,
    superseded,
    consolidated,
    pinned,
    pending_contradiction,
    valid_from,
  };
}

/**
 * Projects the additive-only subset of v2 fields that `search`/`list` add to
 * each JSON result (spec §18.7, story S2-05 AC8): `bank`/`kind` are always
 * present (every entry has both, defaulted by `normalizeEntry`); every other
 * field is included only when actually present/true on the source entry, so
 * a v1-shaped or otherwise-default entry gets none of the noise of a
 * synthesized `false`/`undefined` value (CT-1's additive-diff contract - a
 * pre-story consumer reading only pre-existing keys must see zero change).
 */
export function projectV2Fields(entry: StoredEntry): Record<string, unknown> {
  return {
    bank: entry.bank,
    kind: entry.kind,
    ...(entry['session_id'] !== undefined ? { session_id: entry['session_id'] } : {}),
    ...(entry['seq'] !== undefined ? { seq: entry['seq'] } : {}),
    ...(entry.valid_from !== undefined ? { valid_from: entry.valid_from } : {}),
    ...(entry['valid_to'] !== undefined ? { valid_to: entry['valid_to'] } : {}),
    ...(entry['superseded_by'] !== undefined ? { superseded_by: entry['superseded_by'] } : {}),
    ...(entry.archived ? { archived: true as const } : {}),
    ...(entry.superseded ? { superseded: true as const } : {}),
    ...(entry.pinned ? { pinned: true as const } : {}),
  };
}
