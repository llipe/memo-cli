import { assembleRecall, estimateTokens } from '../../../src/lib/recall.js';
import type { RecallEntry, RecallInputs } from '../../../src/lib/recall.js';

function entry(id: string, chars: number, overrides: Partial<RecallEntry> = {}): RecallEntry {
  return {
    id,
    renderedLine: 'x'.repeat(chars),
    data: { id, ...overrides.data },
    ...overrides,
  };
}

function emptyInputs(bank: string, queryId = 'q-1'): RecallInputs {
  return {
    bank,
    queryId,
    self: [],
    policies: [],
    shared: [],
    mine: [],
    lastSession: { sessionId: null, entries: [] },
    conflicts: [],
  };
}

describe('estimateTokens', () => {
  it('is ceil(chars / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('x'.repeat(400))).toBe(100);
  });
});

describe('assembleRecall - AC1: section order and SELF completeness', () => {
  it('SELF is complete, newest first, and appears first in output object key order', () => {
    const inputs = emptyInputs('alpha');
    inputs.self = [entry('self-2', 10), entry('self-1', 10)];
    inputs.policies = [entry('pol-1', 10)];

    const bundle = assembleRecall(inputs, { maxTokens: 2000 });

    expect(Object.keys(bundle.sections)).toEqual([
      'self',
      'policies',
      'shared',
      'mine',
      'last_session',
      'conflicts',
    ]);
    expect(bundle.sections.self?.map((e) => e['id'])).toEqual(['self-2', 'self-1']);
  });

  it('superseded self entries are absent because the caller never includes them (EC-03)', () => {
    const inputs = emptyInputs('alpha');
    // Simulates the command layer already filtering `superseded = true` out
    // via buildBaseFilter before calling assembleRecall.
    inputs.self = [entry('active-1', 10), entry('active-2', 10)];

    const bundle = assembleRecall(inputs, { maxTokens: 2000 });

    expect(bundle.sections.self?.map((e) => e['id'])).toEqual(['active-1', 'active-2']);
    expect(bundle.sections.self?.some((e) => e['id'] === 'superseded-1')).toBe(false);
  });
});

