import {
  DEFAULT_MIGRATION_RULES,
  parseMigrationRules,
  planMigration,
  validateRulesExhaustive,
} from '../../../src/lib/migrate.js';
import type { MigratablePoint, MigrationRule } from '../../../src/lib/migrate.js';
import { MemoError } from '../../../src/lib/errors.js';
import { MemoConfigSchema } from '../../../src/types/config.js';
import type { MemoConfig } from '../../../src/types/config.js';

const NOW = '2026-09-22T00:00:00.000Z';

function config(overrides: Partial<MemoConfig> = {}): MemoConfig {
  return MemoConfigSchema.parse({
    schema_version: '2',
    repo: 'memo-cli',
    org: 'llipe',
    domain: 'backend',
    ...overrides,
  });
}

function point(id: string, payload: Record<string, unknown>): MigratablePoint {
  return { id, payload };
}

describe('planMigration (AC1, spec §5.5/§18.11)', () => {
  const cfg = config();

  it('rule 1: tags contain "intent" -> kind=episodic, session_id=story, expires_at=timestamp+90d', () => {
    const points = [
      point('a', {
        tags: ['intent', 'x'],
        story: 'ISSUE-42',
        timestamp_utc: '2026-01-01T00:00:00.000Z',
        entry_type: 'decision',
        source: 'agent',
      }),
    ];
    const plan = planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg);

    expect(plan.skipped).toBe(0);
    expect(plan.byRule).toEqual({ '1': 1 });
    expect(plan.ops).toHaveLength(1);
    const op = plan.ops[0]!;
    expect(op.id).toBe('a');
    expect(op.payload).toMatchObject({
      bank: 'kb',
      schema_version: '2',
      kind: 'episodic',
      session_id: 'ISSUE-42',
      consolidated: false,
      archived: false,
      superseded: false,
      pinned: false,
      retrieval_count: 0,
      used_count: 0,
      stability_since: NOW,
      stability: 3, // banks.kb.episodic.initial_stability_days default
      expires_at: '2026-04-01T00:00:00.000Z', // + 90d
    });
    expect(op.payload['dedupe_key_version']).toBeUndefined();
    expect(op.payload['valid_from']).toBeUndefined();
  });

  it('rule 1: tags contain "outcome" also matches rule 1', () => {
    const points = [point('a', { tags: ['outcome'], timestamp_utc: NOW })];
    const plan = planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg);
    expect(plan.byRule).toEqual({ '1': 1 });
    expect(plan.ops[0]?.payload['kind']).toBe('episodic');
  });

  it('rule 2 (catch-all): any other point -> kind=semantic, valid_from=timestamp_utc', () => {
    const points = [
      point('b', {
        tags: ['decision', 'foo'],
        timestamp_utc: '2026-02-01T00:00:00.000Z',
        entry_type: 'decision',
        source: 'manual',
      }),
    ];
    const plan = planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg);

    expect(plan.byRule).toEqual({ '2': 1 });
    const op = plan.ops[0]!;
    expect(op.payload).toMatchObject({
      bank: 'kb',
      schema_version: '2',
      kind: 'semantic',
      valid_from: '2026-02-01T00:00:00.000Z',
      stability: 90, // banks.kb.semantic.initial_stability_days default
      stability_since: NOW,
    });
    expect(op.payload['session_id']).toBeUndefined();
    expect(op.payload['expires_at']).toBeUndefined();
  });

  it('AC1: a point with schema_version="2" is skipped, not counted in any rule', () => {
    const points = [
      point('already-v2', { schema_version: '2', tags: ['intent'] }),
      point('needs-migration', { tags: ['decision'] }),
    ];
    const plan = planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg);
    expect(plan.skipped).toBe(1);
    expect(plan.ops.map((o) => o.id)).toEqual(['needs-migration']);
  });

  it('EC-1: a point with both "intent" and "outcome" tags matches rule 1 exactly once', () => {
    const points = [point('a', { tags: ['intent', 'outcome'] })];
    const plan = planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg);
    expect(plan.byRule).toEqual({ '1': 1 });
    expect(plan.ops).toHaveLength(1);
  });

  it.each([
    ['absent', {}],
    ['empty string', { story: '' }],
    ['null', { story: null }],
    ['whitespace-only', { story: '   ' }],
  ])('EC-2: intent-tagged point with story %s resolves session_id to "legacy"', (_label, extra) => {
    const points = [point('a', { tags: ['intent'], ...extra })];
    const plan = planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg);
    expect(plan.ops[0]?.payload['session_id']).toBe('legacy');
  });

  it('EC-3: point already has bank="kb" but no schema_version — migrated, bank preserved (not counted in skipped)', () => {
    const points = [point('a', { bank: 'kb', tags: ['decision'] })];
    const plan = planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg);
    expect(plan.skipped).toBe(0);
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]?.payload['bank']).toBe('kb');
  });

  it('EC-3 (out-of-domain probe, undetermined per F-4): a pre-existing bank other than "kb" is preserved verbatim', () => {
    const points = [point('a', { bank: 'some-other-bank', tags: ['decision'] })];
    const plan = planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg);
    expect(plan.ops[0]?.payload['bank']).toBe('some-other-bank');
  });

  it('EC-4: empty collection — zero points in, zero ops/skipped out, empty by_rule', () => {
    const plan = planMigration([], NOW, DEFAULT_MIGRATION_RULES, cfg);
    expect(plan).toEqual({ ops: [], byRule: {}, skipped: 0 });
  });

  it('EC-11: sum(by_rule) + skipped === scanned across a mixed fixture', () => {
    const points = [
      point('1', { tags: ['intent'] }),
      point('2', { tags: ['outcome'] }),
      point('3', { tags: ['decision'] }),
      point('4', { schema_version: '2' }),
      point('5', {}),
    ];
    const plan = planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg);
    const sumByRule = Object.values(plan.byRule).reduce((a, b) => a + b, 0);
    expect(sumByRule + plan.skipped).toBe(points.length);
  });

  it('dedupe_key_version is never included in the returned payload (left unchanged via Qdrant merge semantics)', () => {
    const points = [point('a', { tags: ['decision'], dedupe_key_version: 'v1' })];
    const plan = planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg);
    expect('dedupe_key_version' in plan.ops[0]!.payload).toBe(false);
  });

  describe('custom --rules file (AC4)', () => {
    const customRules: MigrationRule[] = [
      { name: 'a', when: { tags_any: ['a', 'b'] }, set: { kind: 'semantic' } },
      { name: 'b', when: { tags_all: ['x', 'y'] }, set: { kind: 'semantic' } },
      { name: 'c', when: { entry_type_in: ['decision'] }, set: { kind: 'semantic' } },
      { name: 'd', when: { source_in: ['manual'] }, set: { kind: 'semantic' } },
      { name: 'e', when: { repo_in: ['memo-cli'] }, set: { kind: 'semantic' } },
      {
        name: 'f',
        when: {},
        set: { kind: 'episodic', session_from: 'legacy', expires_in_days: 30 },
      },
    ];

    it('CT-1: tags_any — union match, not intersection', () => {
      expect(planMigration([point('p', { tags: ['a'] })], NOW, customRules, cfg).byRule).toEqual({
        a: 1,
      });
      expect(planMigration([point('p', { tags: ['b'] })], NOW, customRules, cfg).byRule).toEqual({
        a: 1,
      });
      expect(planMigration([point('p', { tags: ['c'] })], NOW, customRules, cfg).byRule).toEqual({
        f: 1,
      });
    });

    it('CT-2: tags_all — intersection match; a single listed tag alone does not match', () => {
      expect(
        planMigration([point('p', { tags: ['x', 'y'] })], NOW, customRules, cfg).byRule,
      ).toEqual({ b: 1 });
      expect(
        planMigration([point('p', { tags: ['x', 'y', 'z'] })], NOW, customRules, cfg).byRule,
      ).toEqual({ b: 1 });
      expect(planMigration([point('p', { tags: ['x'] })], NOW, customRules, cfg).byRule).toEqual({
        f: 1,
      });
    });

    it('CT-3: entry_type_in / source_in / repo_in — independent, no cross-field leakage', () => {
      expect(
        planMigration([point('p', { entry_type: 'decision' })], NOW, customRules, cfg).byRule,
      ).toEqual({ c: 1 });
      expect(
        planMigration([point('p', { source: 'manual' })], NOW, customRules, cfg).byRule,
      ).toEqual({ d: 1 });
      expect(
        planMigration([point('p', { repo: 'memo-cli' })], NOW, customRules, cfg).byRule,
      ).toEqual({ e: 1 });
      // a point matching only "source" must not accidentally match the entry_type_in rule
      expect(
        planMigration(
          [point('p', { source: 'manual', entry_type: 'structure' })],
          NOW,
          customRules,
          cfg,
        ).byRule,
      ).toEqual({ d: 1 });
    });

    it('CT-3 (combined operators): a rule combining two operators matches only the intersection', () => {
      const combinedRules: MigrationRule[] = [
        {
          name: 'combo',
          when: { entry_type_in: ['decision'], source_in: ['manual'] },
          set: { kind: 'semantic' },
        },
        { name: 'catch', when: {}, set: { kind: 'semantic' } },
      ];
      expect(
        planMigration(
          [point('p', { entry_type: 'decision', source: 'manual' })],
          NOW,
          combinedRules,
          cfg,
        ).byRule,
      ).toEqual({ combo: 1 });
      expect(
        planMigration(
          [point('p', { entry_type: 'decision', source: 'agent' })],
          NOW,
          combinedRules,
          cfg,
        ).byRule,
      ).toEqual({ catch: 1 });
    });

    it('§18.14 item 14: a custom rule (including the catch-all) may set kind="episodic"', () => {
      const plan = planMigration([point('p', { tags: [] })], NOW, customRules, cfg);
      expect(plan.byRule).toEqual({ f: 1 });
      expect(plan.ops[0]?.payload).toMatchObject({
        kind: 'episodic',
        session_id: 'legacy',
      });
      expect(plan.ops[0]?.payload['expires_at']).toBeDefined();
    });

    it('SC-4: by_rule uses the custom rule names, not the default numbering semantics', () => {
      const plan = planMigration(
        [point('1', { tags: ['a'] }), point('2', { source: 'manual' }), point('3', {})],
        NOW,
        customRules,
        cfg,
      );
      expect(Object.keys(plan.byRule).sort()).toEqual(['a', 'd', 'f']);
    });
  });
});

