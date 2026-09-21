import { normalizeEntry } from '../../../src/lib/entry-normalize';

const V1_POINT = {
  id: '00000000-0000-0000-0000-000000000001',
  repo: 'memo-cli',
  org: 'llipe',
  domain: 'developer-tools',
  rationale: 'We chose Qdrant because it supports payload filtering.',
  tags: ['qdrant', 'storage'],
  entry_type: 'decision',
  source: 'agent',
  confidence: 'high',
  timestamp_utc: '2025-01-01T00:00:00.000Z',
  dedupe_key_sha256: 'a'.repeat(64),
  dedupe_key_version: 'v1',
};

describe('normalizeEntry', () => {
  // ---------------------------------------------------------------------------
  // AC7: v1 payload mapping
  // ---------------------------------------------------------------------------

  it('maps a v1 payload to the documented v2 defaults (AC7)', () => {
    const result = normalizeEntry(V1_POINT);

    expect(result.bank).toBe('kb');
    expect(result.kind).toBe('semantic');
    expect(result.schema_version).toBe('1');
    expect(result.archived).toBe(false);
    expect(result.superseded).toBe(false);
    expect(result.consolidated).toBe(false);
    expect(result.pinned).toBe(false);
    expect(result.pending_contradiction).toBe(false);
    expect(result.valid_from).toBe(V1_POINT.timestamp_utc);
  });

  it('does not mutate the original payload object', () => {
    const copy = { ...V1_POINT };
    normalizeEntry(V1_POINT);
    expect(V1_POINT).toEqual(copy);
  });

  it('preserves every other v1 field unchanged', () => {
    const result = normalizeEntry(V1_POINT);
    expect(result['id']).toBe(V1_POINT.id);
    expect(result['repo']).toBe(V1_POINT.repo);
    expect(result['rationale']).toBe(V1_POINT.rationale);
    expect(result['dedupe_key_sha256']).toBe(V1_POINT.dedupe_key_sha256);
  });

  // ---------------------------------------------------------------------------
  // EC-17: v2-shaped payload passes through untouched
  // ---------------------------------------------------------------------------

  it('leaves a fully v2-shaped payload untouched (EC-17)', () => {
    const v2Point = {
      ...V1_POINT,
      schema_version: '2',
      bank: 'jarvis-memory',
      kind: 'self',
      archived: true,
      superseded: true,
      consolidated: true,
      pinned: true,
      pending_contradiction: true,
      valid_from: '2026-01-01T00:00:00.000Z',
    };

    const result = normalizeEntry(v2Point);

    expect(result.bank).toBe('jarvis-memory');
    expect(result.kind).toBe('self');
    expect(result.schema_version).toBe('2');
    expect(result.archived).toBe(true);
    expect(result.superseded).toBe(true);
    expect(result.consolidated).toBe(true);
    expect(result.pinned).toBe(true);
    expect(result.pending_contradiction).toBe(true);
    expect(result.valid_from).toBe('2026-01-01T00:00:00.000Z');
  });

  it('does not overwrite an explicit valid_from with timestamp_utc even for non-episodic kinds', () => {
    const point = {
      ...V1_POINT,
      schema_version: '2',
      bank: 'kb',
      kind: 'semantic',
      valid_from: '2026-06-01T00:00:00.000Z',
    };
    const result = normalizeEntry(point);
    expect(result.valid_from).toBe('2026-06-01T00:00:00.000Z');
  });

  it('does not set valid_from from timestamp_utc for an episodic entry', () => {
    const point = {
      ...V1_POINT,
      schema_version: '2',
      bank: 'kb',
      kind: 'episodic',
      session_id: 'ISSUE-53',
    };
    const result = normalizeEntry(point);
    expect(result.valid_from).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // EC-16: missing timestamp_utc handled without throwing
  // ---------------------------------------------------------------------------

  it('does not throw when timestamp_utc is entirely absent (EC-16, spec §18.14 item 1)', () => {
    const { timestamp_utc: _t, ...rest } = V1_POINT;
    expect(() => normalizeEntry(rest)).not.toThrow();
  });

  it('leaves valid_from undefined when both timestamp_utc and valid_from are absent (EC-16)', () => {
    const { timestamp_utc: _t, ...rest } = V1_POINT;
    const result = normalizeEntry(rest);
    expect(result.valid_from).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Pure-function contract
  // ---------------------------------------------------------------------------

  it('is pure: calling twice with the same input yields the same output', () => {
    const a = normalizeEntry(V1_POINT);
    const b = normalizeEntry(V1_POINT);
    expect(a).toEqual(b);
  });
});