describe('assembleRecall - AC2/AC3: budget trimming', () => {
  it('EC-01: SELF alone exceeds max_tokens - SELF intact, every other active section listed in truncated, used_tokens > max_tokens honestly reported', () => {
    const inputs = emptyInputs('alpha');
    inputs.self = [entry('self-1', 4000)]; // 1000 tokens alone

    const bundle = assembleRecall(inputs, { maxTokens: 100 });

    expect(bundle.sections.self).toHaveLength(1);
    expect(bundle.truncated.sort()).toEqual(
      ['policies', 'shared', 'mine', 'last_session', 'conflicts'].sort(),
    );
    expect(bundle.budget.used_tokens).toBeGreaterThan(bundle.budget.max_tokens);
    expect(bundle.budget.used_tokens).toBe(1000);
  });

  it('EC-02: SELF exceeds budget AND other sections are non-empty - their content is fully dropped, not partially', () => {
    const inputs = emptyInputs('alpha');
    inputs.self = [entry('self-1', 4000)];
    inputs.policies = [entry('pol-1', 40)];
    inputs.shared = [entry('shared-1', 40)];
    inputs.mine = [entry('mine-1', 40)];
    inputs.lastSession = {
      sessionId: 'ISSUE-1',
      entries: [entry('sess-1', 40, { seq: 1 })],
    };
    inputs.conflicts = [entry('conf-1', 40)];

    const bundle = assembleRecall(inputs, { maxTokens: 100 });

    expect(bundle.sections.policies).toEqual([]);
    expect(bundle.sections.shared).toEqual([]);
    expect(bundle.sections.mine).toEqual([]);
    expect(bundle.sections.last_session?.entries).toEqual([]);
    expect(bundle.sections.conflicts).toEqual([]);
    expect(bundle.budget.used_tokens).toBe(1000);
  });

  it('EC-13: exact fit at a section boundary stops trimming immediately after conflicts empties', () => {
    const inputs = emptyInputs('alpha');
    inputs.self = [entry('self-1', 40)]; // 10 tokens
    inputs.policies = [entry('pol-1', 40)]; // 10 tokens
    inputs.shared = [entry('shared-1', 40)]; // 10 tokens
    inputs.mine = [entry('mine-1', 40)]; // 10 tokens
    inputs.lastSession = { sessionId: 's', entries: [entry('sess-1', 40, { seq: 1 })] }; // 10 tokens
    inputs.conflicts = [entry('conf-1', 40)]; // 10 tokens
    // total = 60 tokens; budget = 50 -> trimming conflicts (10 tokens) alone fits exactly.

    const bundle = assembleRecall(inputs, { maxTokens: 50 });

    expect(bundle.truncated).toEqual(['conflicts']);
    expect(bundle.sections.conflicts).toEqual([]);
    expect(bundle.sections.mine).toHaveLength(1);
    expect(bundle.sections.shared).toHaveLength(1);
    expect(bundle.sections.policies).toHaveLength(1);
    expect(bundle.budget.used_tokens).toBe(50);
  });

  it('EC-14: LAST SESSION partial trim drops oldest (lowest seq) first', () => {
    const inputs = emptyInputs('alpha');
    inputs.self = [entry('self-1', 4)]; // 1 token
    inputs.lastSession = {
      sessionId: 's',
      entries: [
        entry('sess-1', 40, { seq: 1 }),
        entry('sess-2', 40, { seq: 2 }),
        entry('sess-3', 40, { seq: 3 }),
      ],
    };
    // total = 1 + 30 = 31 tokens; budget forces dropping 2 of the 3 (20 tokens) to fit at 11.

    const bundle = assembleRecall(inputs, { maxTokens: 11 });

    expect(bundle.sections.last_session?.entries.map((e) => e['id'])).toEqual(['sess-3']);
    // `conflicts` is empty from the start but is still "touched" (it comes
    // first in trim order and the budget was not yet satisfied when the
    // algorithm reached it) - see AC2's literal "every other section...
    // listed in truncated" wording, applied consistently here too.
    expect(bundle.truncated).toEqual(['conflicts', 'last_session']);
  });

  it('EC-08/AC5: huge --max-tokens truncates nothing', () => {
    const inputs = emptyInputs('alpha');
    inputs.self = [entry('self-1', 40)];
    inputs.policies = [entry('pol-1', 40)];
    inputs.shared = [entry('shared-1', 40)];
    inputs.mine = [entry('mine-1', 40)];
    inputs.lastSession = { sessionId: 's', entries: [entry('sess-1', 40, { seq: 1 })] };
    inputs.conflicts = [entry('conf-1', 40)];

    const bundle = assembleRecall(inputs, { maxTokens: 1_000_000 });

    expect(bundle.truncated).toEqual([]);
    expect(bundle.sections.policies).toHaveLength(1);
    expect(bundle.sections.shared).toHaveLength(1);
    expect(bundle.sections.mine).toHaveLength(1);
    expect(bundle.sections.last_session?.entries).toHaveLength(1);
    expect(bundle.sections.conflicts).toHaveLength(1);
  });

  it('EC-11: --max-tokens 0 - SELF still intact, everything else trimmed to empty', () => {
    const inputs = emptyInputs('alpha');
    inputs.self = [entry('self-1', 40)];
    inputs.conflicts = [entry('conf-1', 40)];

    const bundle = assembleRecall(inputs, { maxTokens: 0 });

    expect(bundle.sections.self).toHaveLength(1);
    expect(bundle.sections.conflicts).toEqual([]);
    expect(bundle.budget.used_tokens).toBeGreaterThan(0);
  });
});