describe('parseMigrationRules / validateRulesExhaustive (AC4)', () => {
  it('accepts the default rules shape (already exhaustive)', () => {
    expect(() => validateRulesExhaustive(DEFAULT_MIGRATION_RULES)).not.toThrow();
  });

  it('CT-5: rejects a rule set with no catch-all rule (VALIDATION_FAILED, before any scan)', () => {
    const nonExhaustive = [
      { name: '1', when: { tags_any: ['intent'] }, set: { kind: 'episodic' as const } },
      { name: '2', when: { tags_any: ['outcome'] }, set: { kind: 'episodic' as const } },
    ];
    expect(() => validateRulesExhaustive(nonExhaustive)).toThrow(MemoError);
    try {
      validateRulesExhaustive(nonExhaustive);
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MemoError);
      expect((err as MemoError).code).toBe('VALIDATION_FAILED');
      expect((err as MemoError).message).toMatch(/not exhaustive/);
    }
  });

  it('CT-4a: set.kind is required — a rule with set={} fails schema validation', () => {
    const raw = [{ name: '1', when: {}, set: {} }];
    expect(() => parseMigrationRules(raw)).toThrow(MemoError);
  });

  it('CT-4b: session_from/expires_in_days on a non-episodic set are rejected (this implementation: reject)', () => {
    const raw = [{ name: '1', when: {}, set: { kind: 'semantic', session_from: 'story' } }];
    expect(() => parseMigrationRules(raw)).toThrow(MemoError);

    const raw2 = [{ name: '1', when: {}, set: { kind: 'semantic', expires_in_days: 30 } }];
    expect(() => parseMigrationRules(raw2)).toThrow(MemoError);
  });

  it('CT-4c: a valid episodic rule with session_from/expires_in_days is accepted', () => {
    const raw = [
      {
        name: '1',
        when: {},
        set: { kind: 'episodic', session_from: 'story', expires_in_days: 30 },
      },
    ];
    expect(() => parseMigrationRules(raw)).not.toThrow();
  });

  it('EC-10: a non-array rules file (JSON object) fails VALIDATION_FAILED', () => {
    expect(() => parseMigrationRules({ name: '1', when: {}, set: { kind: 'semantic' } })).toThrow(
      MemoError,
    );
  });

  it('EC-12: an unrecognized key inside a rule/when/set is rejected (strict schema), not silently misinterpreted', () => {
    const raw = [{ name: '1', when: {}, set: { kind: 'semantic' }, note: 'internal comment' }];
    expect(() => parseMigrationRules(raw)).toThrow(MemoError);
  });

  it('CT-1..CT-3 full rule shape round-trips through parseMigrationRules', () => {
    const raw = [
      {
        name: '1',
        when: { tags_any: ['intent', 'outcome'] },
        set: { kind: 'episodic', session_from: 'story', expires_in_days: 90 },
      },
      { name: '2', when: {}, set: { kind: 'semantic' } },
    ];
    expect(parseMigrationRules(raw)).toEqual(raw);
  });
});

