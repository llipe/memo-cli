/**
 * Relevance evaluation harness (Story S1-01, issue #61).
 *
 * Modes (selected by CLI flags, combinable):
 *   (default)   Run every query in `tests/fixtures/relevance/queries.json` against a live
 *               Qdrant + embeddings provider, print per-category and overall top-3 hit
 *               rate, and always exit 0 (it reports, it does not gate).
 *   --seed      Upsert `tests/fixtures/relevance/entries.json` into the evaluation
 *               collection (`MEMO_COLLECTION`, no default fallback — see the guard below).
 *               Idempotent: re-running upserts by fixed id (Qdrant's own upsert-overwrite
 *               semantics), so edited fixture content on a second `--seed` run overwrites
 *               the existing point rather than being skipped or erroring (F-1 resolution).
 *   --record    Run every query (as in the default mode) and additionally write
 *               `candidates.json` and `baseline.json`.
 *
 * `--seed` and `--record` may be combined with each other or with the default run.
 *
 * MEMO_COLLECTION contract (AC7, task 1.10):
 *   `--seed` REFUSES to run (exit 1) when `MEMO_COLLECTION` is unset or empty/whitespace —
 *   this is a firm gate, because seeding is the one mode that writes points, and an unset
 *   value must never silently seed fixtures into the production `decisions` collection.
 *   Plain `run` and `--record` do NOT refuse when `MEMO_COLLECTION` is unset: they issue no
 *   Qdrant writes (candidates/baseline are local files, not points), so falling back to the
 *   documented default `decisions` collection for a read-only query still satisfies AC7's
 *   "never writes fixtures into decisions" clause. This is the resolution recorded for F-3 —
 *   see the PR body for the full rationale.
 *
 * Connectivity failures (Qdrant unreachable, embeddings provider unreachable/misconfigured)
 * exit 2 with a `QDRANT_UNREACHABLE`-coded message; this is a deliberate exception to the
 * "run mode always exits 0" rule, which is scoped to *scoring outcomes*, not infrastructure
 * failures.
 *
 * Invocation note (`package.json`'s `eval:relevance` script):
 *   This script runs under `node --loader ts-node/esm`, which type-checks by default. That
 *   default-checking path does NOT apply `tsconfig.json`'s `esModuleInterop: true` the same
 *   way `tsc`/the compiled `dist/` bin entry does, so importing `openai`'s CJS default export
 *   (`src/adapters/openai-embeddings.ts`) raises spurious `TS2709`/`TS2351`/`TS18046`
 *   diagnostics and ts-node/esm treats them as fatal, aborting before any code runs — this is
 *   independent of credentials or network reachability. The runtime interop is fine (Node's
 *   own CJS/ESM interop resolves the `openai` default export correctly); only ts-node/esm's
 *   type-checking phase mis-evaluates it. `pnpm run typecheck` (`tsc --noEmit` against
 *   `tsconfig.json`) already covers `src/**` with the correct interop and passes, so nothing
 *   here is a real type error in the source. The `eval:relevance` script therefore sets
 *   `TS_NODE_TRANSPILE_ONLY=true` (see `package.json`) to skip ts-node/esm's own type-check
 *   pass for this invocation only, deferring entirely to `pnpm run typecheck` for actual type
 *   safety on `src/**`. `scripts/**` was already outside `tsconfig.json`'s `include` and
 *   outside type-aware ESLint before this story, so this changes no existing type-checking
 *   guarantee — it only makes the previously-broken CLI invocation path actually run.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { buildBaselineArtifact, computeTop3HitRate } from '../src/lib/eval.js';
import type { QueryResult } from '../src/lib/eval.js';
import { buildEmbedText } from '../src/lib/dedupe.js';
import { createEmbeddingsAdapter } from '../src/lib/embeddings.js';
import type { EmbeddingsAdapter } from '../src/lib/embeddings.js';
import { MemoError } from '../src/lib/errors.js';
import { QdrantRepository } from '../src/lib/qdrant.js';
import {
  rankResults,
  DEFAULT_RANKING_WEIGHTS,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
  DEFAULT_TAG_BOOST_FACTOR,
} from '../src/lib/ranking.js';

// Resolved relative to the process cwd (repo root), consistent with
// src/lib/config.ts's CONFIG_FILENAME resolution. This script is always
// invoked via the `eval:relevance` package.json script or a test import, so
// the cwd is the repository root in both cases.
const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'relevance');
const ENTRIES_PATH = join(FIXTURES_DIR, 'entries.json');
const QUERIES_PATH = join(FIXTURES_DIR, 'queries.json');
const CANDIDATES_PATH = join(FIXTURES_DIR, 'candidates.json');
const BASELINE_PATH = join(FIXTURES_DIR, 'baseline.json');

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const KebabString = z.string().regex(KEBAB_CASE, 'must be kebab-case');

/**
 * Fixture-only entry schema. Deliberately separate from `EntryPayloadSchema`
 * (`src/types/entry.ts`): fixtures carry a relative `age_days` (resolved to an
 * absolute `timestamp_utc` at seed time, not at authoring time) and a wider
 * `source` domain (`scan` in addition to `agent`/`manual`) so source-weighting
 * behavior added in S1-02 has observable fixture coverage.
 */