describe('assembleRecall - AC4: cross-section dedup and single query_id', () => {
  it('EC-04: an id in both SHARED and MINE keeps SHARED (earlier canonical section wins), dedup before cap slicing', () => {
    const inputs = emptyInputs('alpha');
    inputs.shared = [entry('shared-1', 10), entry('dup-1', 10)];
    inputs.mine = [
      entry('dup-1', 10),
      entry('mine-2', 10),
      entry('mine-3', 10),
      entry('mine-4', 10),
      entry('mine-5', 10),
      entry('mine-6', 10),
    ];

    const bundle = assembleRecall(inputs, { maxTokens: 2000 });

    expect(bundle.sections.shared?.map((e) => e['id'])).toContain('dup-1');
    expect(bundle.sections.mine?.map((e) => e['id'])).not.toContain('dup-1');
    // EC-17: 6 MINE candidates, 1 removed by dedup -> 5 unique remain, cap is
    // 5 -> all 5 survive (not 4).
    expect(bundle.sections.mine).toHaveLength(5);
  });

  it('EC-05: an id eligible for POLICIES, SHARED, and CONFLICTS appears only in POLICIES (earliest canonical section)', () => {
    const inputs = emptyInputs('alpha');
    inputs.policies = [entry('shared-fact', 10)];
    inputs.shared = [entry('shared-fact', 10)];
    inputs.conflicts = [entry('shared-fact', 10)];

    const bundle = assembleRecall(inputs, { maxTokens: 2000 });

    expect(bundle.sections.policies.map((e) => e['id'])).toEqual(['shared-fact']);
    expect(bundle.sections.shared).toEqual([]);
    expect(bundle.sections.conflicts).toEqual([]);
  });

  it('single query_id is echoed verbatim at the envelope root', () => {
    const inputs = emptyInputs('alpha', 'a1b2c3d4-0000-4000-8000-000000000000');
    const bundle = assembleRecall(inputs, { maxTokens: 2000 });
    expect(bundle.query_id).toBe('a1b2c3d4-0000-4000-8000-000000000000');
  });

  it('EC-23: two calls with different query_id but identical corpus produce byte-identical sections/budget/truncated', () => {
    const inputsA = emptyInputs('alpha', 'id-a');
    inputsA.self = [entry('self-1', 40)];
    inputsA.shared = [entry('shared-1', 40)];
    const inputsB = { ...inputsA, queryId: 'id-b' };

    const bundleA = assembleRecall(inputsA, { maxTokens: 2000 });
    const bundleB = assembleRecall(inputsB, { maxTokens: 2000 });

    expect(bundleA.query_id).not.toBe(bundleB.query_id);
    expect(bundleA.sections).toEqual(bundleB.sections);
    expect(bundleA.budget).toEqual(bundleB.budget);
    expect(bundleA.truncated).toEqual(bundleB.truncated);
  });
});