describe('RT-1/RT-2: property — every point lands in exactly one rule bucket', () => {
  const cfg = config();
  const ALL_TAGS = ['intent', 'outcome', 'decision', 'structure', 'note'];

  function randomPoint(id: number, seed: number): MigratablePoint {
    const tagCount = seed % (ALL_TAGS.length + 1);
    const tags = ALL_TAGS.slice(0, tagCount);
    const hasStory = seed % 2 === 0;
    const alreadyV2 = seed % 17 === 0;
    return point(`p-${String(id)}`, {
      tags,
      entry_type: seed % 3 === 0 ? 'decision' : 'structure',
      source: seed % 2 === 0 ? 'agent' : 'manual',
      ...(hasStory ? { story: `ISSUE-${String(seed)}` } : {}),
      ...(alreadyV2 ? { schema_version: '2' } : {}),
    });
  }

  it('RT-1: default rules — 1000 randomized points, sum(by_rule) + skipped === total', () => {
    const points = Array.from({ length: 1000 }, (_, i) => randomPoint(i, i * 2654435761 + 7));
    const plan = planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg);
    const sum = Object.values(plan.byRule).reduce((a, b) => a + b, 0);
    expect(sum + plan.skipped).toBe(points.length);
    // every non-skipped point is attributed to exactly one rule bucket.
    expect(plan.ops).toHaveLength(sum);
  });

  it('RT-2: custom 4-rule set (all five operators) — 800 randomized points, exactly-one-rule holds', () => {
    const customRules: MigrationRule[] = [
      { name: 'r1', when: { tags_any: ['intent'] }, set: { kind: 'episodic' } },
      { name: 'r2', when: { tags_all: ['decision', 'structure'] }, set: { kind: 'semantic' } },
      {
        name: 'r3',
        when: { entry_type_in: ['decision'], source_in: ['agent'] },
        set: { kind: 'semantic' },
      },
      { name: 'r4', when: {}, set: { kind: 'semantic' } },
    ];
    const points = Array.from({ length: 800 }, (_, i) => randomPoint(i, i * 2246822519 + 11));
    const plan = planMigration(points, NOW, customRules, cfg);
    const sum = Object.values(plan.byRule).reduce((a, b) => a + b, 0);
    expect(sum + plan.skipped).toBe(points.length);
    expect(plan.ops).toHaveLength(sum);
  });
});

describe('RT-3: fuzz — malformed points never throw an unhandled exception', () => {
  const cfg = config();

  const malformedPayloads: Record<string, unknown>[] = [
    { tags: 'not-an-array' },
    { tags: null },
    { tags: undefined },
    { story: 12345 },
    { story: {} },
    { timestamp_utc: 'not-a-date' },
    { timestamp_utc: 12345 },
    { entry_type: 42 },
    { source: null },
    { repo: ['nested', 'array'] },
    { deeply: { nested: { unexpected: ['shape', 1, null] } } },
    {},
  ];

  it.each(malformedPayloads.map((p, i) => [i, p] as const))(
    'fuzz case %i never throws',
    (_i, payload) => {
      const points: MigratablePoint[] = [
        { id: 'x', payload },
        // missing id entirely
        { payload } as unknown as MigratablePoint,
      ];
      expect(() => planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg)).not.toThrow();
    },
  );

  it('fuzz: a point with an undefined payload never throws', () => {
    const points: MigratablePoint[] = [{ id: 'x', payload: undefined }];
    expect(() => planMigration(points, NOW, DEFAULT_MIGRATION_RULES, cfg)).not.toThrow();
  });
});
