import { EntryPayloadSchema, EntryPayloadV2Schema } from '../../../src/types/entry';

const UUID_1 = '00000000-0000-0000-0000-000000000001';
const UUID_2 = '00000000-0000-0000-0000-000000000002';

function baseSelf(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID_1,
    bank: 'jarvis-memory',
    kind: 'self' as const,
    rationale: 'The owner prefers concise, action-first responses.',
    tags: ['persona', 'preference'],
    entry_type: 'decision' as const,
    source: 'manual' as const,
    confidence: 'high' as const,
    timestamp_utc: '2026-01-01T00:00:00.000Z',
    dedupe_key_sha256: 'a'.repeat(64),
    dedupe_key_version: 'v2' as const,
    ...overrides,
  };
}

function baseEpisodic(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID_1,
    bank: 'jarvis-memory',
    kind: 'episodic' as const,
    session_id: 'ISSUE-53',
    seq: 0,
    rationale: 'Investigated the S2-01 schema shape before implementation.',
    tags: ['investigation', 'schema'],
    entry_type: 'observation' as const,
    source: 'agent' as const,
    confidence: 'high' as const,
    timestamp_utc: '2026-01-01T00:00:00.000Z',
    dedupe_key_sha256: 'b'.repeat(64),
    dedupe_key_version: 'v2' as const,
    ...overrides,
  };
}

function baseSemanticKb(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID_1,
    bank: 'kb',
    kind: 'semantic' as const,
    repo: 'memo-cli',
    org: 'llipe',
    domain: 'developer-tools',
    rationale: 'Config v2 introduces bank/kind fields without breaking v1 configs.',
    tags: ['config', 'schema'],
    entry_type: 'decision' as const,
    source: 'manual' as const,
    confidence: 'high' as const,
    timestamp_utc: '2026-01-01T00:00:00.000Z',
    dedupe_key_sha256: 'c'.repeat(64),
    dedupe_key_version: 'v2' as const,
    ...overrides,
  };
}