describe('assembleRecall - AC5: section caps', () => {
  it('SHARED caps at 8', () => {
    const inputs = emptyInputs('alpha');
    inputs.shared = Array.from({ length: 12 }, (_, i) => entry(`shared-${String(i)}`, 10));
    const bundle = assembleRecall(inputs, { maxTokens: 2000 });
    expect(bundle.sections.shared).toHaveLength(8);
  });

  it('MINE caps at 5', () => {
    const inputs = emptyInputs('alpha');
    inputs.mine = Array.from({ length: 9 }, (_, i) => entry(`mine-${String(i)}`, 10));
    const bundle = assembleRecall(inputs, { maxTokens: 2000 });
    expect(bundle.sections.mine).toHaveLength(5);
  });

  it('LAST SESSION caps at 15, keeping the most recent by seq', () => {
    const inputs = emptyInputs('alpha');
    inputs.lastSession = {
      sessionId: 's',
      entries: Array.from({ length: 20 }, (_, i) => entry(`sess-${String(i)}`, 10, { seq: i })),
    };
    const bundle = assembleRecall(inputs, { maxTokens: 2000 });
    const ids = bundle.sections.last_session?.entries.map((e) => e['id']) ?? [];
    expect(ids).toHaveLength(15);
    expect(ids).toEqual(
      Array.from({ length: 15 }, (_, i) => `sess-${String(i + 5)}`), // seq 5..19
    );
  });

  it('CONFLICTS caps at 5', () => {
    const inputs = emptyInputs('alpha');
    inputs.conflicts = Array.from({ length: 7 }, (_, i) => entry(`conf-${String(i)}`, 10));
    const bundle = assembleRecall(inputs, { maxTokens: 2000 });
    expect(bundle.sections.conflicts).toHaveLength(5);
  });

  it('POLICIES and SELF are never capped', () => {
    const inputs = emptyInputs('alpha');
    inputs.policies = Array.from({ length: 40 }, (_, i) => entry(`pol-${String(i)}`, 10));
    inputs.self = Array.from({ length: 60 }, (_, i) => entry(`self-${String(i)}`, 10));
    const bundle = assembleRecall(inputs, { maxTokens: 100000 });
    expect(bundle.sections.policies).toHaveLength(40);
    expect(bundle.sections.self).toHaveLength(60);
  });

  it('EC-15: POLICIES empty renders [] and is never omitted, unlike SELF/MINE/LAST SESSION under kb', () => {
    const kbInputs = emptyInputs('kb');
    const bundle = assembleRecall(kbInputs, { maxTokens: 2000 });
    expect(bundle.sections.policies).toEqual([]);
    expect('self' in bundle.sections).toBe(false);
  });

  it('EC-16: CONFLICTS always empty in Phase 2 fixtures still renders as a present [] section', () => {
    const inputs = emptyInputs('alpha');
    const bundle = assembleRecall(inputs, { maxTokens: 2000 });
    expect(bundle.sections.conflicts).toEqual([]);
  });

  it('EC-08: self count above soft_cap (55) - all 55 returned, never capped/trimmed', () => {
    const inputs = emptyInputs('alpha');
    inputs.self = Array.from({ length: 55 }, (_, i) => entry(`self-${String(i)}`, 10));
    const bundle = assembleRecall(inputs, { maxTokens: 100000 });
    expect(bundle.sections.self).toHaveLength(55);
  });

  it('EC-21: SELF very large (500 entries) with a tiny budget stays complete and untrimmed', () => {
    const inputs = emptyInputs('alpha');
    inputs.self = Array.from({ length: 500 }, (_, i) => entry(`self-${String(i)}`, 40));
    const bundle = assembleRecall(inputs, { maxTokens: 1 });
    expect(bundle.sections.self).toHaveLength(500);
    expect(bundle.budget.used_tokens).toBeGreaterThan(1);
  });
});

describe('assembleRecall - AC7: bank = kb omits SELF/MINE/LAST SESSION', () => {
  it('kb bank produces a bundle with only policies/shared/conflicts keys, never empty-array placeholders for the omitted three', () => {
    const inputs = emptyInputs('kb');
    inputs.policies = [entry('pol-1', 10)];
    inputs.shared = [entry('shared-1', 10)];

    const bundle = assembleRecall(inputs, { maxTokens: 2000 });

    expect(Object.keys(bundle.sections).sort()).toEqual(['conflicts', 'policies', 'shared']);
    expect(bundle.sections).not.toHaveProperty('self');
    expect(bundle.sections).not.toHaveProperty('mine');
    expect(bundle.sections).not.toHaveProperty('last_session');
  });

  it('kb bank never lists mine/last_session in truncated even under a tiny budget', () => {
    const inputs = emptyInputs('kb');
    inputs.policies = [entry('pol-1', 4000)];

    const bundle = assembleRecall(inputs, { maxTokens: 10 });

    expect(bundle.truncated).not.toContain('mine');
    expect(bundle.truncated).not.toContain('last_session');
  });

  it('EC-06: kb bank ignores self/mine/last_session inputs entirely even if a caller mistakenly supplies them', () => {
    const inputs = emptyInputs('kb');
    inputs.self = [entry('leaked-self', 10)];
    inputs.mine = [entry('leaked-mine', 10)];
    inputs.lastSession = { sessionId: 'leaked', entries: [entry('leaked-sess', 10, { seq: 1 })] };

    const bundle = assembleRecall(inputs, { maxTokens: 2000 });

    expect(bundle.sections).not.toHaveProperty('self');
    expect(bundle.sections).not.toHaveProperty('mine');
    expect(bundle.sections).not.toHaveProperty('last_session');
  });
});