export const EvalEntrySeedSchema = z
  .object({
    id: z.string().uuid(),
    repo: KebabString,
    org: KebabString,
    domain: KebabString,
    rationale: z.string().min(1).max(5000),
    tags: z.array(KebabString).min(2).max(5),
    entry_type: z.enum(['decision', 'integration_point', 'structure']),
    source: z.enum(['agent', 'manual', 'scan']),
    age_days: z.number(),
    files_modified: z.array(z.string().min(1)).optional(),
    relates_to: z.array(KebabString).optional(),
  })
  .strict();

export type EvalEntrySeed = z.infer<typeof EvalEntrySeedSchema>;

export const EvalQuerySchema = z
  .object({
    id: z.string().min(1),
    query: z.string().min(1),
    expected_ids: z.array(z.string()),
    category: z.enum(['concept', 'identifier', 'cross-repo', 'recency']),
  })
  .strict();

export type EvalQuery = z.infer<typeof EvalQuerySchema>;

function formatZodIssues(issues: z.ZodIssue[], itemIndex: number): string[] {
  return issues.map((issue) => `[${String(itemIndex)}].${issue.path.join('.')}: ${issue.message}`);
}

/** Parses and validates a fixture array against a schema, failing loudly on the first bad record. */
export function parseFixtureArray<T>(input: unknown, schema: z.ZodType<T>, label: string): T[] {
  if (!Array.isArray(input)) {
    throw new MemoError('VALIDATION_FAILED', `${label}: expected an array, got ${typeof input}`);
  }

  const errors: string[] = [];
  const parsed: T[] = [];

  input.forEach((item, index) => {
    const result = schema.safeParse(item);
    if (result.success) {
      parsed.push(result.data);
    } else {
      errors.push(...formatZodIssues(result.error.issues, index));
    }
  });

  if (errors.length > 0) {
    throw new MemoError('VALIDATION_FAILED', `${label} failed validation:\n${errors.join('\n')}`);
  }

  return parsed;
}

/**
 * Cross-file validation: every `expected_ids` entry must resolve to an id
 * present in `entries.json`. A dangling reference (an expected id for an
 * entry that was deleted from the fixture) must fail loudly, not silently
 * pass through as an automatic miss.
 */
export function validateNoDanglingExpectedIds(
  entries: EvalEntrySeed[],
  queries: EvalQuery[],
): void {
  const knownIds = new Set(entries.map((e) => e.id));
  const dangling: string[] = [];

  for (const query of queries) {
    for (const expectedId of query.expected_ids) {
      if (!knownIds.has(expectedId)) {
        dangling.push(`${query.id} -> ${expectedId}`);
      }
    }
  }

  if (dangling.length > 0) {
    throw new MemoError(
      'VALIDATION_FAILED',
      `queries.json references expected_ids missing from entries.json:\n${dangling.join('\n')}`,
    );
  }
}

async function loadJson(path: string): Promise<unknown> {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as unknown;
}

export async function loadFixtures(): Promise<{ entries: EvalEntrySeed[]; queries: EvalQuery[] }> {
  const [rawEntries, rawQueries] = await Promise.all([
    loadJson(ENTRIES_PATH),
    loadJson(QUERIES_PATH),
  ]);
  const entries = parseFixtureArray(rawEntries, EvalEntrySeedSchema, 'entries.json');
  const queries = parseFixtureArray(rawQueries, EvalQuerySchema, 'queries.json');
  validateNoDanglingExpectedIds(entries, queries);
  return { entries, queries };
}

