import {
  buildDedupeKey,
  buildDedupeKeyV2,
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

  // S2-01 / AC6: sourceToConfidence('scan') === 'low'.
  it('maps scan → low (S2-01 AC6)', () => {
    expect(sourceToConfidence('scan')).toBe('low');
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

describe('buildDedupeKeyV2 (AC6/AC7, spec §18.5)', () => {
  const SEMANTIC_BASE = {
    bank: 'jarvis-memory',
    kind: 'semantic' as const,
    repo: 'my-repo',
    commit: 'abc123',
    story: 'SP-1',
    entry_type: 'decision',
    source: 'agent',
  };

  const EPISODIC_BASE = {
    bank: 'jarvis-memory',
    kind: 'episodic' as const,
    repo: 'my-repo',
    commit: 'abc123',
    story: 'SP-1',
    session_id: 'sess-1',
    seq: 0,
    entry_type: 'observation',
    source: 'agent',
  };

  describe('semantic keys', () => {
    it('EC-42/CT-8: embeds actual values with the literal template (single "na" for the session slot)', () => {
      expect(buildDedupeKeyV2(SEMANTIC_BASE)).toBe(
        'v2|jarvis-memory|my-repo|abc123|SP-1|na|semantic|decision|agent',
      );
    });

    it('EC-43: substitutes "na" for undefined commit/story', () => {
      expect(buildDedupeKeyV2({ ...SEMANTIC_BASE, commit: undefined, story: undefined })).toBe(
        'v2|jarvis-memory|my-repo|na|na|na|semantic|decision|agent',
      );
    });

    it('EC-44: ignores stray session_id/seq passed to the semantic branch', () => {
      const withoutExtras = buildDedupeKeyV2(SEMANTIC_BASE);
      const withExtras = buildDedupeKeyV2({
        ...SEMANTIC_BASE,
        session_id: 'sess-should-be-ignored',
        seq: 7,
      } as typeof SEMANTIC_BASE & { session_id: string; seq: number });
      expect(withExtras).toBe(withoutExtras);
    });
  });

  describe('episodic keys', () => {
    it('EC-45/CT-8: includes session and seq, with seq=0 serialized as the literal "0"', () => {
      expect(buildDedupeKeyV2(EPISODIC_BASE)).toBe(
        'v2|jarvis-memory|my-repo|abc123|SP-1|sess-1|0|episodic|observation|agent',
      );
    });

    it('EC-46: substitutes "na" for undefined repo/commit/story, keeps session/seq literal', () => {
      expect(
        buildDedupeKeyV2({
          ...EPISODIC_BASE,
          repo: undefined,
          commit: undefined,
          story: undefined,
        }),
      ).toBe('v2|jarvis-memory|na|na|na|sess-1|0|episodic|observation|agent');
    });

    it('AC7/EC-48: seq=0 vs seq=1 with all else identical produce different keys', () => {
      const a = buildDedupeKeyV2({ ...EPISODIC_BASE, seq: 0 });
      const b = buildDedupeKeyV2({ ...EPISODIC_BASE, seq: 1 });
      expect(a).not.toBe(b);
    });

    it('AC7/EC-47: same inputs with the same seq produce the same key, called twice', () => {
      const a = buildDedupeKeyV2({ ...EPISODIC_BASE, seq: 3 });
      const b = buildDedupeKeyV2({ ...EPISODIC_BASE, seq: 3 });
      expect(a).toBe(b);
    });
  });

  describe('self keys (AC6)', () => {
    it('EC-50/CT-8: returns a 64-character lowercase hex SHA-256 digest', () => {
      const key = buildDedupeKeyV2({
        bank: 'jarvis-memory',
        kind: 'self',
        entry_type: 'structure',
        source: 'manual',
      });
      expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
    });

    it('EC-49: two calls with identical inputs never collide', () => {
      const params = {
        bank: 'jarvis-memory',
        kind: 'self' as const,
        entry_type: 'structure',
        source: 'manual',
      };
      const a = buildDedupeKeyV2(params);
      const b = buildDedupeKeyV2(params);
      expect(a).not.toBe(b);
    });

    it('property: 1,000 calls with identical fixed inputs produce zero collisions', () => {
      const params = {
        bank: 'jarvis-memory',
        kind: 'self' as const,
        entry_type: 'structure',
        source: 'manual',
      };
      const keys = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        keys.add(buildDedupeKeyV2(params));
      }
      expect(keys.size).toBe(1000);
    });
  });
});