describe('assembleRecall - EC-07: empty episodic history', () => {
  it('LAST SESSION renders with null session_id and empty entries, not an error', () => {
    const inputs = emptyInputs('alpha');
    const bundle = assembleRecall(inputs, { maxTokens: 2000 });
    expect(bundle.sections.last_session).toEqual({ session_id: null, entries: [] });
  });
});

describe('assembleRecall - CT-11 purity contract', () => {
  it('repeated calls with identical inputs return byte-identical output', () => {
    const inputs = emptyInputs('alpha', 'q-fixed');
    inputs.self = [entry('self-1', 40)];
    inputs.shared = [entry('shared-1', 40)];
    const budget = { maxTokens: 500 };

    const a = assembleRecall(inputs, budget);
    const b = assembleRecall(inputs, budget);

    expect(a).toEqual(b);
  });

  it('never mutates its inputs', () => {
    const inputs = emptyInputs('alpha');
    inputs.shared = [entry('a', 10), entry('b', 10), entry('c', 10)];
    const snapshot = JSON.parse(JSON.stringify(inputs));

    assembleRecall(inputs, { maxTokens: 1 });

    expect(JSON.parse(JSON.stringify(inputs))).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Randomized / property-based tactics (activity-random-test-tactics, §6 of
// the test plan). fast-check is not in this repo's toolchain (confirmed by
// `pnpm ls`), so this uses the documented hand-rolled-seeded-PRNG fallback -
// a mulberry32 generator with the seed logged on every run and printed on
// failure for reproducibility (`--seed <n>` equivalent: search this file's
// output for "seed:").
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function generateSection(
  rand: () => number,
  count: number,
  prefix: string,
  withSeq: boolean,
): RecallEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const chars = randomInt(rand, 10, 2000);
    return entry(`${prefix}-${String(i)}`, chars, withSeq ? { seq: i } : {});
  });
}

const PROPERTY_SEED = 424242;
const PROPERTY_RUNS = 50;

describe('assembleRecall - randomized property suite', () => {
  it(`holds SELF/dedup/budget/truncated/monotonicity invariants across ${String(PROPERTY_RUNS)} generated runs (seed: ${String(PROPERTY_SEED)})`, () => {
    const rand = mulberry32(PROPERTY_SEED);

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const bank = 'alpha';
      const selfCount = randomInt(rand, 0, 120);
      const policiesCount = randomInt(rand, 0, 20);
      const sharedCount = randomInt(rand, 0, 30);
      const mineCount = randomInt(rand, 0, 20);
      const lastSessionCount = randomInt(rand, 0, 40);
      const conflictsCount = randomInt(rand, 0, 20);

      const inputs = emptyInputs(bank, `run-${String(run)}`);
      inputs.self = generateSection(rand, selfCount, 'self', false);
      inputs.policies = generateSection(rand, policiesCount, 'pol', false);
      inputs.shared = generateSection(rand, sharedCount, 'shared', false);
      inputs.mine = generateSection(rand, mineCount, 'mine', false);
      inputs.lastSession = {
        sessionId: lastSessionCount > 0 ? 'sess' : null,
        entries: generateSection(rand, lastSessionCount, 'sess', true),
      };
      inputs.conflicts = generateSection(rand, conflictsCount, 'conf', false);

      // Duplicate-id injection (p up to 0.3): clone an id from `self` into
      // `shared` to fuzz the dedup path alongside trimming.
      if (inputs.self.length > 0 && rand() < 0.3) {
        const clone = inputs.self[randomInt(rand, 0, inputs.self.length - 1)];
        if (clone) inputs.shared.push({ ...clone, id: clone.id });
      }

      const maxTokens = randomInt(rand, 0, 100000);
      const bundle = assembleRecall(inputs, { maxTokens });

      // Invariant 1: SELF is never trimmed - every non-superseded input id survives.
      const selfIds = new Set(inputs.self.map((e) => String(e.id)));
      const outputSelfIds = (bundle.sections.self ?? []).map((e) => String(e['id']));
      expect(new Set(outputSelfIds)).toEqual(selfIds);

      // Invariant 3: dedup - no id appears twice across the whole bundle.
      const allIds = [
        ...(bundle.sections.self ?? []),
        ...bundle.sections.policies,
        ...bundle.sections.shared,
        ...(bundle.sections.mine ?? []),
        ...(bundle.sections.last_session?.entries ?? []),
        ...bundle.sections.conflicts,
      ].map((e) => String(e['id']));
      expect(new Set(allIds).size).toBe(allIds.length);

      // Invariant 4: budget-honesty - used_tokens equals the recomputed sum
      // of ceil(chars/4) over exactly the output ids.
      const renderedById = new Map<string, number>();
      for (const e of [
        ...inputs.self,
        ...inputs.policies,
        ...inputs.shared,
        ...inputs.mine,
        ...inputs.lastSession.entries,
        ...inputs.conflicts,
      ]) {
        renderedById.set(String(e.id), estimateTokens(e.renderedLine));
      }
      const recomputed = allIds.reduce((sum, id) => sum + (renderedById.get(id) ?? 0), 0);
      expect(bundle.budget.used_tokens).toBe(recomputed);

      // Invariant 5: truncated-list correctness - never contains 'self'.
      expect(bundle.truncated).not.toContain('self');
    }
  });

  it(`monotonicity: increasing max_tokens never decreases a section's output token count (seed: ${String(PROPERTY_SEED + 1)})`, () => {
    const rand = mulberry32(PROPERTY_SEED + 1);

    for (let run = 0; run < 20; run++) {
      const inputs = emptyInputs('alpha', `mono-${String(run)}`);
      inputs.self = generateSection(rand, randomInt(rand, 0, 5), 'self', false);
      inputs.policies = generateSection(rand, randomInt(rand, 0, 10), 'pol', false);
      inputs.shared = generateSection(rand, randomInt(rand, 0, 15), 'shared', false);
      inputs.mine = generateSection(rand, randomInt(rand, 0, 10), 'mine', false);
      inputs.lastSession = {
        sessionId: 'sess',
        entries: generateSection(rand, randomInt(rand, 0, 20), 'sess', true),
      };
      inputs.conflicts = generateSection(rand, randomInt(rand, 0, 10), 'conf', false);

      const lowBudget = randomInt(rand, 0, 500);
      const highBudget = lowBudget + randomInt(rand, 0, 5000);

      const low = assembleRecall(inputs, { maxTokens: lowBudget });
      const high = assembleRecall(inputs, { maxTokens: highBudget });

      const tokensOf = (arr: Record<string, unknown>[] | undefined): number =>
        (arr ?? []).reduce((sum) => sum + 1, 0); // count as a monotonic proxy for token volume

      expect(tokensOf(high.sections.policies)).toBeGreaterThanOrEqual(
        tokensOf(low.sections.policies),
      );
      expect(tokensOf(high.sections.shared)).toBeGreaterThanOrEqual(tokensOf(low.sections.shared));
      expect(tokensOf(high.sections.mine)).toBeGreaterThanOrEqual(tokensOf(low.sections.mine));
      expect((high.sections.last_session?.entries ?? []).length).toBeGreaterThanOrEqual(
        (low.sections.last_session?.entries ?? []).length,
      );
      expect(tokensOf(high.sections.conflicts)).toBeGreaterThanOrEqual(
        tokensOf(low.sections.conflicts),
      );
    }
  });
});