/** Resolves `age_days` to an absolute ISO timestamp relative to `now`, per entry. */
export function resolveTimestamp(ageDays: number, now: Date): string {
  return new Date(now.getTime() - ageDays * 24 * 60 * 60 * 1000).toISOString();
}

function toEntryPayload(entry: EvalEntrySeed, now: Date): Record<string, unknown> {
  const { age_days, ...rest } = entry;
  return { ...rest, timestamp_utc: resolveTimestamp(age_days, now) };
}

/** Wraps a Qdrant/embeddings call so connectivity failures surface as exit-2 QDRANT_UNREACHABLE. */
async function guardUnreachable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (
      err instanceof MemoError &&
      (err.code === 'QDRANT_OPERATION_FAILED' || err.code === 'COLLECTION_BOOTSTRAP_FAILED')
    ) {
      throw new MemoError(
        'QDRANT_UNREACHABLE',
        `Qdrant is unreachable or misconfigured: ${err.message}`,
        2,
      );
    }
    throw err;
  }
}

async function seedEntries(
  qdrant: QdrantRepository,
  embeddings: EmbeddingsAdapter,
  entries: EvalEntrySeed[],
): Promise<void> {
  const now = new Date();
  await guardUnreachable(() => qdrant.ensureCollection());

  for (const entry of entries) {
    const payload = toEntryPayload(entry, now);
    const vector = await embeddings.embed(buildEmbedText(entry.rationale, entry.tags));
    // Qdrant upsert is id-keyed: re-seeding with edited content overwrites
    // the existing point (F-1 resolution: upsert-overwrite, not skip).
    await guardUnreachable(() => qdrant.upsert(entry.id, vector, payload));
  }
}

interface QueryCandidate {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
}

async function runQuery(
  qdrant: QdrantRepository,
  embeddings: EmbeddingsAdapter,
  query: EvalQuery,
): Promise<QueryCandidate[]> {
  const vector = await embeddings.embed(query.query);
  const results = await guardUnreachable(() => qdrant.search(vector, undefined, 10));
  return results.map((r) => ({ id: r.id, score: r.score, payload: r.payload }));
}

async function runAllQueries(
  qdrant: QdrantRepository,
  embeddings: EmbeddingsAdapter,
  queries: EvalQuery[],
): Promise<Map<string, QueryCandidate[]>> {
  const byQueryId = new Map<string, QueryCandidate[]>();
  for (const query of queries) {
    byQueryId.set(query.id, await runQuery(qdrant, embeddings, query));
  }
  return byQueryId;
}

/**
 * Ranks each query's raw Qdrant candidates through issue #34's composite
 * score (plus #36's `tag_boost`, using the query's own text and each
 * candidate's recorded `tags`) before slicing top-3, using the documented
 * default weights and default `tag_boost_factor` (the harness has no
 * per-repo `memo.config.json` to read `ranking` from). This keeps the
 * evaluation harness meaningful across every ranking-affecting story in
 * this plan (PRD §8.2 R6): if it only ever replayed raw similarity order,
 * it could never detect a ranking regression that #34-#38 introduce.
 */
function toQueryResults(
  queries: EvalQuery[],
  candidatesByQueryId: Map<string, QueryCandidate[]>,
): QueryResult[] {
  return queries.map((query) => {
    const candidates = candidatesByQueryId.get(query.id) ?? [];
    const ranked = rankResults(
      candidates.map((c) => ({
        id: c.id,
        similarity: c.score,
        timestampUtc:
          typeof c.payload?.['timestamp_utc'] === 'string' ? c.payload['timestamp_utc'] : undefined,
        source: c.payload?.['source'],
        tags: Array.isArray(c.payload?.['tags']) ? c.payload['tags'] : undefined,
      })),
      DEFAULT_RANKING_WEIGHTS,
      DEFAULT_RECENCY_HALF_LIFE_DAYS,
      Date.now(),
      query.query,
      DEFAULT_TAG_BOOST_FACTOR,
    );
    return {
      category: query.category,
      expectedIds: query.expected_ids,
      top3Ids: ranked.slice(0, 3).map((c) => c.id),
    };
  });
}

function printReport(report: { overall_top3: number; by_category: Record<string, number> }): void {
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  process.stdout.write('Relevance evaluation — top-3 hit rate\n');
  for (const [category, rate] of Object.entries(report.by_category)) {
    process.stdout.write(`  ${category.padEnd(12)} ${pct(rate)}\n`);
  }
  process.stdout.write(`  ${'overall'.padEnd(12)} ${pct(report.overall_top3)}\n`);
}

