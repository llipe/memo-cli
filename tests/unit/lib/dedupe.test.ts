import {
  buildDedupeKey,
  buildEmbedText,
  consolidate,
  sourceToConfidence,
  update,
} from '../../../src/lib/dedupe.js';
import type { EntryPayload } from '../../../src/types/entry.js';

const BASE: EntryPayload = {
  id: '00000000-0000-0000-0000-000000000001',
  repo: 'my-repo',
  org: 'my-org',
  domain: 'backend',
  rationale: 'We chose Qdrant because it supports payload filtering.',
  tags: ['qdrant', 'storage'],
  entry_type: 'decision',
  source: 'agent',
  confidence: 'high',
  timestamp_utc: '2025-01-01T00:00:00.000Z',
  dedupe_key_sha256: 'abc123',
  dedupe_key_version: 'v1',
};

describe('buildDedupeKey', () => {
  it('produces a 64-char hex SHA-256', () => {
    const key = buildDedupeKey({
      repo: 'my-repo',
      commit: 'abc',
      story: 'SP-1',
      entry_type: 'decision',
      source: 'agent',
    });
    expect(key).toHaveLength(64);
    expect(/^[a-f0-9]+$/.test(key)).toBe(true);
  });

  it('uses "na" for missing commit and story', () => {
    const a = buildDedupeKey({
      repo: 'r',
      commit: undefined,
      story: undefined,
      entry_type: 'decision',
      source: 'agent',
    });
    const b = buildDedupeKey({
      repo: 'r',
      commit: 'na',
      story: 'na',
      entry_type: 'decision',
      source: 'agent',
    });
    expect(a).toBe(b);
  });

  it('is deterministic for same inputs', () => {
    const k1 = buildDedupeKey({
      repo: 'r',
      commit: 'c',
      story: 's',
      entry_type: 'decision',
      source: 'agent',
    });
    const k2 = buildDedupeKey({
      repo: 'r',
      commit: 'c',
      story: 's',
      entry_type: 'decision',
      source: 'agent',
    });
    expect(k1).toBe(k2);
  });

  it('differs when any param changes', () => {
    const base = { repo: 'r', commit: 'c', story: 's', entry_type: 'decision', source: 'agent' };
    const k1 = buildDedupeKey(base);
    const k2 = buildDedupeKey({ ...base, repo: 'other' });
    expect(k1).not.toBe(k2);
  });
});

describe('sourceToConfidence', () => {
  it('maps agent → high', () => {
    expect(sourceToConfidence('agent')).toBe('high');
  });

  it('maps manual → medium', () => {
    expect(sourceToConfidence('manual')).toBe('medium');
  });
});

describe('buildEmbedText', () => {
  it('includes first sentence, tags, and full rationale', () => {
    const text = buildEmbedText('We chose Qdrant. More detail here.', ['qdrant', 'db']);
    expect(text).toContain('We chose Qdrant');
    expect(text).toContain('qdrant db');
    expect(text).toContain('We chose Qdrant. More detail here.');
  });
});

describe('consolidate', () => {
  it('unions tags up to 5', () => {
    const incoming: EntryPayload = {
      ...BASE,
      id: '00000000-0000-0000-0000-000000000002',
      tags: ['qdrant', 'performance', 'infra'],
    };
    const result = consolidate(BASE, incoming);
    expect(result.tags.length).toBeLessThanOrEqual(5);
    expect(result.tags).toContain('qdrant');
    expect(result.tags).toContain('storage');
    expect(result.tags).toContain('performance');
  });

  it('prefers incoming tags when capping at 5', () => {
    const existing: EntryPayload = { ...BASE, tags: ['a', 'b', 'c', 'd', 'e'] };
    const incoming: EntryPayload = {
      ...BASE,
      id: '00000000-0000-0000-0000-000000000002',
      tags: ['f', 'g'],
    };
    const result = consolidate(existing, incoming);
    expect(result.tags).toEqual(['f', 'g', 'a', 'b', 'c']);
  });

  it('keeps higher confidence', () => {
    const low: EntryPayload = { ...BASE, confidence: 'low' };
    const high: EntryPayload = {
      ...BASE,
      id: '00000000-0000-0000-0000-000000000002',
      confidence: 'high',
    };
    expect(consolidate(low, high).confidence).toBe('high');
    expect(consolidate(high, low).confidence).toBe('high');
  });

  it('keeps longer rationale', () => {
    const short: EntryPayload = { ...BASE, rationale: 'Short.' };
    const long: EntryPayload = {
      ...BASE,
      id: '00000000-0000-0000-0000-000000000002',
      rationale: 'This is a much longer rationale with more detail.',
    };
    expect(consolidate(short, long).rationale).toBe(long.rationale);
  });

  it('preserves original timestamp', () => {
    const incoming: EntryPayload = {
      ...BASE,
      id: '00000000-0000-0000-0000-000000000002',
      timestamp_utc: '2025-06-01T00:00:00.000Z',
    };
    const result = consolidate(BASE, incoming);
    expect(result.timestamp_utc).toBe(BASE.timestamp_utc);
  });
});

describe('update', () => {
  it('patches tags and files_modified', () => {
    const patch: Partial<EntryPayload> = {
      tags: ['new-tag', 'other'],
      files_modified: ['src/a.ts'],
    };
    const result = update(BASE, patch);
    expect(result.tags).toEqual(['new-tag', 'other']);
    expect(result.files_modified).toEqual(['src/a.ts']);
  });

  it('keeps immutable fields unchanged', () => {
    const patch: Partial<EntryPayload> = { id: '00000000-0000-0000-0000-000000000999' };
    const result = update(BASE, patch);
    expect(result.id).toBe(BASE.id);
  });
});