describe('EntryPayloadV2Schema', () => {
  // ---------------------------------------------------------------------------
  // Positive cases per kind (task 1.2)
  // ---------------------------------------------------------------------------

  describe('positive cases per kind', () => {
    it('accepts a valid self payload in a private bank (CT-6)', () => {
      const result = EntryPayloadV2Schema.safeParse(baseSelf());
      expect(result.success).toBe(true);
    });

    it('accepts a valid episodic payload with session_id and seq: 0 in kb (CT-7)', () => {
      const result = EntryPayloadV2Schema.safeParse(
        baseEpisodic({
          bank: 'kb',
          repo: 'memo-cli',
          org: 'llipe',
          domain: 'developer-tools',
        }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts a valid semantic payload with source: agent and non-empty provenance (CT-8)', () => {
      const result = EntryPayloadV2Schema.safeParse(
        baseSemanticKb({ source: 'agent', provenance: [UUID_2] }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts a valid semantic payload with source: manual and no provenance (CT-9)', () => {
      const result = EntryPayloadV2Schema.safeParse(baseSemanticKb({ source: 'manual' }));
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // entry_type / source additions (AC6)
  // ---------------------------------------------------------------------------

  describe('entry_type and source additions (AC6)', () => {
    it('accepts entry_type: policy (CT-10)', () => {
      const result = EntryPayloadV2Schema.safeParse(baseSemanticKb({ entry_type: 'policy' }));
      expect(result.success).toBe(true);
    });

    it('accepts entry_type: observation (CT-10)', () => {
      const result = EntryPayloadV2Schema.safeParse(baseSemanticKb({ entry_type: 'observation' }));
      expect(result.success).toBe(true);
    });

    it('accepts source: scan (CT-11)', () => {
      const result = EntryPayloadV2Schema.safeParse(baseSemanticKb({ source: 'scan' }));
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // AC5 rejection rules
  // ---------------------------------------------------------------------------

  describe('AC5 rejection rules', () => {
    it('K1: rejects kind: self in bank: kb, naming "kind" (EC-1)', () => {
      const result = EntryPayloadV2Schema.safeParse(
        baseSelf({ bank: 'kb', repo: 'memo-cli', org: 'llipe', domain: 'developer-tools' }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('kind'))).toBe(true);
      }
    });

    it('rejects kind: episodic without session_id, naming "session_id" (EC-2)', () => {
      const { session_id: _sessionId, ...rest } = baseEpisodic();
      const result = EntryPayloadV2Schema.safeParse(rest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('session_id'))).toBe(true);
      }
    });

    it('K3: rejects semantic + source: agent + empty provenance, naming "provenance" (EC-3)', () => {
      const result = EntryPayloadV2Schema.safeParse(
        baseSemanticKb({ source: 'agent', provenance: [] }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('provenance'))).toBe(true);
      }
    });

    it('K3: rejects semantic + source: agent + absent provenance, naming "provenance" (EC-4)', () => {
      const result = EntryPayloadV2Schema.safeParse(baseSemanticKb({ source: 'agent' }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('provenance'))).toBe(true);
      }
    });

    it('rejects self carrying stability, naming "kind" (EC-5)', () => {
      const result = EntryPayloadV2Schema.safeParse(baseSelf({ stability: 30 }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('kind'))).toBe(true);
      }
    });

    it('rejects self carrying expires_at, naming "kind" (EC-5)', () => {
      const result = EntryPayloadV2Schema.safeParse(
        baseSelf({ expires_at: '2026-02-01T00:00:00.000Z' }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('kind'))).toBe(true);
      }
    });

    it('rejects self carrying retrieval_count, naming "kind" (EC-5)', () => {
      const result = EntryPayloadV2Schema.safeParse(baseSelf({ retrieval_count: 1 }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('kind'))).toBe(true);
      }
    });

    it('rejects seq on a non-episodic (semantic) entry, naming "seq" (EC-6)', () => {
      const result = EntryPayloadV2Schema.safeParse(baseSemanticKb({ seq: 0 }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('seq'))).toBe(true);
      }
    });

    it('K2: rejects bank: kb missing repo/org/domain, naming "repo" (EC-7, F-1)', () => {
      const result = EntryPayloadV2Schema.safeParse(
        baseSemanticKb({ repo: undefined, org: undefined, domain: undefined }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('repo'))).toBe(true);
      }
    });

    it('safeParse collects the kind-path issue when two rules share it (EC-18)', () => {
      const result = EntryPayloadV2Schema.safeParse(
        baseSelf({
          bank: 'kb',
          repo: 'memo-cli',
          org: 'llipe',
          domain: 'developer-tools',
          stability: 30,
        }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('kind'))).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Field-level edge cases
  // ---------------------------------------------------------------------------

  describe('field-level edge cases', () => {
    it('rejects an invalid kebab entry in contexts (EC-14)', () => {
      const result = EntryPayloadV2Schema.safeParse(
        baseSemanticKb({ contexts: ['Not-Kebab', 'ok-value'] }),
      );
      expect(result.success).toBe(false);
    });

    it('accepts valid kebab contexts', () => {
      const result = EntryPayloadV2Schema.safeParse(
        baseSemanticKb({ contexts: ['ok-value', 'another-one'] }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects a non-UUID provenance entry (EC-15)', () => {
      const result = EntryPayloadV2Schema.safeParse(
        baseSemanticKb({ source: 'agent', provenance: ['not-a-uuid'] }),
      );
      expect(result.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // CT-12: v1-shaped payload validated against the v2 schema when bank/kind supplied
  // ---------------------------------------------------------------------------

  it('accepts a v1-shaped payload (no schema_version) when bank/kind are supplied explicitly (CT-12)', () => {
    const v1Shaped = {
      id: UUID_1,
      repo: 'memo-cli',
      org: 'llipe',
      domain: 'developer-tools',
      rationale: 'We chose Qdrant because it supports payload filtering.',
      tags: ['qdrant', 'storage'],
      entry_type: 'decision' as const,
      source: 'manual' as const,
      confidence: 'high' as const,
      timestamp_utc: '2025-01-01T00:00:00.000Z',
      dedupe_key_sha256: 'd'.repeat(64),
      dedupe_key_version: 'v1' as const,
      bank: 'kb',
      kind: 'semantic',
    };
    const result = EntryPayloadV2Schema.safeParse(v1Shaped);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema_version).toBe('2');
    }
  });

  // ---------------------------------------------------------------------------
  // AC9 / CT-13: v1 EntryPayloadSchema regression
  // ---------------------------------------------------------------------------

  it('leaves the v1 EntryPayloadSchema export unchanged (CT-13, AC9)', () => {
    const v1Payload = {
      id: UUID_1,
      repo: 'memo-cli',
      org: 'llipe',
      domain: 'developer-tools',
      rationale: 'We chose Qdrant because it supports payload filtering.',
      tags: ['qdrant', 'storage'],
      entry_type: 'decision' as const,
      source: 'agent' as const,
      confidence: 'high' as const,
      timestamp_utc: '2025-01-01T00:00:00.000Z',
      dedupe_key_sha256: 'e'.repeat(64),
      dedupe_key_version: 'v1' as const,
    };
    const result = EntryPayloadSchema.safeParse(v1Payload);
    expect(result.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // RT-1: randomized decision-table fuzz (fixed seed, deterministic)
  // ---------------------------------------------------------------------------

  describe('RT-1: decision-table fuzz (fixed seed 42)', () => {
    // Simple deterministic PRNG (mulberry32) seeded with 42 for reproducibility.
    function mulberry32(seed: number) {
      return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const rand = mulberry32(42);
    const KINDS = ['self', 'episodic', 'semantic'] as const;
    const BANKS = ['kb', 'jarvis-memory'] as const;
    const SOURCES = ['agent', 'manual', 'scan'] as const;

    function pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(rand() * arr.length)] as T;
    }

    // Independent oracle mirroring spec §18.3's six-rule table.
    function expectedAccept(input: {
      kind: (typeof KINDS)[number];
      bank: (typeof BANKS)[number];
      hasSession: boolean;
      source: (typeof SOURCES)[number];
      provenanceLength: number;
      hasStability: boolean;
      hasSeq: boolean;
    }): boolean {
      if (input.kind === 'self' && input.bank === 'kb') return false;
      if (input.bank === 'kb') {
        // repo/org/domain always supplied in this fuzz harness, so K2 never fires here.
      }
      if (input.kind === 'episodic' && !input.hasSession) return false;
      if (input.kind === 'semantic' && input.source === 'agent' && input.provenanceLength === 0) {
        return false;
      }
      if (input.kind === 'self' && input.hasStability) return false;
      if (input.hasSeq && input.kind !== 'episodic') return false;
      return true;
    }

    it('matches the spec §18.3 rule table across 200 generated combinations', () => {
      for (let i = 0; i < 200; i++) {
        const kind = pick(KINDS);
        const bank = pick(BANKS);
        const hasSession = rand() > 0.5;
        const source = pick(SOURCES);
        const provenanceLength = rand() > 0.5 ? 1 : 0;
        const hasStability = rand() > 0.5;
        const hasSeq = rand() > 0.5;

        const payload: Record<string, unknown> = {
          id: UUID_1,
          bank,
          kind,
          rationale: 'Fuzz-generated rationale text for decision table coverage.',
          tags: ['fuzz', 'coverage'],
          entry_type: 'decision',
          source,
          confidence: 'high',
          timestamp_utc: '2026-01-01T00:00:00.000Z',
          dedupe_key_sha256: 'f'.repeat(64),
          dedupe_key_version: 'v2',
        };
        if (bank === 'kb') {
          payload['repo'] = 'memo-cli';
          payload['org'] = 'llipe';
          payload['domain'] = 'developer-tools';
        }
        if (hasSession) payload['session_id'] = 'ISSUE-53';
        if (provenanceLength > 0) payload['provenance'] = [UUID_2];
        if (hasStability) payload['stability'] = 10;
        if (hasSeq) payload['seq'] = 0;

        const expected = expectedAccept({
          kind,
          bank,
          hasSession,
          source,
          provenanceLength,
          hasStability,
          hasSeq,
        });

        const result = EntryPayloadV2Schema.safeParse(payload);
        if (result.success !== expected) {
          throw new Error(
            `RT-1 mismatch at iteration ${String(i)}: expected accept=${String(expected)}, got ${String(result.success)}. Input: ${JSON.stringify(payload)}`,
          );
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // RT-2: KebabOrUuid / kebab fuzz (evidence-gathering, fixed seed)
  // ---------------------------------------------------------------------------

  describe('RT-2: bank field near-miss fuzz (fixed seed)', () => {
    const NEAR_MISSES = ['UPPERCASE', '1leading-digit', 'double--hyphen', 'trailing-', ''];

    it.each(NEAR_MISSES)('rejects near-miss bank value %p (evidence-only)', (value) => {
      const result = EntryPayloadV2Schema.safeParse(baseSelf({ bank: value }));
      // Recorded as evidence per the test plan (RT-2): a near-miss that unexpectedly
      // parses is not auto-failed, but every value in this fixed set is expected to
      // be rejected by KebabOrUuid (none of them are valid kebab or UUID strings).
      expect(result.success).toBe(false);
    });

    it('accepts a UUID as bank', () => {
      const result = EntryPayloadV2Schema.safeParse(baseSelf({ bank: UUID_2 }));
      expect(result.success).toBe(true);
    });
  });
});
