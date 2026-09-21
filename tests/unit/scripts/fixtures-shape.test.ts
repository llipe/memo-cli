import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EvalEntrySeedSchema,
  EvalQuerySchema,
  parseFixtureArray,
  validateNoDanglingExpectedIds,
} from '../../../scripts/eval-relevance';

const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'relevance');

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8')) as unknown;
}

describe('entries.json fixture-shape contract (SC-1, AC1)', () => {
  const rawEntries = readJson('entries.json');
  const entries = parseFixtureArray(rawEntries, EvalEntrySeedSchema, 'entries.json');

  it('holds at least 40 entries', () => {
    expect(entries.length).toBeGreaterThanOrEqual(40);
  });

  it('has stable UUIDs with no duplicates', () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers at least two distinct repos', () => {
    const repos = new Set(entries.map((e) => e.repo));
    expect(repos.size).toBeGreaterThanOrEqual(2);
  });

  it('spans all three source values (agent, manual, scan)', () => {
    const sources = new Set(entries.map((e) => e.source));
    expect(sources).toEqual(new Set(['agent', 'manual', 'scan']));
  });

  it('covers all three entry_type values', () => {
    const types = new Set(entries.map((e) => e.entry_type));
    expect(types).toEqual(new Set(['decision', 'integration_point', 'structure']));
  });

  it('has at least one entry naming a specific file in files_modified', () => {
    expect(entries.some((e) => (e.files_modified?.length ?? 0) > 0)).toBe(true);
  });

  it('has at least one intent/outcome-style entry (rationale mentions Intent or Outcome)', () => {
    expect(entries.some((e) => /\b(intent|outcome)\b/i.test(e.rationale))).toBe(true);
  });
});

describe('queries.json fixture-shape contract (SC-2, AC2)', () => {
  const rawEntries = readJson('entries.json');
  const entries = parseFixtureArray(rawEntries, EvalEntrySeedSchema, 'entries.json');
  const rawQueries = readJson('queries.json');
  const queries = parseFixtureArray(rawQueries, EvalQuerySchema, 'queries.json');

  it('holds between 20 and 30 queries', () => {
    expect(queries.length).toBeGreaterThanOrEqual(20);
    expect(queries.length).toBeLessThanOrEqual(30);
  });

  it('restricts categories to concept, identifier, cross-repo, recency', () => {
    const categories = new Set(queries.map((q) => q.category));
    for (const category of categories) {
      expect(['concept', 'identifier', 'cross-repo', 'recency']).toContain(category);
    }
  });

  it('has at least 6 identifier queries', () => {
    const identifierQueries = queries.filter((q) => q.category === 'identifier');
    expect(identifierQueries.length).toBeGreaterThanOrEqual(6);
  });

  it('every identifier query names a file, flag, or issue reference in its query text', () => {
    const identifierQueries = queries.filter((q) => q.category === 'identifier');
    const nameLike = /(\.\w+|--[a-z-]+|#\d+|[A-Z]+-\d+)/;
    for (const q of identifierQueries) {
      expect(q.query).toMatch(nameLike);
    }
  });

  it('has zero dangling expected_ids references (every id resolves in entries.json)', () => {
    expect(() => validateNoDanglingExpectedIds(entries, queries)).not.toThrow();
  });
});