export function isMemoCollectionSet(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env['MEMO_COLLECTION'];
  return value !== undefined && value.trim().length > 0;
}

export interface EvalDeps {
  loadFixturesFn?: typeof loadFixtures;
  createRepo?: (url?: string, key?: string) => QdrantRepository;
  createEmbeddings?: typeof createEmbeddingsAdapter;
  writeFileFn?: typeof writeFile;
  env?: Record<string, string | undefined>;
}

export interface EvalRunSummary {
  mode: 'seed-only' | 'run' | 'record';
  seededCount?: number;
  report?: { overall_top3: number; by_category: Record<string, number> };
}

/**
 * Runs the harness for the given CLI args. Throws `MemoError` for every
 * failure path (guard refusal, validation, connectivity); the caller decides
 * how to render/exit. Never calls `process.exit` itself, so it is directly
 * unit-testable with injected fakes.
 */
export async function runEval(args: string[], deps: EvalDeps = {}): Promise<EvalRunSummary> {
  const {
    loadFixturesFn = loadFixtures,
    createRepo = (url, key) => new QdrantRepository(url, key),
    createEmbeddings = createEmbeddingsAdapter,
    writeFileFn = writeFile,
    env = process.env,
  } = deps;

  const seedMode = args.includes('--seed');
  const recordMode = args.includes('--record');

  if (seedMode && !isMemoCollectionSet(env)) {
    throw new MemoError(
      'VALIDATION_FAILED',
      'eval-relevance --seed refuses to run: MEMO_COLLECTION is unset (or empty). ' +
        'Set MEMO_COLLECTION=memo_eval to seed the isolated evaluation collection. ' +
        'This guard exists so fixture data can never be written into the production ' +
        '"decisions" collection.',
      1,
    );
  }

  const { entries, queries } = await loadFixturesFn();

  const qdrant = createRepo(env['QDRANT_URL'], env['QDRANT_API_KEY']);
  const embeddings = createEmbeddings();

  if (seedMode) {
    await seedEntries(qdrant, embeddings, entries);
    if (!recordMode) {
      return { mode: 'seed-only', seededCount: entries.length };
    }
  }

  await guardUnreachable(() => qdrant.ensureCollection());
  const candidatesByQueryId = await runAllQueries(qdrant, embeddings, queries);
  const report = computeTop3HitRate(toQueryResults(queries, candidatesByQueryId));

  if (recordMode) {
    const candidatesArtifact = queries.map((query) => ({
      query_id: query.id,
      category: query.category,
      candidates: candidatesByQueryId.get(query.id) ?? [],
    }));
    await writeFileFn(CANDIDATES_PATH, JSON.stringify(candidatesArtifact, null, 2) + '\n', 'utf-8');

    const baseline = buildBaselineArtifact(report, {
      note: 'S1-02 composite ranking (issue #34): final_score = 0.6*similarity + 0.3*recency + 0.1*source, default weights.',
      ...DEFAULT_RANKING_WEIGHTS,
      recency_half_life_days: DEFAULT_RECENCY_HALF_LIFE_DAYS,
    });
    await writeFileFn(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');

    return { mode: 'record', report };
  }

  return { mode: 'run', report };
}

function printSummary(summary: EvalRunSummary, qdrant: { collectionName: string } | null): void {
  if (summary.mode === 'seed-only') {
    process.stdout.write(
      `Seeded ${String(summary.seededCount ?? 0)} entries into "${qdrant?.collectionName ?? 'unknown'}".\n`,
    );
    return;
  }

  if (summary.report) printReport(summary.report);

  if (summary.mode === 'record') {
    process.stdout.write(`Recorded ${CANDIDATES_PATH} and ${BASELINE_PATH}.\n`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Constructed only for the human-facing "seeded into X" message; runEval
  // constructs its own repository internally for the actual operations.
  const collectionNameForDisplay = isMemoCollectionSet()
    ? process.env['MEMO_COLLECTION']
    : 'decisions';
  const summary = await runEval(args);
  printSummary(summary, { collectionName: collectionNameForDisplay ?? 'decisions' });
}

if (process.env['JEST_WORKER_ID'] === undefined) {
  main().catch((err: unknown) => {
    if (err instanceof MemoError) {
      process.stderr.write(`error [${err.code}]: ${err.message}\n`);
      process.exit(err.exitCode);
    }
    process.stderr.write(
      `Unexpected failure: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
