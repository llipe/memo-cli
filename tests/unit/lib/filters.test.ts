import { buildBaseFilter } from '../../../src/lib/filters.js';

interface FilterShape {
  must?: Record<string, unknown>[];
  must_not?: Record<string, unknown>[];
  should?: Record<string, unknown>[];
}

function shape(filter: unknown): FilterShape {
  return filter as FilterShape;
}

describe('buildBaseFilter (AC4, spec §8.1/§18.5)', () => {
  it('CT-1: kb + kind=all — should nested only inside the bank clause, default exclusions applied', () => {
    const filter = buildBaseFilter({ bank: 'kb', kind: 'all' });

    expect(filter).toEqual({
      must: [{ should: [{ key: 'bank', match: { value: 'kb' } }, { is_empty: { key: 'bank' } }] }],
      must_not: [
        { key: 'kind', match: { value: 'self' } },
        { key: 'archived', match: { value: true } },
        { key: 'superseded', match: { value: true } },
      ],
    });
  });

  it('CT-2: private bank — exact bank match, no should/is_empty', () => {
    const filter = shape(buildBaseFilter({ bank: 'jarvis-memory', kind: 'all' }));

    expect(filter.must).toContainEqual({ key: 'bank', match: { value: 'jarvis-memory' } });
    expect(JSON.stringify(filter)).not.toContain('should');
    expect(JSON.stringify(filter)).not.toContain('is_empty');
  });

  it('EC-23: a specific kind adds a must kind clause plus default exclusions', () => {
    const filter = shape(buildBaseFilter({ bank: 'jarvis-memory', kind: 'self' }));

    expect(filter.must).toContainEqual({ key: 'kind', match: { value: 'self' } });
    expect(filter.must_not).toContainEqual({ key: 'archived', match: { value: true } });
    expect(filter.must_not).toContainEqual({ key: 'superseded', match: { value: true } });
  });

  it('EC-24: kind=self with includeSuperseded=true lifts only the superseded exclusion', () => {
    const filter = shape(
      buildBaseFilter({
        bank: 'jarvis-memory',
        kind: 'self',
        includeSuperseded: true,
      }),
    );

    expect(filter.must_not).toContainEqual({ key: 'archived', match: { value: true } });
    expect(filter.must_not).not.toContainEqual({ key: 'superseded', match: { value: true } });
  });

  it('EC-25: includeArchived=true lifts only the archived exclusion', () => {
    const filter = shape(buildBaseFilter({ bank: 'kb', kind: 'all', includeArchived: true }));

    expect(filter.must_not).not.toContainEqual({ key: 'archived', match: { value: true } });
    expect(filter.must_not).toContainEqual({ key: 'superseded', match: { value: true } });
  });

  it('EC-26: includeSuperseded=true lifts only the superseded exclusion', () => {
    const filter = shape(buildBaseFilter({ bank: 'kb', kind: 'all', includeSuperseded: true }));

    expect(filter.must_not).toContainEqual({ key: 'archived', match: { value: true } });
    expect(filter.must_not).not.toContainEqual({ key: 'superseded', match: { value: true } });
  });

  it('EC-27: includeArchived=true and includeSuperseded=true lift both exclusions', () => {
    const filter = shape(
      buildBaseFilter({
        bank: 'kb',
        kind: 'all',
        includeArchived: true,
        includeSuperseded: true,
      }),
    );

    expect(filter.must_not ?? []).not.toContainEqual({ key: 'archived', match: { value: true } });
    expect(filter.must_not ?? []).not.toContainEqual({
      key: 'superseded',
      match: { value: true },
    });
  });

  it('EC-28: session adds a must session_id clause additively', () => {
    const filter = shape(buildBaseFilter({ bank: 'kb', kind: 'all', session: 'sess-1' }));

    expect(filter.must).toContainEqual({ key: 'session_id', match: { value: 'sess-1' } });
    expect(filter.must).toContainEqual({
      should: [{ key: 'bank', match: { value: 'kb' } }, { is_empty: { key: 'bank' } }],
    });
  });

  it('EC-29/EC-30/EC-31: asOf adds valid_from lte and a valid_to should (is_empty or gt)', () => {
    const filter = shape(
      buildBaseFilter({ bank: 'kb', kind: 'all', asOf: '2026-06-01T00:00:00.000Z' }),
    );

    expect(filter.must).toContainEqual({
      key: 'valid_from',
      range: { lte: '2026-06-01T00:00:00.000Z' },
    });
    expect(filter.should).toContainEqual({ is_empty: { key: 'valid_to' } });
    expect(filter.should).toContainEqual({
      key: 'valid_to',
      range: { gt: '2026-06-01T00:00:00.000Z' },
    });
  });

  it('EC-32: asOf without explicit includeSuperseded implies includeSuperseded=true', () => {
    const filter = shape(
      buildBaseFilter({ bank: 'kb', kind: 'all', asOf: '2026-06-01T00:00:00.000Z' }),
    );

    expect(filter.must_not ?? []).not.toContainEqual({
      key: 'superseded',
      match: { value: true },
    });
    expect(filter.must_not).toContainEqual({ key: 'archived', match: { value: true } });
  });

  it('EC-33: asOf implication wins even when includeSuperseded=false is explicitly passed', () => {
    const filter = shape(
      buildBaseFilter({
        bank: 'kb',
        kind: 'all',
        asOf: '2026-06-01T00:00:00.000Z',
        includeSuperseded: false,
      }),
    );

    expect(filter.must_not ?? []).not.toContainEqual({
      key: 'superseded',
      match: { value: true },
    });
  });

  it('EC-34: no optional inputs leaves no dangling session_id/valid_from/valid_to/empty arrays', () => {
    const filter = shape(buildBaseFilter({ bank: 'kb', kind: 'all' }));

    expect(filter.should).toBeUndefined();
    const mustKeys = (filter.must ?? []).flatMap((clause) => Object.keys(clause));
    expect(mustKeys).not.toContain('session_id');
  });

  it('EC-35: a v1 legacy point (no bank/kind) is documented to pass the kb is_empty branch', () => {
    const filter = shape(buildBaseFilter({ bank: 'kb', kind: 'all' }));
    const bankClause = (filter.must ?? []).find(
      (clause): clause is { should: unknown[] } => 'should' in clause,
    );
    expect(bankClause?.should).toContainEqual({ is_empty: { key: 'bank' } });
  });
});
